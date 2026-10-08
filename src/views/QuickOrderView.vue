<!-- src/views/QuickOrderView.vue -->
<script setup lang="ts">
import type { QuickOrderDraftItem } from '@/types/database';

import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import AppIcon from '@/components/ui/AppIcon.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import StatCard from '@/components/ui/StatCard.vue';
import { useQuickOrder } from '@/composables/use-quick-order';
import { useNotificationStore } from '@/stores/notification';
import { useOrderCountsStore } from '@/stores/order-counts';
import { formatMoney } from '@/utils/number';

// ─────────────────────────────────────────────
// Composables & Stores
// ─────────────────────────────────────────────

const router = useRouter();
const notificationStore = useNotificationStore();
const countsStore = useOrderCountsStore();

const {
  draftItems,
  allSuppliers,
  loading,
  submitting,
  fetchError,
  submitError,
  selectedCount,
  hasInvalidItems,
  fetchCatalog,
  submitOrders,
} = useQuickOrder();

// ─────────────────────────────────────────────
// Local UI State
// ─────────────────────────────────────────────

const searchQuery = ref<string>('');
const supplierFilter = ref<string>('');
const page = ref<number>(1);
const pageSize = ref<number>(50);

// ─────────────────────────────────────────────
// Computed - Filtering
// ─────────────────────────────────────────────

/** Items that match the current search and supplier filter */
const filteredItems = computed<QuickOrderDraftItem[]>(() => {
  const query = searchQuery.value.trim().toLowerCase();
  const supplier = supplierFilter.value.trim().toLowerCase();

  return draftItems.value.filter((item) => {
    const drugText
      = `${item.drug.name} ${item.drug.form ?? ''} ${item.drug.strength ?? ''}`.toLowerCase();
    const matchesName = !query || drugText.includes(query);
    const matchesSupplier = !supplier || item.supplierName.toLowerCase().includes(supplier);
    return matchesName && matchesSupplier;
  });
});

/** Whether all currently visible (filtered) items are selected */
const isAllFilteredSelected = computed<boolean>(() => {
  const visible = filteredItems.value;
  return visible.length > 0 && visible.every(item => item.isSelected);
});

/** Number of currently visible (filtered) items that are selected */
const filteredSelectedCount = computed<number>(
  () => filteredItems.value.filter(i => i.isSelected).length,
);

/** Unique supplier names derived from allSuppliers list */
const supplierNames = computed<string[]>(() => allSuppliers.value.map(s => s.name));

/** Estimated value of the current selection. */
const selectedTotal = computed<number>(() =>
  draftItems.value
    .filter(item => item.isSelected)
    .reduce((sum, item) => {
      const quantity = Number(item.quantity);
      const price = Number(item.pricePerUnit);
      if (!Number.isFinite(quantity) || !Number.isFinite(price))
        return sum;
      return sum + quantity * price;
    }, 0),
);

// ─────────────────────────────────────────────
// Computed - Pagination
// ─────────────────────────────────────────────

const totalPages = computed<number>(
  () => Math.max(1, Math.ceil(filteredItems.value.length / pageSize.value)),
);

const pagedItems = computed<QuickOrderDraftItem[]>(() => {
  const start = (page.value - 1) * pageSize.value;
  return filteredItems.value.slice(start, start + pageSize.value);
});

const rangeStart = computed<number>(
  () => (filteredItems.value.length === 0 ? 0 : (page.value - 1) * pageSize.value + 1),
);

const rangeEnd = computed<number>(
  () => Math.min(page.value * pageSize.value, filteredItems.value.length),
);

// Reset to the first page whenever the result set changes shape.
watch([searchQuery, supplierFilter, pageSize], () => {
  page.value = 1;
});

watch(totalPages, (max: number) => {
  if (page.value > max)
    page.value = max;
});

// ─────────────────────────────────────────────
// Selection Helpers
// ─────────────────────────────────────────────

function toggleItem(item: QuickOrderDraftItem): void {
  item.isSelected = !item.isSelected;
}

function toggleAllFiltered(event: Event): void {
  const checked = (event.target as HTMLInputElement).checked;
  filteredItems.value.forEach((item) => {
    item.isSelected = checked;
  });
}

function clearAllSelections(): void {
  draftItems.value.forEach((item) => {
    item.isSelected = false;
  });
}

function clearFilters(): void {
  searchQuery.value = '';
  supplierFilter.value = '';
}

function isItemInvalid(item: QuickOrderDraftItem): boolean {
  return item.isSelected && (
    !item.supplierName.trim()
    || !(Number.isFinite(Number(item.quantity)) && Number(item.quantity) >= 1)
    || !(Number.isFinite(Number(item.pricePerUnit)) && Number(item.pricePerUnit) >= 0)
  );
}

// ─────────────────────────────────────────────
// Submit Handler
// ─────────────────────────────────────────────

async function handleSubmit(): Promise<void> {
  try {
    const count = await submitOrders();
    notificationStore.showNotification({
      message: `สร้างรายการสั่งซื้อสำเร็จ ${count} รายการ! เลือกรายการที่ต้องการแล้วส่งผ่าน Telegram ได้เลย`,
      type: 'success',
    });
    countsStore.refresh();
    await router.push({ name: 'Order' });
  }
  catch {
    // submitError is already set inside the composable; the UI will display it.
  }
}

// ─────────────────────────────────────────────
// Lifecycle
// ─────────────────────────────────────────────

onMounted(fetchCatalog);
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <h1 class="page-title">
          สร้างใบสั่งซื้อด่วน
        </h1>
        <p class="page-desc">
          เลือกยาและระบุจำนวน ระบบจะเติมบริษัท ราคา และหน่วยนับจากประวัติล่าสุดให้อัตโนมัติ
        </p>
      </div>
      <div class="page-actions">
        <button type="button" class="btn btn-ghost" @click="router.push({ name: 'Order' })">
          <AppIcon name="clipboardList" :size="16" />
          ไปรายการต้องสั่งซื้อ
        </button>
      </div>
    </header>

    <!-- Loading -->
    <div v-if="loading" class="state-block" aria-busy="true">
      <span class="spinner" />
      <p class="state-title">
        กำลังโหลดรายการยา...
      </p>
      <p class="state-desc">
        กำลังดึงคลังรายการยาและประวัติการสั่งซื้อล่าสุด
      </p>
    </div>

    <!-- Error -->
    <EmptyState
      v-else-if="fetchError"
      is-error
      icon="alertCircle"
      title="โหลดรายการยาไม่สำเร็จ"
      :description="fetchError"
    >
      <button type="button" class="btn btn-ghost" @click="fetchCatalog">
        <AppIcon name="refresh" :size="16" />
        ลองใหม่อีกครั้ง
      </button>
    </EmptyState>

    <!-- Empty catalog -->
    <EmptyState
      v-else-if="draftItems.length === 0"
      icon="package"
      title="ยังไม่มีรายการยาในระบบ"
      description="กรุณานำเข้าข้อมูลยาก่อนเริ่มสร้างใบสั่งซื้อ"
    />

    <template v-else>
      <!-- Selection metrics -->
      <div class="stat-grid">
        <StatCard label="ยาในคลัง" :value="draftItems.length" hint="รายการทั้งหมด" icon="pill" tone="mint" />
        <StatCard label="เลือกแล้ว" :value="selectedCount" hint="รายการในใบสั่งซื้อนี้" icon="checkCircle" />
        <StatCard label="ประมาณการรวม" :value="`฿${formatMoney(selectedTotal)}`" hint="จากจำนวน × ราคาต่อหน่วย" icon="package" tone="peach" />
      </div>

      <!-- Toolbar -->
      <div class="toolbar">
        <div class="input-wrap search-field">
          <AppIcon name="search" :size="16" class="input-icon" />
          <input
            v-model="searchQuery"
            type="search"
            class="form-input"
            placeholder="ค้นหาชื่อยา รูปแบบ หรือความแรง..."
            aria-label="ค้นหายา"
            autocomplete="off"
          >
        </div>

        <div class="select-field">
          <select v-model="supplierFilter" class="form-select" aria-label="กรองตามบริษัท">
            <option value="">
              ทุกบริษัท
            </option>
            <option v-for="name in supplierNames" :key="name" :value="name">
              {{ name }}
            </option>
          </select>
        </div>

        <div class="toolbar-meta">
          <span>แสดง <strong>{{ filteredItems.length }}</strong> / {{ draftItems.length }} รายการ</span>
          <button v-if="selectedCount > 0" type="button" class="btn btn-subtle btn-sm" @click="clearAllSelections">
            ล้างการเลือก
          </button>
        </div>
      </div>

      <!-- Filtered to nothing -->
      <EmptyState
        v-if="filteredItems.length === 0"
        icon="search"
        title="ไม่พบรายการที่ตรงกับตัวกรอง"
        description="ลองเปลี่ยนคำค้นหาหรือเลือกบริษัทอื่น"
      >
        <button type="button" class="btn btn-ghost" @click="clearFilters">
          ล้างตัวกรอง
        </button>
      </EmptyState>

      <template v-else>
        <!-- Submit error banner -->
        <div v-if="submitError" class="alert alert-error submit-banner" role="alert">
          <AppIcon name="alertCircle" :size="17" />
          <span>{{ submitError }}</span>
        </div>

        <!-- Drug catalog -->
        <div class="table-wrap">
          <datalist id="supplier-list">
            <option v-for="name in supplierNames" :key="name" :value="name" />
          </datalist>

          <table class="data-table catalog-table">
            <caption class="sr-only">
              คลังรายการยา - เลือกและระบุจำนวนเพื่อสร้างใบสั่งซื้อ
            </caption>
            <thead>
              <tr>
                <th class="col-check" scope="col">
                  <input
                    class="table-checkbox"
                    type="checkbox"
                    :checked="isAllFilteredSelected"
                    :indeterminate="filteredSelectedCount > 0 && !isAllFilteredSelected"
                    :aria-label="`เลือกทุกรายการที่กรองอยู่ (${filteredItems.length} รายการ)`"
                    @change="toggleAllFiltered"
                  >
                </th>
                <th scope="col">
                  ชื่อยา
                </th>
                <th scope="col">
                  บริษัท <span class="required">*</span>
                </th>
                <th scope="col" class="num">
                  จำนวน
                </th>
                <th scope="col">
                  หน่วยนับ
                </th>
                <th scope="col" class="num">
                  ราคา/หน่วย (บาท)
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="item in pagedItems"
                :key="item.drug.id"
                :class="{ 'is-selected': item.isSelected, 'is-invalid': isItemInvalid(item) }"
              >
                <td class="col-check">
                  <input
                    class="table-checkbox"
                    type="checkbox"
                    :checked="item.isSelected"
                    :aria-label="`เลือก ${item.drug.name}`"
                    @change="toggleItem(item)"
                  >
                </td>

                <td class="col-drug" @click="toggleItem(item)">
                  <span class="row-title">{{ item.drug.name }}</span>
                  <span class="row-meta">
                    <template v-if="item.drug.form">{{ item.drug.form }}</template>
                    <template v-if="item.drug.form && item.drug.strength"> · </template>
                    <template v-if="item.drug.strength">{{ item.drug.strength }}</template>
                    <template v-if="!item.drug.form && !item.drug.strength">-</template>
                  </span>
                </td>

                <td>
                  <input
                    v-model="item.supplierName"
                    type="text"
                    class="form-input form-input-sm"
                    :class="{ 'is-invalid': isItemInvalid(item) && !item.supplierName.trim() }"
                    list="supplier-list"
                    placeholder="ระบุบริษัท..."
                    autocomplete="off"
                    :aria-label="`บริษัทของ ${item.drug.name}`"
                    @focus="item.isSelected = true"
                  >
                </td>

                <td class="num">
                  <input
                    v-model.number="item.quantity"
                    type="number"
                    min="1"
                    step="1"
                    class="form-input form-input-sm input-quantity"
                    :aria-label="`จำนวนของ ${item.drug.name}`"
                    @focus="item.isSelected = true"
                  >
                </td>

                <td>
                  <input
                    v-model="item.unitCount"
                    type="text"
                    class="form-input form-input-sm"
                    placeholder="เช่น กล่อง, แผง"
                    :aria-label="`หน่วยนับของ ${item.drug.name}`"
                    @focus="item.isSelected = true"
                  >
                </td>

                <td class="num">
                  <input
                    v-model.number="item.pricePerUnit"
                    type="number"
                    min="0"
                    step="0.01"
                    class="form-input form-input-sm input-price"
                    :aria-label="`ราคาต่อหน่วยของ ${item.drug.name}`"
                    @focus="item.isSelected = true"
                  >
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Pagination -->
        <div class="pagination">
          <span>แสดง {{ rangeStart }}-{{ rangeEnd }} จาก {{ filteredItems.length }} รายการ</span>

          <div class="page-controls">
            <label class="page-size">
              <span class="sr-only">จำนวนรายการต่อหน้า</span>
              <select v-model.number="pageSize" class="form-select form-select-sm" aria-label="จำนวนรายการต่อหน้า">
                <option :value="25">
                  25
                </option>
                <option :value="50">
                  50
                </option>
                <option :value="100">
                  100
                </option>
              </select>
            </label>

            <button
              type="button"
              class="btn btn-ghost btn-icon btn-sm"
              aria-label="หน้าก่อนหน้า"
              :disabled="page <= 1"
              @click="page -= 1"
            >
              <AppIcon name="chevronLeft" :size="15" />
            </button>
            <span class="page-indicator">{{ page }} / {{ totalPages }}</span>
            <button
              type="button"
              class="btn btn-ghost btn-icon btn-sm"
              aria-label="หน้าถัดไป"
              :disabled="page >= totalPages"
              @click="page += 1"
            >
              <AppIcon name="chevronRight" :size="15" />
            </button>
          </div>
        </div>
      </template>
    </template>

    <!-- Submit bar -->
    <div
      class="floating-bar"
      :class="{ 'is-visible': selectedCount > 0 }"
      :inert="selectedCount === 0 ? true : undefined"
      :aria-hidden="selectedCount === 0"
      role="region"
      aria-label="สรุปการเลือก"
    >
      <span class="bar-label">เลือกแล้ว</span>
      <span class="bar-count">{{ selectedCount }}</span>
      <span class="bar-label">รายการ</span>

      <span v-if="hasInvalidItems" class="bar-warning">
        <AppIcon name="alertTriangle" :size="14" />
        ข้อมูลไม่ครบ
      </span>
      <span v-else class="bar-total">≈ ฿{{ formatMoney(selectedTotal) }}</span>

      <button type="button" class="btn btn-subtle btn-sm" @click="clearAllSelections">
        ล้าง
      </button>
      <button
        type="button"
        class="btn btn-primary"
        :disabled="submitting || hasInvalidItems || selectedCount === 0"
        @click="handleSubmit"
      >
        <span v-if="submitting" class="spinner spinner-sm" />
        <AppIcon v-else name="check" :size="15" />
        {{ submitting ? 'กำลังสร้าง...' : `สร้างรายการ (${selectedCount})` }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.required {
  color: var(--danger);
}

.submit-banner {
  margin-bottom: 1rem;
}

/* ─── Catalog table ─── */
.catalog-table {
  min-width: 860px;
}

.col-drug {
  min-width: 220px;
  cursor: pointer;
}

.col-check {
  vertical-align: middle;
}

.form-input-sm {
  min-height: 34px;
  padding: 0.3rem 0.55rem;
  font-size: var(--text-sm);
}

.input-quantity {
  text-align: center;
  max-width: 90px;
  margin-left: auto;
}

.input-price {
  text-align: right;
  max-width: 120px;
  margin-left: auto;
}

.catalog-table tbody tr.is-invalid {
  background-color: var(--danger-soft);
}

/* ─── Pagination extras ─── */
.page-size .form-select-sm {
  min-height: 32px;
  padding: 0.2rem 1.9rem 0.2rem 0.6rem;
  font-size: var(--text-sm);
}

.bar-total {
  color: var(--text-2);
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.btn-primary .spinner-sm {
  border-color: color-mix(in srgb, var(--on-primary) 35%, transparent);
  border-top-color: var(--on-primary);
}

@media (max-width: 640px) {
  .floating-bar .bar-total,
  .floating-bar .bar-warning {
    display: none;
  }
}
</style>
