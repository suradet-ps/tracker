<!-- src/components/AutoPlanForm.vue -->
<script setup lang="ts">
import type { AutoOrderPlanWithRelations, DrugRow, SupplierRow } from '@/types/database';

import { computed, onMounted, reactive, ref } from 'vue';
import AppIcon from '@/components/ui/AppIcon.vue';
import AppModal from '@/components/ui/AppModal.vue';
import { supabase } from '@/supabase/client';
import { formatQuantity } from '@/utils/number';

const props = defineProps<{
  /** Existing plan when editing; null when creating. */
  plan?: AutoOrderPlanWithRelations | null;
  /** Drug IDs that already have an active plan (disabled in the picker). */
  activeDrugIds: number[];
}>();

const emit = defineEmits<{
  close: [];
  saved: [];
}>();

type LatestOrderContext = {
  unit_count: string | null;
  packaging: string | null;
  price_per_unit: number | null;
  suppliers: Pick<SupplierRow, 'id' | 'name'> | null;
};

const INTERVAL_OPTIONS = [1, 2, 3, 4, 6, 12] as const;

const isEditing = computed<boolean>(() => Boolean(props.plan));

const form = reactive({
  drugId: props.plan?.drug_id ?? null as number | null,
  usageQuantity: props.plan?.usage_quantity ?? 0,
  usageMonths: props.plan?.usage_months ?? 12,
  intervalMonths: props.plan?.interval_months ?? 3,
  nextOrderDate: props.plan?.next_order_date ?? todayIso(),
  supplierName: props.plan?.suppliers.name ?? '',
  unitCount: props.plan?.unit_count ?? '',
  packaging: props.plan?.packaging ?? '',
  pricePerUnit: props.plan?.price_per_unit ?? 0,
});

const drugs = ref<DrugRow[]>([]);
const suppliers = ref<SupplierRow[]>([]);
const selectedDrug = ref<DrugRow | null>(props.plan?.drugs ?? null);
const drugSearch = ref<string>('');
const loadingDrugs = ref<boolean>(true);
const drugsError = ref<string | null>(null);
const loadingHistory = ref<boolean>(false);
const historyLoaded = ref<boolean>(false);
const saving = ref<boolean>(false);
const error = ref<string | null>(null);

/** Today as `YYYY-MM-DD` for the date input default. */
function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** Text used for the drug search across name, form, and strength. */
function drugText(drug: DrugRow): string {
  return `${drug.name} ${drug.form ?? ''} ${drug.strength ?? ''}`.toLowerCase();
}

const filteredDrugs = computed<DrugRow[]>(() => {
  const query = drugSearch.value.trim().toLowerCase();

  return drugs.value
    .filter((drug) => {
      if (!query)
        return true;
      return drugText(drug).includes(query);
    })
    .slice(0, 60);
});

const monthlyUsage = computed<number>(() => {
  const months = Number(form.usageMonths);
  if (!Number.isFinite(months) || months <= 0)
    return 0;
  return Number(form.usageQuantity) / months;
});

const orderQuantity = computed<number>(() => {
  if (!Number.isFinite(monthlyUsage.value) || monthlyUsage.value <= 0)
    return 0;
  return Math.max(1, Math.ceil(monthlyUsage.value * Number(form.intervalMonths)));
});

const isValid = computed<boolean>(() =>
  Boolean(form.drugId)
  && Number(form.usageQuantity) > 0
  && Number(form.usageMonths) > 0
  && INTERVAL_OPTIONS.includes(form.intervalMonths as typeof INTERVAL_OPTIONS[number])
  && Boolean(form.nextOrderDate)
  && form.supplierName.trim().length > 0
  && form.unitCount.trim().length > 0
  && Number(form.pricePerUnit) > 0,
);

function isDrugUnavailable(drug: DrugRow): boolean {
  return drug.id !== props.plan?.drug_id && props.activeDrugIds.includes(drug.id);
}

async function loadDrugs(): Promise<void> {
  loadingDrugs.value = true;
  drugsError.value = null;

  try {
    const { data, error: fetchError } = await supabase
      .from('drugs')
      .select('*')
      .order('name', { ascending: true });

    if (fetchError)
      throw fetchError;

    drugs.value = (data ?? []) as DrugRow[];
  }
  catch (err: unknown) {
    drugsError.value = err instanceof Error ? err.message : 'โหลดรายการยาไม่สำเร็จ';
  }
  finally {
    loadingDrugs.value = false;
  }
}

async function loadSuppliers(): Promise<void> {
  const { data } = await supabase
    .from('suppliers')
    .select('*')
    .order('name', { ascending: true });

  suppliers.value = (data ?? []) as SupplierRow[];
}

/**
 * Pre-fills supplier, unit, packaging, and price from the drug's most recent
 * purchase order. New drugs keep the fields empty for manual entry.
 */
async function loadLatestOrderContext(drugId: number): Promise<void> {
  loadingHistory.value = true;
  historyLoaded.value = false;

  try {
    const { data, error: fetchError } = await supabase
      .from('purchase_orders')
      .select('unit_count, packaging, price_per_unit, suppliers(id, name)')
      .eq('drug_id', drugId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fetchError)
      throw fetchError;

    const latest = data as unknown as LatestOrderContext | null;

    if (latest) {
      form.supplierName = latest.suppliers?.name ?? '';
      form.unitCount = latest.unit_count ?? '';
      form.packaging = latest.packaging ?? '';
      form.pricePerUnit = latest.price_per_unit ?? 0;
    }
    else {
      form.supplierName = '';
      form.unitCount = '';
      form.packaging = '';
      form.pricePerUnit = 0;
    }
  }
  catch {
    form.supplierName = '';
    form.unitCount = '';
    form.packaging = '';
    form.pricePerUnit = 0;
  }
  finally {
    historyLoaded.value = true;
    loadingHistory.value = false;
  }
}

async function selectDrug(drug: DrugRow): Promise<void> {
  if (isDrugUnavailable(drug))
    return;

  selectedDrug.value = drug;
  form.drugId = drug.id;
  drugSearch.value = '';
  await loadLatestOrderContext(drug.id);
}

function clearSelectedDrug(): void {
  selectedDrug.value = null;
  form.drugId = null;
  historyLoaded.value = false;
}

function close(): void {
  if (!saving.value)
    emit('close');
}

async function handleSubmit(): Promise<void> {
  if (!isValid.value || !form.drugId) {
    error.value = 'กรุณากรอกข้อมูลให้ครบ และตรวจสอบจำนวนเงิน/ราคาให้ถูกต้อง';
    return;
  }

  saving.value = true;
  error.value = null;

  try {
    const { data: duplicate } = await supabase
      .from('auto_order_plans')
      .select('id')
      .eq('drug_id', form.drugId)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (duplicate && duplicate.id !== props.plan?.id) {
      throw new Error('ยานี้มีแผนที่เปิดใช้งานอยู่แล้ว กรุณาหยุดแผนเดิมก่อน');
    }

    const { data: supplier, error: supplierError } = await supabase
      .from('suppliers')
      .upsert({ name: form.supplierName.trim() }, { onConflict: 'name' })
      .select('*')
      .returns<SupplierRow[]>()
      .single();

    if (supplierError)
      throw supplierError;
    if (!supplier)
      throw new Error('ไม่สามารถบันทึกข้อมูลบริษัทได้');

    const payload = {
      drug_id: form.drugId,
      supplier_id: supplier.id,
      usage_quantity: Number(form.usageQuantity),
      usage_months: Number(form.usageMonths),
      interval_months: Number(form.intervalMonths),
      next_order_date: form.nextOrderDate,
      unit_count: form.unitCount.trim() || '-',
      packaging: form.packaging.trim() || null,
      price_per_unit: Number(form.pricePerUnit),
      updated_at: new Date().toISOString(),
    };

    if (props.plan) {
      const { error: updateError } = await supabase
        .from('auto_order_plans')
        .update(payload)
        .eq('id', props.plan.id);

      if (updateError)
        throw updateError;
    }
    else {
      const { error: insertError } = await supabase
        .from('auto_order_plans')
        .insert({ ...payload, is_active: true });

      if (insertError)
        throw insertError;
    }

    emit('saved');
  }
  catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ';
    error.value = message.includes('auto_order_plans_one_active_per_drug')
      ? 'ยานี้มีแผนที่เปิดใช้งานอยู่แล้ว กรุณาหยุดแผนเดิมก่อน'
      : message;
  }
  finally {
    saving.value = false;
  }
}

onMounted(async () => {
  await Promise.all([loadDrugs(), loadSuppliers()]);
});
</script>

<template>
  <AppModal
    :title="isEditing ? 'แก้ไขแผนสั่งซื้ออัตโนมัติ' : 'เพิ่มแผนสั่งซื้ออัตโนมัติ'"
    size="lg"
    @close="close"
  >
    <form id="auto-plan-form" class="plan-form" @submit.prevent="handleSubmit">
      <p class="form-note">
        ระบบจะสร้างใบสั่งซื้อฉบับร่าง (สถานะ <strong>ต้องสั่งซื้อ</strong>)
        ตามยอดใช้ย้อนหลังและรอบที่กำหนด แล้วแจ้งเตือน Telegram ให้เภสัชกรตรวจสอบ
        โดยไม่ส่งถึงบริษัทโดยตรง
      </p>

      <!-- Drug picker -->
      <div class="form-group">
        <span class="form-label">ยา <span class="required">*</span></span>

        <div v-if="selectedDrug" class="selected-drug">
          <div>
            <span class="row-title">{{ selectedDrug.name }}</span>
            <span class="row-meta">
              {{ selectedDrug.form }} {{ selectedDrug.strength }}
            </span>
          </div>
          <button
            v-if="!isEditing"
            type="button"
            class="btn btn-subtle btn-sm"
            @click="clearSelectedDrug"
          >
            เปลี่ยนยา
          </button>
        </div>

        <template v-else>
          <div class="input-wrap">
            <AppIcon name="search" :size="16" class="input-icon" />
            <input
              v-model="drugSearch"
              type="search"
              class="form-input"
              placeholder="ค้นหาชื่อยา รูปแบบ หรือความแรง..."
              aria-label="ค้นหายาเพื่อเพิ่มแผน"
              autocomplete="off"
            >
          </div>

          <div v-if="loadingDrugs" class="picker-state">
            กำลังโหลดรายการยา...
          </div>
          <div v-else-if="drugsError" class="alert alert-error">
            <AppIcon name="alertCircle" :size="17" />
            <span>{{ drugsError }}</span>
          </div>
          <div v-else-if="filteredDrugs.length === 0" class="picker-state">
            ไม่พบรายการยาที่ตรงกับคำค้นหา
          </div>
          <ul v-else class="drug-picker" aria-label="รายการยา">
            <li v-for="drug in filteredDrugs" :key="drug.id">
              <button
                type="button"
                class="drug-option"
                :class="{ 'is-disabled': isDrugUnavailable(drug) }"
                :disabled="isDrugUnavailable(drug)"
                @click="selectDrug(drug)"
              >
                <span class="drug-name">{{ drug.name }}</span>
                <span class="drug-meta">
                  {{ drug.form }} {{ drug.strength }}
                  <template v-if="isDrugUnavailable(drug)"> · มีแผนที่เปิดใช้งานแล้ว</template>
                </span>
              </button>
            </li>
          </ul>
        </template>
      </div>

      <p v-if="loadingHistory" class="form-hint">
        กำลังดึงบริษัท ราคา และหน่วยนับล่าสุดจากประวัติการสั่งซื้อ...
      </p>
      <p v-else-if="historyLoaded && selectedDrug" class="form-hint">
        <template v-if="form.supplierName">
          เติมข้อมูลจากประวัติล่าสุดแล้ว - แก้ไขได้ตามต้องการ
        </template>
        <template v-else>
          ไม่พบประวัติการสั่งซื้อของยานี้ - กรุณากรอกบริษัทและราคาเอง
        </template>
      </p>

      <div class="form-grid">
        <div class="form-group">
          <label class="form-label" for="auto-usage-quantity">ยอดใช้ย้อนหลัง (จำนวน) <span class="required">*</span></label>
          <input
            id="auto-usage-quantity"
            v-model.number="form.usageQuantity"
            type="number"
            min="0.01"
            step="0.01"
            class="form-input"
            required
          >
        </div>

        <div class="form-group">
          <label class="form-label" for="auto-usage-months">ย้อนหลังกี่เดือน <span class="required">*</span></label>
          <input
            id="auto-usage-months"
            v-model.number="form.usageMonths"
            type="number"
            min="1"
            step="1"
            class="form-input"
            required
          >
        </div>

        <div class="form-group">
          <label class="form-label" for="auto-interval">สั่งซื้อทุก <span class="required">*</span></label>
          <select id="auto-interval" v-model.number="form.intervalMonths" class="form-select" required>
            <option v-for="months in INTERVAL_OPTIONS" :key="months" :value="months">
              {{ months }} เดือน
            </option>
          </select>
        </div>

        <div class="form-group">
          <label class="form-label" for="auto-next-date">สร้างร่างครั้งถัดไป <span class="required">*</span></label>
          <input
            id="auto-next-date"
            v-model="form.nextOrderDate"
            type="date"
            class="form-input"
            required
          >
        </div>

        <div class="form-group">
          <label class="form-label" for="auto-supplier">บริษัท <span class="required">*</span></label>
          <input
            id="auto-supplier"
            v-model="form.supplierName"
            type="text"
            class="form-input"
            list="auto-plan-suppliers"
            placeholder="ระบุบริษัท..."
            autocomplete="off"
            required
          >
          <datalist id="auto-plan-suppliers">
            <option v-for="supplier in suppliers" :key="supplier.id" :value="supplier.name" />
          </datalist>
        </div>

        <div class="form-group">
          <label class="form-label" for="auto-unit">หน่วยนับ <span class="required">*</span></label>
          <input
            id="auto-unit"
            v-model="form.unitCount"
            type="text"
            class="form-input"
            placeholder="เช่น กล่อง, แผง"
            required
          >
        </div>

        <div class="form-group">
          <label class="form-label" for="auto-packaging">บรรจุภัณฑ์</label>
          <input
            id="auto-packaging"
            v-model="form.packaging"
            type="text"
            class="form-input"
            placeholder="เช่น ขวด 100 เม็ด"
          >
        </div>

        <div class="form-group">
          <label class="form-label" for="auto-price">ราคาต่อหน่วย (บาท) <span class="required">*</span></label>
          <input
            id="auto-price"
            v-model.number="form.pricePerUnit"
            type="number"
            min="0.01"
            step="0.01"
            class="form-input"
            required
          >
        </div>
      </div>

      <!-- Calculation preview -->
      <div class="plan-preview">
        <span class="preview-label">ตัวอย่างการคำนวณ</span>
        <p class="preview-line">
          ใช้เฉลี่ย <strong>{{ formatQuantity(monthlyUsage) }}</strong> {{ form.unitCount || 'หน่วย' }}/เดือน
          → สร้างครั้งละ <strong>{{ formatQuantity(orderQuantity) }}</strong> {{ form.unitCount || 'หน่วย' }}
          ทุก <strong>{{ form.intervalMonths }}</strong> เดือน
        </p>
      </div>

      <div v-if="error" class="alert alert-error" role="alert">
        <AppIcon name="alertCircle" :size="17" />
        <span>{{ error }}</span>
      </div>
    </form>

    <template #footer>
      <button type="button" class="btn btn-ghost" :disabled="saving" @click="close">
        ยกเลิก
      </button>
      <button type="submit" form="auto-plan-form" class="btn btn-primary" :disabled="saving || !isValid">
        <span v-if="saving" class="spinner spinner-sm" />
        <AppIcon v-else name="check" :size="15" />
        {{ saving ? 'กำลังบันทึก...' : (isEditing ? 'บันทึกการแก้ไข' : 'เพิ่มแผน') }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
.plan-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.form-note {
  color: var(--text-2);
  font-size: var(--text-sm);
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 0.9rem 1rem;
}

.required {
  color: var(--danger);
}

.selected-drug {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.65rem 0.85rem;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background-color: var(--surface-2);
}

.row-title {
  display: block;
  font-weight: 600;
}

.row-meta {
  display: block;
  margin-top: 1px;
  color: var(--text-3);
  font-size: var(--text-xs);
}

.picker-state {
  padding: 0.75rem;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-sm);
  color: var(--text-3);
  font-size: var(--text-sm);
  text-align: center;
}

.drug-picker {
  max-height: 190px;
  overflow-y: auto;
  margin: 0;
  padding: 0;
  list-style: none;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}

.drug-picker li + li {
  border-top: 1px solid var(--border);
}

.drug-option {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  width: 100%;
  padding: 0.55rem 0.75rem;
  border: 0;
  background: none;
  text-align: left;
  cursor: pointer;
}

.drug-option:hover:not(:disabled),
.drug-option:focus-visible {
  background-color: var(--primary-soft);
}

.drug-option.is-disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.drug-name {
  font-weight: 500;
}

.drug-meta {
  color: var(--text-3);
  font-size: var(--text-xs);
}

.plan-preview {
  padding: 0.8rem 1rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background-color: var(--primary-soft);
  color: var(--text-2);
  font-size: var(--text-sm);
}

.preview-label {
  display: block;
  margin-bottom: 0.15rem;
  color: var(--primary);
  font-size: var(--text-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.preview-line {
  margin: 0;
}

.preview-line strong {
  color: var(--text);
  font-variant-numeric: tabular-nums;
}

.btn-primary .spinner-sm {
  border-color: color-mix(in srgb, var(--on-primary) 35%, transparent);
  border-top-color: var(--on-primary);
}
</style>
