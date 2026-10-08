<!-- src/components/AddOrderForm.vue -->
<script setup lang="ts">
import type { AddOrderFormData, DrugRow, ImportBatchRow, PurchaseOrderInsert, SupplierRow } from '@/types/database';

import { reactive, ref } from 'vue';
import AppIcon from '@/components/ui/AppIcon.vue';
import AppModal from '@/components/ui/AppModal.vue';
import { supabase } from '@/supabase/client';

const emit = defineEmits<{
  close: [];
  orderAdded: [];
}>();

const form = reactive<AddOrderFormData>({
  drugName: '',
  form: '',
  strength: '',
  supplierName: '',
  quantity: 1,
  unitCount: '',
  pricePerUnit: 0,
});

const isLoading = ref<boolean>(false);
const error = ref<string | null>(null);

const MANUAL_BATCH_NAME = 'Manual Add' as const;

async function handleSubmit(): Promise<void> {
  isLoading.value = true;
  error.value = null;

  // Validate minimum values for quantity and price
  if (form.quantity <= 0) {
    error.value = 'จำนวนต้องมากกว่า 0';
    isLoading.value = false;
    return;
  }

  if (form.pricePerUnit <= 0) {
    error.value = 'ราคาต่อหน่วยต้องมากกว่า 0';
    isLoading.value = false;
    return;
  }

  try {
    // 1. Upsert the manual import batch
    const { data: batchData, error: batchError } = await supabase
      .from('import_batches')
      .upsert({ file_name: MANUAL_BATCH_NAME }, { onConflict: 'file_name' })
      .select('*')
      .returns<ImportBatchRow[]>()
      .single();

    if (batchError)
      throw batchError;
    if (!batchData)
      throw new Error('ไม่สามารถสร้าง batch ได้');

    // 2. Upsert supplier
    const { data: supplierData, error: supplierError } = await supabase
      .from('suppliers')
      .upsert({ name: form.supplierName.trim() }, { onConflict: 'name' })
      .select('*')
      .returns<SupplierRow[]>()
      .single();

    if (supplierError)
      throw supplierError;
    if (!supplierData)
      throw new Error('ไม่สามารถสร้างข้อมูลบริษัทได้');

    // 3. Upsert drug
    const { data: drugData, error: drugError } = await supabase
      .from('drugs')
      .upsert(
        {
          name: form.drugName.trim(),
          form: form.form.trim() || null,
          strength: form.strength.trim() || null,
        },
        { onConflict: 'name,form,strength' },
      )
      .select('*')
      .returns<DrugRow[]>()
      .single();

    if (drugError)
      throw drugError;
    if (!drugData)
      throw new Error('ไม่สามารถสร้างข้อมูลยาได้');

    // 4. Insert purchase order
    const purchaseOrder: PurchaseOrderInsert = {
      import_batch_id: batchData.id,
      supplier_id: supplierData.id,
      drug_id: drugData.id,
      quantity: form.quantity,
      unit_count: form.unitCount.trim(),
      price_per_unit: form.pricePerUnit,
      total_price: form.quantity * form.pricePerUnit,
      status: 'ต้องสั่งซื้อ',
    };

    const { error: orderError } = await supabase
      .from('purchase_orders')
      .insert(purchaseOrder);

    if (orderError)
      throw orderError;

    // 5. Notify parent component
    emit('orderAdded');
    emit('close');
  }
  catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ';
    error.value = `เกิดข้อผิดพลาด: ${message}`;
  }
  finally {
    isLoading.value = false;
  }
}
</script>

<template>
  <AppModal title="เพิ่มรายการสั่งซื้อด้วยตนเอง" size="md" @close="emit('close')">
    <form id="add-order-form" class="add-form" @submit.prevent="handleSubmit">
      <p class="form-note">
        บันทึกในสถานะ <strong>ต้องสั่งซื้อ</strong> — เลือกรายการนี้ในหน้ารายการเพื่อสร้างใบสั่งซื้อได้ทันที
      </p>

      <div class="form-grid">
        <div class="form-group">
          <label class="form-label" for="drugName">ชื่อยา <span class="required">*</span></label>
          <input id="drugName" v-model="form.drugName" type="text" class="form-input" required>
        </div>

        <div class="form-group">
          <label class="form-label" for="supplierName">บริษัท <span class="required">*</span></label>
          <input id="supplierName" v-model="form.supplierName" type="text" class="form-input" required>
        </div>

        <div class="form-group">
          <label class="form-label" for="form">รูปแบบยา</label>
          <input id="form" v-model="form.form" type="text" class="form-input" placeholder="เช่น tab, inj">
        </div>

        <div class="form-group">
          <label class="form-label" for="strength">ความแรง</label>
          <input id="strength" v-model="form.strength" type="text" class="form-input" placeholder="เช่น 500 mg">
        </div>

        <div class="form-group">
          <label class="form-label" for="quantity">จำนวน <span class="required">*</span></label>
          <input id="quantity" v-model.number="form.quantity" type="number" min="1" class="form-input" required>
        </div>

        <div class="form-group">
          <label class="form-label" for="unitCount">หน่วยนับ <span class="required">*</span></label>
          <input id="unitCount" v-model="form.unitCount" type="text" class="form-input" required placeholder="เช่น กล่อง, แผง">
        </div>

        <div class="form-group">
          <label class="form-label" for="pricePerUnit">ราคาต่อหน่วย (บาท) <span class="required">*</span></label>
          <input
            id="pricePerUnit" v-model.number="form.pricePerUnit" type="number" min="0.01" step="0.01"
            class="form-input" required
          >
        </div>
      </div>

      <div v-if="error" class="alert alert-error" role="alert">
        <AppIcon name="alertCircle" :size="17" />
        <span>{{ error }}</span>
      </div>
    </form>

    <template #footer>
      <button type="button" class="btn btn-ghost" :disabled="isLoading" @click="emit('close')">
        ยกเลิก
      </button>
      <button type="submit" form="add-order-form" class="btn btn-primary" :disabled="isLoading">
        <span v-if="isLoading" class="spinner spinner-sm" />
        {{ isLoading ? 'กำลังบันทึก...' : 'เพิ่มรายการ' }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
.add-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.form-note {
  color: var(--text-3);
  font-size: var(--text-sm);
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 0.9rem 1rem;
}

.required {
  color: var(--danger);
}

.btn-primary .spinner-sm {
  border-color: color-mix(in srgb, var(--on-primary) 35%, transparent);
  border-top-color: var(--on-primary);
}
</style>
