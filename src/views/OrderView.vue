<!-- src/views/OrderView.vue -->
<script setup lang="ts">
import type { GroupedOrders, OrderViewOrder } from '@/types/database';

import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import AddOrderForm from '@/components/AddOrderForm.vue';
import OrderSummaryModal from '@/components/OrderSummaryModal.vue';
import AppIcon from '@/components/ui/AppIcon.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import StatCard from '@/components/ui/StatCard.vue';
import TableSkeleton from '@/components/ui/TableSkeleton.vue';
import { useNotificationStore } from '@/stores/notification';
import { useOrderCountsStore } from '@/stores/order-counts';
import { supabase } from '@/supabase/client';
import { formatMoney, formatQuantity } from '@/utils/number';

type SortKey = 'name' | 'supplier' | 'quantity' | 'total';
type SortDirection = 'asc' | 'desc';

// ─────────────────────────────────────────────
// Stores & router
// ─────────────────────────────────────────────

const notificationStore = useNotificationStore();
const countsStore = useOrderCountsStore();
const router = useRouter();

// ─────────────────────────────────────────────
// Reactive state
// ─────────────────────────────────────────────

const orders = ref<OrderViewOrder[]>([]);
const loading = ref<boolean>(true);
const error = ref<string | null>(null);
const showAddForm = ref<boolean>(false);
const selectedOrderIds = ref<Set<number>>(new Set());
const isModalVisible = ref<boolean>(false);

const searchQuery = ref<string>('');
const supplierFilter = ref<string>('');
const sortKey = ref<SortKey>('name');
const sortDirection = ref<SortDirection>('asc');

// ─────────────────────────────────────────────
// Computed
// ─────────────────────────────────────────────

/** Sorted, filtered view of the pending-order queue. */
const visibleOrders = computed<OrderViewOrder[]>(() => {
  const query = searchQuery.value.trim().toLowerCase();
  const supplier = supplierFilter.value;

  const filtered = orders.value.filter((order) => {
    const drugText = `${order.drugs.name} ${order.drugs.form ?? ''} ${order.drugs.strength ?? ''}`.toLowerCase();
    const matchesQuery = !query || drugText.includes(query);
    const matchesSupplier = !supplier || order.suppliers.name === supplier;
    return matchesQuery && matchesSupplier;
  });

  const direction = sortDirection.value === 'asc' ? 1 : -1;

  return [...filtered].sort((a, b) => {
    switch (sortKey.value) {
      case 'supplier':
        return a.suppliers.name.localeCompare(b.suppliers.name, 'th') * direction;
      case 'quantity':
        return (a.quantity - b.quantity) * direction;
      case 'total':
        return ((a.total_price ?? 0) - (b.total_price ?? 0)) * direction;
      case 'name':
      default:
        return a.drugs.name.localeCompare(b.drugs.name, 'th') * direction;
    }
  });
});

/** Unique supplier names present in the queue, for the filter select. */
const supplierNames = computed<string[]>(() =>
  [...new Set(orders.value.map(order => order.suppliers.name))]
    .sort((a, b) => a.localeCompare(b, 'th')),
);

const totalAmount = computed<number>(() =>
  orders.value.reduce((sum, order) => sum + (order.total_price ?? 0), 0),
);

const hasActiveFilter = computed<boolean>(
  () => searchQuery.value.trim() !== '' || supplierFilter.value !== '',
);

const selectedCount = computed<number>(() => selectedOrderIds.value.size);

const isAllVisibleSelected = computed<boolean>(() =>
  visibleOrders.value.length > 0
  && visibleOrders.value.every(order => selectedOrderIds.value.has(order.id)),
);

const isSomeVisibleSelected = computed<boolean>(() =>
  !isAllVisibleSelected.value
  && visibleOrders.value.some(order => selectedOrderIds.value.has(order.id)),
);

/**
 * Groups the currently selected orders by supplier name.
 * Used as the prop for `OrderSummaryModal`.
 */
const groupedSelectedOrders = computed<GroupedOrders>(() => {
  const grouped: GroupedOrders = {};

  const selected = orders.value.filter(order => selectedOrderIds.value.has(order.id));

  for (const order of selected) {
    const supplierName = order.suppliers.name;

    if (!grouped[supplierName]) {
      grouped[supplierName] = { orders: [] };
    }

    grouped[supplierName]!.orders.push(order);
  }

  return grouped;
});

// ─────────────────────────────────────────────
// Sorting helpers
// ─────────────────────────────────────────────

function toggleSort(key: SortKey): void {
  if (sortKey.value === key) {
    sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc';
  }
  else {
    sortKey.value = key;
    sortDirection.value = 'asc';
  }
}

function ariaSort(key: SortKey): 'ascending' | 'descending' | 'none' {
  if (sortKey.value !== key)
    return 'none';
  return sortDirection.value === 'asc' ? 'ascending' : 'descending';
}

function sortIcon(key: SortKey): 'arrowUp' | 'arrowDown' | 'arrowUpDown' {
  if (sortKey.value !== key)
    return 'arrowUpDown';
  return sortDirection.value === 'asc' ? 'arrowUp' : 'arrowDown';
}

// ─────────────────────────────────────────────
// Data fetching
// ─────────────────────────────────────────────

async function fetchOrdersToBuy(): Promise<void> {
  try {
    loading.value = true;
    error.value = null;

    const { data, error: dbError } = await supabase
      .from('purchase_orders')
      .select('id, quantity, unit_count, price_per_unit, total_price, packaging, drugs (*), suppliers (*)')
      .eq('status', 'ต้องสั่งซื้อ')
      .order('created_at', { ascending: true });

    if (dbError)
      throw dbError;

    orders.value = (data ?? []) as unknown as OrderViewOrder[];

    // Drop selections whose rows left the queue.
    const currentIds = new Set(orders.value.map(order => order.id));
    selectedOrderIds.value = new Set(
      [...selectedOrderIds.value].filter(id => currentIds.has(id)),
    );
  }
  catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ';
    error.value = `ไม่สามารถดึงรายการได้: ${message}`;
  }
  finally {
    loading.value = false;
  }
}

// ─────────────────────────────────────────────
// Filter & selection actions
// ─────────────────────────────────────────────

function clearFilters(): void {
  searchQuery.value = '';
  supplierFilter.value = '';
}

function toggleSelectAllVisible(event: Event): void {
  const checked = (event.target as HTMLInputElement).checked;
  const next = new Set(selectedOrderIds.value);

  for (const order of visibleOrders.value) {
    if (checked)
      next.add(order.id);
    else
      next.delete(order.id);
  }

  selectedOrderIds.value = next;
}

function toggleSelection(id: number): void {
  const next = new Set(selectedOrderIds.value);

  if (next.has(id)) {
    next.delete(id);
  }
  else {
    next.add(id);
  }

  selectedOrderIds.value = next;
}

function clearSelection(): void {
  selectedOrderIds.value = new Set();
}

function openSummaryModal(): void {
  if (selectedOrderIds.value.size > 0) {
    isModalVisible.value = true;
  }
}

// ─────────────────────────────────────────────
// Event handlers from child components
// ─────────────────────────────────────────────

function handleOrderAdded(): void {
  showAddForm.value = false;
  notificationStore.showNotification({ message: 'เพิ่มรายการใหม่เรียบร้อย!', type: 'success' });
  fetchOrdersToBuy();
  countsStore.refresh();
}

function handleOrdersSent(): void {
  isModalVisible.value = false;
  clearSelection();
  notificationStore.showNotification({ message: 'ส่งคำสั่งซื้อสำเร็จ!', type: 'success' });
  fetchOrdersToBuy();
  countsStore.refresh();
}

// ─────────────────────────────────────────────
// Lifecycle
// ─────────────────────────────────────────────

onMounted(fetchOrdersToBuy);
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <h1 class="page-title">
          รายการที่ต้องสั่งซื้อ
        </h1>
        <p class="page-desc">
          เลือกรายการยาเพื่อสร้างใบสั่งซื้อ จากนั้นระบบจะแจ้งเตือนผ่าน Telegram
          ให้บริษัทผู้จำหน่ายทราบทันที
        </p>
      </div>
      <div class="page-actions">
        <button type="button" class="btn btn-ghost" @click="showAddForm = true">
          <AppIcon name="plus" :size="16" />
          เพิ่มรายการด้วยตนเอง
        </button>
        <button type="button" class="btn btn-primary" @click="router.push({ name: 'QuickOrder' })">
          <AppIcon name="zap" :size="16" />
          สร้างใบสั่งซื้อด่วน
        </button>
      </div>
    </header>

    <!-- Loading -->
    <template v-if="loading">
      <div class="stat-grid">
        <div v-for="card in 3" :key="card" class="stat-card">
          <span class="skeleton" style="width: 36px; height: 36px; border-radius: 8px;" />
          <div style="flex: 1;">
            <span class="skeleton skeleton-line" style="width: 55%;" />
            <span class="skeleton skeleton-line" style="width: 35%; margin-top: 6px;" />
          </div>
        </div>
      </div>
      <TableSkeleton :rows="6" :columns="5" />
    </template>

    <!-- Error -->
    <EmptyState
      v-else-if="error"
      is-error
      icon="alertCircle"
      title="โหลดรายการไม่สำเร็จ"
      :description="error"
    >
      <button type="button" class="btn btn-ghost" @click="fetchOrdersToBuy">
        <AppIcon name="refresh" :size="16" />
        ลองใหม่อีกครั้ง
      </button>
    </EmptyState>

    <!-- Empty queue -->
    <EmptyState
      v-else-if="orders.length === 0"
      icon="checkCircle"
      title="ไม่มีรายการที่ต้องสั่งซื้อ"
      description="ทุกรายการถูกดำเนินการแล้ว — เพิ่มรายการใหม่เพื่อเริ่มรอบถัดไป"
    >
      <button type="button" class="btn btn-primary" @click="showAddForm = true">
        <AppIcon name="plus" :size="16" />
        เพิ่มรายการด้วยตนเอง
      </button>
      <button type="button" class="btn btn-ghost" @click="router.push({ name: 'QuickOrder' })">
        <AppIcon name="zap" :size="16" />
        สร้างใบสั่งซื้อด่วน
      </button>
    </EmptyState>

    <template v-else>
      <!-- Queue metrics -->
      <div class="stat-grid">
        <StatCard label="รายการค้างสั่ง" :value="orders.length" hint="รอสร้างใบสั่งซื้อ" icon="clipboardList" />
        <StatCard label="มูลค่ารวม" :value="`฿${formatMoney(totalAmount)}`" hint="จากราคาประเมินล่าสุด" icon="package" />
        <StatCard label="บริษัทผู้จำหน่าย" :value="supplierNames.length" hint="ในรายการค้างสั่ง" icon="building" />
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
          <span>แสดง <strong>{{ visibleOrders.length }}</strong> / {{ orders.length }} รายการ</span>
          <button v-if="hasActiveFilter" type="button" class="btn btn-subtle btn-sm" @click="clearFilters">
            ล้างตัวกรอง
          </button>
        </div>
      </div>

      <!-- Filtered to nothing -->
      <EmptyState
        v-if="visibleOrders.length === 0"
        icon="search"
        title="ไม่พบรายการที่ตรงกับตัวกรอง"
        description="ลองเปลี่ยนคำค้นหาหรือเลือกบริษัทอื่น"
      >
        <button type="button" class="btn btn-ghost" @click="clearFilters">
          ล้างตัวกรอง
        </button>
      </EmptyState>

      <!-- Queue table -->
      <div v-else class="table-wrap">
        <table class="data-table">
          <caption class="sr-only">
            รายการยาที่ต้องสั่งซื้อ
          </caption>
          <thead>
            <tr>
              <th class="col-check" scope="col">
                <input
                  class="table-checkbox"
                  type="checkbox"
                  :checked="isAllVisibleSelected"
                  :indeterminate="isSomeVisibleSelected"
                  aria-label="เลือกทุกรายการที่แสดงอยู่"
                  @change="toggleSelectAllVisible"
                >
              </th>
              <th scope="col" class="sortable" :aria-sort="ariaSort('name')">
                <button type="button" class="sort-button" :class="{ 'is-active': sortKey === 'name' }" @click="toggleSort('name')">
                  ชื่อยา
                  <AppIcon :name="sortIcon('name')" :size="13" class="sort-icon" />
                </button>
              </th>
              <th scope="col" class="sortable" :aria-sort="ariaSort('supplier')">
                <button type="button" class="sort-button" :class="{ 'is-active': sortKey === 'supplier' }" @click="toggleSort('supplier')">
                  บริษัท
                  <AppIcon :name="sortIcon('supplier')" :size="13" class="sort-icon" />
                </button>
              </th>
              <th scope="col" class="sortable num" :aria-sort="ariaSort('quantity')">
                <button type="button" class="sort-button sort-button-num" :class="{ 'is-active': sortKey === 'quantity' }" @click="toggleSort('quantity')">
                  จำนวน
                  <AppIcon :name="sortIcon('quantity')" :size="13" class="sort-icon" />
                </button>
              </th>
              <th scope="col" class="sortable num" :aria-sort="ariaSort('total')">
                <button type="button" class="sort-button sort-button-num" :class="{ 'is-active': sortKey === 'total' }" @click="toggleSort('total')">
                  ราคารวม
                  <AppIcon :name="sortIcon('total')" :size="13" class="sort-icon" />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="order in visibleOrders"
              :key="order.id"
              :class="{ 'is-selected': selectedOrderIds.has(order.id) }"
            >
              <td class="col-check">
                <input
                  class="table-checkbox"
                  type="checkbox"
                  :checked="selectedOrderIds.has(order.id)"
                  :aria-label="`เลือก ${order.drugs.name}`"
                  @change="toggleSelection(order.id)"
                >
              </td>
              <td>
                <span class="row-title">{{ order.drugs.name }}</span>
                <span class="row-meta">
                  {{ order.drugs.form }} {{ order.drugs.strength }}
                  <template v-if="order.packaging"> · {{ order.packaging }}</template>
                </span>
              </td>
              <td>{{ order.suppliers.name }}</td>
              <td class="num">
                {{ formatQuantity(order.quantity) }} × {{ order.unit_count }}
              </td>
              <td class="num">
                <strong>{{ formatMoney(order.total_price) }}</strong>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <!-- Bulk action bar -->
    <div
      class="floating-bar"
      :class="{ 'is-visible': selectedCount > 0 }"
      :inert="selectedCount === 0 ? true : undefined"
      :aria-hidden="selectedCount === 0"
      role="region"
      aria-label="การจัดการรายการที่เลือก"
    >
      <span class="bar-label">เลือกแล้ว</span>
      <span class="bar-count">{{ selectedCount }}</span>
      <span class="bar-label">รายการ</span>
      <button type="button" class="btn btn-subtle btn-sm" @click="clearSelection">
        ล้างการเลือก
      </button>
      <button type="button" class="btn btn-primary" :disabled="selectedCount === 0" @click="openSummaryModal">
        <AppIcon name="send" :size="15" />
        สร้างใบสั่งซื้อ
      </button>
    </div>

    <AddOrderForm v-if="showAddForm" @close="showAddForm = false" @order-added="handleOrderAdded" />

    <OrderSummaryModal
      v-if="isModalVisible"
      :grouped-orders="groupedSelectedOrders"
      @close="isModalVisible = false"
      @orders-sent="handleOrdersSent"
    />
  </div>
</template>

<style scoped>
.sort-button-num {
  justify-content: flex-end;
}
</style>
