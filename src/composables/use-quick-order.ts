// src/composables/use-quick-order.ts
import type {
  DrugCatalogEntry,
  DrugRow,
  ImportBatchRow,
  PurchaseOrderInsert,
  QuickOrderDraftItem,
  SupplierRow,
} from '@/types/database';

import { computed, ref } from 'vue';
import { supabase } from '@/supabase/client';

// ─────────────────────────────────────────────
// Internal types
// ─────────────────────────────────────────────

/** Shape of the raw purchase_orders rows we query to build the catalog */
type LastOrderRaw = {
  drug_id: number;
  supplier_id: number;
  unit_count: string;
  packaging: string | null;
  price_per_unit: number;
  suppliers: SupplierRow | null;
};

const MANUAL_BATCH_NAME = 'Manual Add' as const;

// ─────────────────────────────────────────────
// Composable
// ─────────────────────────────────────────────

export function useQuickOrder() {
  // ── State ──────────────────────────────────
  const draftItems = ref<QuickOrderDraftItem[]>([]);
  const allSuppliers = ref<SupplierRow[]>([]);
  const loading = ref<boolean>(false);
  const submitting = ref<boolean>(false);
  const fetchError = ref<string | null>(null);
  const submitError = ref<string | null>(null);

  // ── Computed ───────────────────────────────

  /** Number of items currently checked for ordering */
  const selectedCount = computed<number>(
    () => draftItems.value.filter(item => item.isSelected).length,
  );

  /** True when at least one selected item is missing a supplier name or has invalid numeric fields */
  const hasInvalidItems = computed<boolean>(
    () => draftItems.value.some(item =>
      item.isSelected && (
        !item.supplierName.trim()
        || !(Number.isFinite(item.quantity) && item.quantity >= 1)
        || !(Number.isFinite(item.pricePerUnit) && item.pricePerUnit >= 0)
      ),
    ),
  );

  /** All items that are currently selected */
  const selectedItems = computed<QuickOrderDraftItem[]>(
    () => draftItems.value.filter(item => item.isSelected),
  );

  // ── Data fetching ──────────────────────────

  /**
   * Loads the full drug catalog and enriches every entry with the
   * most recently used supplier / ordering context from purchase_orders history.
   * All three Supabase queries run in parallel for maximum performance.
   */
  async function fetchCatalog(): Promise<void> {
    loading.value = true;
    fetchError.value = null;

    try {
      const [drugsResult, ordersResult, suppliersResult] = await Promise.all([
        // 1. All drugs, sorted alphabetically
        supabase
          .from('drugs')
          .select('id, name, form, strength, created_at')
          .order('name', { ascending: true }),

        // 2. All purchase orders (only fields we need), sorted newest-first
        //    so we can build a "last used" map by taking the first hit per drug_id
        supabase
          .from('purchase_orders')
          .select('drug_id, supplier_id, unit_count, packaging, price_per_unit, suppliers(id, name, created_at)')
          .order('created_at', { ascending: false }),

        // 3. All suppliers for the autocomplete datalist
        supabase
          .from('suppliers')
          .select('id, name, created_at')
          .order('name', { ascending: true }),
      ]);

      if (drugsResult.error)
        throw drugsResult.error;
      if (ordersResult.error)
        throw ordersResult.error;
      if (suppliersResult.error)
        throw suppliersResult.error;

      const drugs = (drugsResult.data ?? []) as DrugRow[];
      const rawOrders = (ordersResult.data ?? []) as unknown as LastOrderRaw[];
      allSuppliers.value = (suppliersResult.data ?? []) as SupplierRow[];

      // Build drug_id → most-recent-order map (list is already desc by created_at)
      const lastOrderMap = new Map<number, LastOrderRaw>();
      for (const order of rawOrders) {
        if (!lastOrderMap.has(order.drug_id)) {
          lastOrderMap.set(order.drug_id, order);
        }
      }

      // Enrich each drug with last-order context
      const catalogEntries: DrugCatalogEntry[] = drugs.map((drug) => {
        const last = lastOrderMap.get(drug.id) ?? null;
        return {
          ...drug,
          lastSupplierId: last?.supplier_id ?? null,
          lastSupplierName: last?.suppliers?.name ?? null,
          lastUnitCount: last?.unit_count ?? null,
          lastPackaging: last?.packaging ?? null,
          lastPricePerUnit: last?.price_per_unit ?? null,
        };
      });

      // Initialise editable draft items - pre-filled from last order context
      draftItems.value = catalogEntries.map((entry): QuickOrderDraftItem => ({
        drug: entry,
        isSelected: false,
        quantity: 1,
        unitCount: entry.lastUnitCount ?? '',
        packaging: entry.lastPackaging ?? '',
        supplierId: entry.lastSupplierId,
        supplierName: entry.lastSupplierName ?? '',
        pricePerUnit: entry.lastPricePerUnit ?? 0,
      }));
    }
    catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ';
      fetchError.value = `เกิดข้อผิดพลาดในการดึงข้อมูล: ${message}`;
    }
    finally {
      loading.value = false;
    }
  }

  // ── Submission ─────────────────────────────

  /**
   * Validates and batch-inserts purchase orders for all selected draft items.
   * Upserts any unknown supplier names automatically.
   *
   * @returns Number of orders successfully created.
   * @throws  Re-throws on failure so the view can react accordingly.
   */
  async function submitOrders(): Promise<number> {
    const selected = draftItems.value.filter(item => item.isSelected);
    if (selected.length === 0)
      return 0;

    // Guard: all selected items must have a supplier
    const missing = selected.find(item => !item.supplierName.trim());
    if (missing) {
      submitError.value = `ยา "${missing.drug.name}" ยังไม่ได้ระบุบริษัทผู้จำหน่าย`;
      throw new Error(submitError.value);
    }

    submitting.value = true;
    submitError.value = null;

    try {
      // ── Step 1: Get or create the Manual Add import batch ──
      const { data: batchData, error: batchError } = await supabase
        .from('import_batches')
        .upsert({ file_name: MANUAL_BATCH_NAME }, { onConflict: 'file_name' })
        .select('*')
        .returns<ImportBatchRow[]>()
        .single();

      if (batchError)
        throw batchError;
      if (!batchData)
        throw new Error('ไม่สามารถสร้าง import batch ได้');

      // ── Step 2: Batch-upsert all unique supplier names in a single round-trip ──
      const uniqueNames = [...new Set(selected.map(i => i.supplierName.trim()))];

      const { data: supplierData, error: supplierError } = await supabase
        .from('suppliers')
        .upsert(uniqueNames.map(name => ({ name })), { onConflict: 'name' })
        .select('id, name, created_at')
        .returns<SupplierRow[]>();

      if (supplierError)
        throw supplierError;

      // Build a name → id lookup map keyed by the DB-returned name.
      // Because we send already-trimmed strings, row.name matches item.supplierName.trim()
      // exactly, making the Step 3 lookup reliable regardless of DB-side normalization.
      const supplierIdMap = new Map<string, number>(
        (supplierData ?? []).map(row => [row.name, row.id]),
      );

      // ── Step 3: Build the purchase order payloads ──
      const orders: PurchaseOrderInsert[] = selected.map((item): PurchaseOrderInsert => {
        const supplierId = supplierIdMap.get(item.supplierName.trim());
        if (!supplierId)
          throw new Error(`ไม่พบ supplier ID สำหรับยา "${item.drug.name}"`);

        const qty = Number(item.quantity);
        const price = Number(item.pricePerUnit);

        if (!Number.isFinite(qty) || qty < 1)
          throw new Error(`ยา "${item.drug.name}" มีจำนวนที่ไม่ถูกต้อง (ต้องเป็นจำนวนเต็มมากกว่า 0)`);
        if (!Number.isFinite(price) || price < 0)
          throw new Error(`ยา "${item.drug.name}" (${item.supplierName.trim()}) มีราคาต่อหน่วยที่ไม่ถูกต้อง (ต้องไม่ติดลบ)`);

        return {
          import_batch_id: batchData.id,
          supplier_id: supplierId,
          drug_id: item.drug.id,
          quantity: qty,
          unit_count: item.unitCount.trim() || '-',
          price_per_unit: price,
          total_price: qty * price,
          packaging: item.packaging.trim() || null,
          status: 'ต้องสั่งซื้อ',
        };
      });

      // ── Step 4: Batch insert all purchase orders in one round-trip ──
      const { error: insertError } = await supabase
        .from('purchase_orders')
        .insert(orders);

      if (insertError)
        throw insertError;

      return selected.length;
    }
    catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ';
      submitError.value = `เกิดข้อผิดพลาด: ${message}`;
      throw err;
    }
    finally {
      submitting.value = false;
    }
  }

  // ── Exposed API ────────────────────────────

  return {
    // State
    draftItems,
    allSuppliers,
    loading,
    submitting,
    fetchError,
    submitError,

    // Computed
    selectedCount,
    selectedItems,
    hasInvalidItems,

    // Actions
    fetchCatalog,
    submitOrders,
  };
}
