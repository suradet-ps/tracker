<!-- src/views/HistoryView.vue -->
<script setup lang="ts">
import type { HistoryViewOrder, PurchaseOrderStatus } from '@/types/database';

import { computed, onMounted, ref, watch } from 'vue';
import AppIcon from '@/components/ui/AppIcon.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import StatCard from '@/components/ui/StatCard.vue';
import StatusBadge from '@/components/ui/StatusBadge.vue';
import TableSkeleton from '@/components/ui/TableSkeleton.vue';
import { supabase } from '@/supabase/client';
import { formatDate } from '@/utils/date';

type SortKey = 'name' | 'supplier' | 'status' | 'orderDate' | 'receivedDate';
type SortDirection = 'asc' | 'desc';
type StatusFilter = 'all' | PurchaseOrderStatus;

// ─────────────────────────────────────────────
// Reactive state
// ─────────────────────────────────────────────

const allOrders = ref<HistoryViewOrder[]>([]);
const searchQuery = ref<string>('');
const supplierFilter = ref<string>('');
const statusFilter = ref<StatusFilter>('all');
const sortKey = ref<SortKey | null>(null);
const sortDirection = ref<SortDirection>('asc');
const page = ref<number>(1);
const pageSize = ref<number>(25);
const loading = ref<boolean>(true);
const error = ref<string | null>(null);

// ─────────────────────────────────────────────
// Computed
// ─────────────────────────────────────────────

const statusCounts = computed<Record<StatusFilter, number>>(() => {
  const counts: Record<StatusFilter, number> = {
    all: allOrders.value.length,
    ต้องสั่งซื้อ: 0,
    สั่งแล้ว: 0,
    รับของแล้ว: 0,
  };

  for (const order of allOrders.value) {
    counts[order.status] += 1;
  }

  return counts;
});

const statusChips: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'ทั้งหมด' },
  { value: 'ต้องสั่งซื้อ', label: 'ต้องสั่งซื้อ' },
  { value: 'สั่งแล้ว', label: 'สั่งแล้ว' },
  { value: 'รับของแล้ว', label: 'รับของแล้ว' },
];

/** Unique supplier names present in the history, for the filter select. */
const supplierNames = computed<string[]>(() =>
  [...new Set(allOrders.value.map(order => order.suppliers.name))]
    .sort((a, b) => a.localeCompare(b, 'th')),
);

const STATUS_RANK: Record<PurchaseOrderStatus, number> = {
  ต้องสั่งซื้อ: 0,
  สั่งแล้ว: 1,
  รับของแล้ว: 2,
};

/** Filters and (optionally) sorts the history. */
const filteredOrders = computed<HistoryViewOrder[]>(() => {
  const query = searchQuery.value.trim().toLowerCase();
  const supplier = supplierFilter.value;

  const filtered = allOrders.value.filter((order) => {
    const drugText = `${order.drugs.name} ${order.drugs.form ?? ''} ${order.drugs.strength ?? ''}`.toLowerCase();
    const matchesQuery = !query || drugText.includes(query);
    const matchesSupplier = !supplier || order.suppliers.name === supplier;
    const matchesStatus = statusFilter.value === 'all' || order.status === statusFilter.value;
    return matchesQuery && matchesSupplier && matchesStatus;
  });

  // Default view keeps the server order (newest first).
  if (sortKey.value === null)
    return filtered;

  const direction = sortDirection.value === 'asc' ? 1 : -1;

  return [...filtered].sort((a, b) => {
    switch (sortKey.value) {
      case 'supplier':
        return a.suppliers.name.localeCompare(b.suppliers.name, 'th') * direction;
      case 'status':
        return (STATUS_RANK[a.status] - STATUS_RANK[b.status]) * direction;
      case 'orderDate':
        return compareNullableDates(a.order_date, b.order_date, direction);
      case 'receivedDate':
        return compareNullableDates(a.received_date, b.received_date, direction);
      case 'name':
      default:
        return a.drugs.name.localeCompare(b.drugs.name, 'th') * direction;
    }
  });
});

const hasActiveFilter = computed<boolean>(
  () => searchQuery.value.trim() !== '' || supplierFilter.value !== '' || statusFilter.value !== 'all',
);

// ─────────────────────────────────────────────
// Pagination
// ─────────────────────────────────────────────

const totalPages = computed<number>(
  () => Math.max(1, Math.ceil(filteredOrders.value.length / pageSize.value)),
);

const pagedOrders = computed<HistoryViewOrder[]>(() => {
  const start = (page.value - 1) * pageSize.value;
  return filteredOrders.value.slice(start, start + pageSize.value);
});

const rangeStart = computed<number>(
  () => (filteredOrders.value.length === 0 ? 0 : (page.value - 1) * pageSize.value + 1),
);

const rangeEnd = computed<number>(
  () => Math.min(page.value * pageSize.value, filteredOrders.value.length),
);

watch([searchQuery, supplierFilter, statusFilter, pageSize, sortKey, sortDirection], () => {
  page.value = 1;
});

watch(totalPages, (max: number) => {
  if (page.value > max)
    page.value = max;
});

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function compareNullableDates(a: string | null, b: string | null, direction: number): number {
  if (!a && !b)
    return 0;
  if (!a)
    return 1;
  if (!b)
    return -1;
  return a.localeCompare(b) * direction;
}

function clearFilters(): void {
  searchQuery.value = '';
  supplierFilter.value = '';
  statusFilter.value = 'all';
}

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

async function fetchHistory(): Promise<void> {
  loading.value = true;
  error.value = null;

  try {
    const { data, error: dbError } = await supabase
      .from('purchase_orders')
      .select('id, status, order_date, received_date, packaging, drugs (*), suppliers (*)')
      .order('created_at', { ascending: false });

    if (dbError)
      throw dbError;

    allOrders.value = (data ?? []) as unknown as HistoryViewOrder[];
  }
  catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ';
    error.value = `ไม่สามารถดึงประวัติได้: ${message}`;
  }
  finally {
    loading.value = false;
  }
}

// ─────────────────────────────────────────────
// Lifecycle
// ─────────────────────────────────────────────

onMounted(fetchHistory);
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <h1 class="page-title">
          ประวัติการสั่งซื้อ
        </h1>
        <p class="page-desc">
          ทุกคำสั่งซื้อพร้อมสถานะและวันที่ — ค้นหาเพื่อตรวจสอบย้อนหลังได้เสมอ
        </p>
      </div>
      <div class="page-actions">
        <button type="button" class="btn btn-ghost" :disabled="loading" @click="fetchHistory">
          <AppIcon name="refresh" :size="16" />
          รีเฟรช
        </button>
      </div>
    </header>

    <!-- Loading -->
    <template v-if="loading">
      <div class="stat-grid">
        <div v-for="card in 4" :key="card" class="stat-card">
          <span class="skeleton" style="width: 36px; height: 36px; border-radius: 8px;" />
          <div style="flex: 1;">
            <span class="skeleton skeleton-line" style="width: 55%;" />
            <span class="skeleton skeleton-line" style="width: 35%; margin-top: 6px;" />
          </div>
        </div>
      </div>
      <TableSkeleton :rows="8" :columns="5" />
    </template>

    <!-- Error -->
    <EmptyState
      v-else-if="error"
      is-error
      icon="alertCircle"
      title="โหลดประวัติไม่สำเร็จ"
      :description="error"
    >
      <button type="button" class="btn btn-ghost" @click="fetchHistory">
        <AppIcon name="refresh" :size="16" />
        ลองใหม่อีกครั้ง
      </button>
    </EmptyState>

    <!-- Empty history -->
    <EmptyState
      v-else-if="allOrders.length === 0"
      icon="history"
      title="ยังไม่มีประวัติการสั่งซื้อ"
      description="เมื่อมีการสร้างและรับของ รายการทั้งหมดจะแสดงที่นี่"
    />

    <template v-else>
      <!-- Metrics -->
      <div class="stat-grid">
        <StatCard label="รายการทั้งหมด" :value="statusCounts.all" hint="ทุกสถานะ" icon="list" />
        <StatCard label="ต้องสั่งซื้อ" :value="statusCounts['ต้องสั่งซื้อ']" hint="รอสร้างใบสั่งซื้อ" icon="clipboardList" />
        <StatCard label="สั่งแล้ว" :value="statusCounts['สั่งแล้ว']" hint="รอรับของ" icon="truck" />
        <StatCard label="รับของแล้ว" :value="statusCounts['รับของแล้ว']" hint="ปิดรายการแล้ว" icon="checkCircle" />
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
          <span>แสดง <strong>{{ filteredOrders.length }}</strong> / {{ allOrders.length }} รายการ</span>
          <button v-if="hasActiveFilter" type="button" class="btn btn-subtle btn-sm" @click="clearFilters">
            ล้างตัวกรอง
          </button>
        </div>
      </div>

      <!-- Status chips -->
      <div class="chip-row status-chips">
        <button
          v-for="chip in statusChips"
          :key="chip.value"
          type="button"
          class="chip"
          :class="{ 'is-active': statusFilter === chip.value }"
          :aria-pressed="statusFilter === chip.value"
          @click="statusFilter = chip.value"
        >
          {{ chip.label }}
          <span class="badge badge-count">{{ statusCounts[chip.value] }}</span>
        </button>
      </div>

      <!-- Filtered to nothing -->
      <EmptyState
        v-if="filteredOrders.length === 0"
        icon="search"
        title="ไม่พบรายการที่ตรงกับตัวกรอง"
        description="ลองเปลี่ยนคำค้นหา สถานะ หรือบริษัท"
      >
        <button type="button" class="btn btn-ghost" @click="clearFilters">
          ล้างตัวกรอง
        </button>
      </EmptyState>

      <template v-else>
        <!-- History table -->
        <div class="table-wrap">
          <table class="data-table">
            <caption class="sr-only">
              ประวัติการสั่งซื้อทั้งหมด
            </caption>
            <thead>
              <tr>
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
                <th scope="col" class="sortable" :aria-sort="ariaSort('status')">
                  <button type="button" class="sort-button" :class="{ 'is-active': sortKey === 'status' }" @click="toggleSort('status')">
                    สถานะ
                    <AppIcon :name="sortIcon('status')" :size="13" class="sort-icon" />
                  </button>
                </th>
                <th scope="col" class="sortable" :aria-sort="ariaSort('orderDate')">
                  <button type="button" class="sort-button" :class="{ 'is-active': sortKey === 'orderDate' }" @click="toggleSort('orderDate')">
                    วันที่สั่งซื้อ
                    <AppIcon :name="sortIcon('orderDate')" :size="13" class="sort-icon" />
                  </button>
                </th>
                <th scope="col" class="sortable" :aria-sort="ariaSort('receivedDate')">
                  <button type="button" class="sort-button" :class="{ 'is-active': sortKey === 'receivedDate' }" @click="toggleSort('receivedDate')">
                    วันที่รับของ
                    <AppIcon :name="sortIcon('receivedDate')" :size="13" class="sort-icon" />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="order in pagedOrders" :key="order.id">
                <td>
                  <span class="row-title">{{ order.drugs.name }}</span>
                  <span class="row-meta">
                    {{ order.drugs.form }} {{ order.drugs.strength }}
                    <template v-if="order.packaging"> · {{ order.packaging }}</template>
                  </span>
                </td>
                <td>{{ order.suppliers.name }}</td>
                <td>
                  <StatusBadge :status="order.status" />
                </td>
                <td>{{ formatDate(order.order_date) }}</td>
                <td>{{ formatDate(order.received_date) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Pagination -->
        <div class="pagination">
          <span>แสดง {{ rangeStart }}–{{ rangeEnd }} จาก {{ filteredOrders.length }} รายการ</span>

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
  </div>
</template>

<style scoped>
.status-chips {
  margin-bottom: 1rem;
}

.page-size .form-select-sm {
  min-height: 32px;
  padding: 0.2rem 1.9rem 0.2rem 0.6rem;
  font-size: var(--text-sm);
}
</style>
