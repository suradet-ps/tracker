<!-- src/views/ReceiveView.vue -->
<script setup lang="ts">
import type { ReceivableOrder, ReceiveViewOrder } from '@/types/database';

import { computed, onActivated, onDeactivated, ref, watch } from 'vue';
import AppIcon from '@/components/ui/AppIcon.vue';
import AppModal from '@/components/ui/AppModal.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import StatCard from '@/components/ui/StatCard.vue';
import { useNotificationStore } from '@/stores/notification';
import { useOrderCountsStore } from '@/stores/order-counts';
import { supabase } from '@/supabase/client';
import { bangkokTodayIso, formatDate } from '@/utils/date';

defineOptions({ name: 'ReceiveView' });

// ─────────────────────────────────────────────
// Stores
// ─────────────────────────────────────────────

const notificationStore = useNotificationStore();
const countsStore = useOrderCountsStore();

// ─────────────────────────────────────────────
// Reactive state
// ─────────────────────────────────────────────

const orders = ref<ReceivableOrder[]>([]);
const searchQuery = ref<string>('');
const supplierFilter = ref<string>('');
const page = ref<number>(1);
const pageSize = ref<number>(25);
const loading = ref<boolean>(true);
const error = ref<string | null>(null);
/** Order awaiting confirmation in the cancel dialog, if any. */
const orderToCancel = ref<ReceivableOrder | null>(null);
/** Whether the cancel update is in flight. */
const isCancelling = ref<boolean>(false);

// ─────────────────────────────────────────────
// Computed
// ─────────────────────────────────────────────

/**
 * Filters receivable orders by drug name and supplier name (both case-insensitive).
 * Returns all orders when both filters are empty.
 */
const filteredOrders = computed<ReceivableOrder[]>(() => {
  const query = searchQuery.value.trim().toLowerCase();
  const supplier = supplierFilter.value;

  if (!query && !supplier) {
    return orders.value;
  }

  return orders.value.filter((order) => {
    const drugText = `${order.drugs.name} ${order.drugs.form ?? ''} ${order.drugs.strength ?? ''}`.toLowerCase();
    const matchesName = !query || drugText.includes(query);
    const matchesSupplier = !supplier || order.suppliers.name === supplier;
    return matchesName && matchesSupplier;
  });
});

/** Unique supplier names present in the queue, for the filter select. */
const supplierNames = computed<string[]>(() =>
  [...new Set(orders.value.map(order => order.suppliers.name))]
    .sort((a, b) => a.localeCompare(b, 'th')),
);

/** Oldest pending order date, if any. */
const oldestOrderDate = computed<string>(() => {
  const dates = orders.value
    .map(order => order.order_date)
    .filter((date): date is string => Boolean(date))
    .sort();

  return dates.length > 0 ? formatDate(dates[0]) : '-';
});

/** Whether any filter is currently active */
const hasActiveFilter = computed<boolean>(
  () => searchQuery.value.trim() !== '' || supplierFilter.value !== '',
);

// ─────────────────────────────────────────────
// Pagination
// ─────────────────────────────────────────────

const totalPages = computed<number>(
  () => Math.max(1, Math.ceil(filteredOrders.value.length / pageSize.value)),
);

const pagedOrders = computed<ReceivableOrder[]>(() => {
  const start = (page.value - 1) * pageSize.value;
  return filteredOrders.value.slice(start, start + pageSize.value);
});

const rangeStart = computed<number>(
  () => (filteredOrders.value.length === 0 ? 0 : (page.value - 1) * pageSize.value + 1),
);

const rangeEnd = computed<number>(
  () => Math.min(page.value * pageSize.value, filteredOrders.value.length),
);

watch([searchQuery, supplierFilter, pageSize], () => {
  page.value = 1;
});

watch(totalPages, (max: number) => {
  if (page.value > max)
    page.value = max;
});

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/** Clears the search query and supplier filter. */
function clearFilters(): void {
  searchQuery.value = '';
  supplierFilter.value = '';
}

/** Queued for this many days or more gets the overdue chip. */
const OVERDUE_DAYS = 14;
const MS_PER_DAY = 86_400_000;

/** Whole days since an ISO order date, or 0 when the date is missing. */
function daysOverdue(orderDate: string | null): number {
  if (!orderDate)
    return 0;

  return Math.round(
    (Date.parse(`${bangkokTodayIso()}T00:00:00Z`) - Date.parse(`${orderDate}T00:00:00Z`)) / MS_PER_DAY,
  );
}

/** Today's date as the `YYYY-MM-DD` string an `<input type="date">` expects. */
function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * Converts a raw `ReceiveViewOrder` row into a `ReceivableOrder`
 * by augmenting it with local UI state fields.
 */
function toReceivableOrder(row: ReceiveViewOrder): ReceivableOrder {
  return {
    ...row,
    received_date_input: '',
    isSaving: false,
  };
}

// ─────────────────────────────────────────────
// Data fetching
// ─────────────────────────────────────────────

/** Loads the receiving queue and prunes a supplier filter that no longer exists. */
async function fetchOrdersToReceive(): Promise<void> {
  loading.value = true;
  error.value = null;

  try {
    const { data, error: dbError } = await supabase
      .from('purchase_orders')
      .select('id, order_date, packaging, drugs (*), suppliers (*)')
      .eq('status', 'สั่งแล้ว')
      .order('order_date', { ascending: true });

    if (dbError)
      throw dbError;

    // A background refresh can land while the user is typing receipt dates.
    // Carry those unsaved values across the replacement by order id.
    const pendingInputs = new Map(
      orders.value.map(order => [order.id, order.received_date_input]),
    );

    orders.value = ((data ?? []) as unknown as ReceiveViewOrder[]).map((row) => {
      const order = toReceivableOrder(row);
      order.received_date_input = pendingInputs.get(row.id) ?? '';
      return order;
    });

    // Never leave the supplier filter pointing at a name that no longer exists.
    if (supplierFilter.value && !supplierNames.value.includes(supplierFilter.value)) {
      supplierFilter.value = '';
    }
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
// Actions
// ─────────────────────────────────────────────

/**
 * Marks a single order as received by updating its status and
 * received date in the database, then removes it from the local list.
 */
async function markAsReceived(order: ReceivableOrder): Promise<void> {
  if (!order.received_date_input) {
    notificationStore.showNotification({
      message: `กรุณาเลือกวันที่รับของสำหรับ "${order.drugs.name}"`,
      type: 'error',
    });
    return;
  }

  order.isSaving = true;

  try {
    const { data: updated, error: updateError } = await supabase
      .from('purchase_orders')
      .update({
        received_date: order.received_date_input,
        status: 'รับของแล้ว',
      })
      .eq('id', order.id)
      .eq('status', 'สั่งแล้ว')
      .select('id');

    if (updateError) {
      throw updateError;
    }

    // A status-filtered update that matches nothing is not an error: the row
    // was received or cancelled from another session meanwhile.
    if (!updated || updated.length === 0) {
      notificationStore.showNotification({
        message: `รายการ "${order.drugs.name}" ถูกดำเนินการไปแล้วจากที่อื่น กรุณาตรวจสอบอีกครั้ง`,
        type: 'error',
      });
      await fetchOrdersToReceive();
      return;
    }

    // Remove the order from the local list after successful update
    orders.value = orders.value.filter(o => o.id !== order.id);
    notificationStore.showNotification({
      message: `บันทึกการรับของ "${order.drugs.name}" เรียบร้อย!`,
      type: 'success',
    });
    countsStore.refresh();
  }
  catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ';
    notificationStore.showNotification({
      message: `เกิดข้อผิดพลาด: ${message}`,
      type: 'error',
    });
  }
  finally {
    order.isSaving = false;
  }
}

/** Opens the confirmation dialog for cancelling `order`. */
function requestCancel(order: ReceivableOrder): void {
  orderToCancel.value = order;
}

/** Closes the cancel dialog; ignored while the update is in flight. */
function dismissCancel(): void {
  if (isCancelling.value)
    return;
  orderToCancel.value = null;
}

/**
 * Marks the confirmed order as cancelled. The row leaves the receiving
 * queue and stays in the history with the status ยกเลิก for audit.
 */
async function confirmCancel(): Promise<void> {
  const order = orderToCancel.value;
  if (!order)
    return;

  isCancelling.value = true;

  try {
    const { data: updated, error: updateError } = await supabase
      .from('purchase_orders')
      .update({ status: 'ยกเลิก' })
      .eq('id', order.id)
      .eq('status', 'สั่งแล้ว')
      .select('id');

    if (updateError)
      throw updateError;

    // The row was received or cancelled from another session meanwhile.
    if (!updated || updated.length === 0) {
      orderToCancel.value = null;
      notificationStore.showNotification({
        message: `รายการ "${order.drugs.name}" ถูกดำเนินการไปแล้วจากที่อื่น กรุณาตรวจสอบอีกครั้ง`,
        type: 'error',
      });
      await fetchOrdersToReceive();
      return;
    }

    orders.value = orders.value.filter(o => o.id !== order.id);
    orderToCancel.value = null;
    notificationStore.showNotification({
      message: `ยกเลิกรายการ "${order.drugs.name}" เรียบร้อย!`,
      type: 'success',
    });
    countsStore.refresh();
  }
  catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ';
    notificationStore.showNotification({
      message: `เกิดข้อผิดพลาด: ${message}`,
      type: 'error',
    });
  }
  finally {
    isCancelling.value = false;
  }
}

// ─────────────────────────────────────────────
// Lifecycle
// ─────────────────────────────────────────────

// Kept alive between routes: paint the cached queue, then refresh silently.
onActivated(fetchOrdersToReceive);

onDeactivated(() => {
  orderToCancel.value = null;
});
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <h1 class="page-title">
          รายการรอรับของ
        </h1>
        <p class="page-desc">
          บันทึกวันที่รับของจริงเพื่อปิดรายการ หรือยกเลิกรายการที่สั่งซื้อแล้วแต่ไม่ได้ของจริง - รายการจะย้ายไปอยู่ในประวัติทันที
        </p>
      </div>
      <div class="page-actions">
        <button type="button" class="btn btn-ghost" :disabled="loading" @click="fetchOrdersToReceive">
          <AppIcon name="refresh" :size="16" />
          รีเฟรช
        </button>
      </div>
    </header>

    <!-- Loading (first paint only: cached rows stay visible on refresh) -->
    <div v-if="loading && orders.length === 0" class="state-block" aria-busy="true">
      <span class="spinner" />
      <p class="state-title">
        กำลังโหลดรายการรอรับของ...
      </p>
      <p class="state-desc">
        กำลังดึงคำสั่งซื้อที่รอการยืนยันรับของ
      </p>
    </div>

    <!-- Error -->
    <EmptyState
      v-else-if="error && orders.length === 0"
      is-error
      icon="alertCircle"
      title="โหลดรายการไม่สำเร็จ"
      :description="error"
    >
      <button type="button" class="btn btn-ghost" @click="fetchOrdersToReceive">
        <AppIcon name="refresh" :size="16" />
        ลองใหม่อีกครั้ง
      </button>
    </EmptyState>

    <!-- Empty queue -->
    <EmptyState
      v-else-if="orders.length === 0"
      icon="truck"
      title="ไม่มีรายการที่รอรับของ"
      description="เมื่อสร้างใบสั่งซื้อแล้ว รายการจะปรากฏที่นี่เพื่อรอการยืนยันรับของ"
    />

    <template v-else>
      <!-- Background refresh failed: keep the queue usable and explain. -->
      <div v-if="error" class="alert alert-error alert-inline" role="alert">
        <AppIcon name="alertCircle" :size="17" />
        <span>{{ error }}</span>
      </div>

      <!-- Queue metrics -->
      <div class="stat-grid">
        <StatCard label="รอรับของ" :value="orders.length" hint="รายการที่สั่งแล้ว" icon="truck" />
        <StatCard label="บริษัทผู้จำหน่าย" :value="supplierNames.length" hint="ในคิวรอรับ" icon="building" tone="sand" />
        <StatCard label="สั่งซื้อเก่าสุด" :value="oldestOrderDate" hint="ควรรีบติดตาม" icon="clock" tone="peach" />
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
          <span>แสดง <strong>{{ filteredOrders.length }}</strong> / {{ orders.length }} รายการ</span>
          <button v-if="hasActiveFilter" type="button" class="btn btn-subtle btn-sm" @click="clearFilters">
            ล้างตัวกรอง
          </button>
        </div>
      </div>

      <!-- Filtered to nothing -->
      <EmptyState
        v-if="filteredOrders.length === 0"
        icon="search"
        title="ไม่พบรายการที่ตรงกับตัวกรอง"
        description="ลองเปลี่ยนคำค้นหาหรือเลือกบริษัทอื่น"
      >
        <button type="button" class="btn btn-ghost" @click="clearFilters">
          ล้างตัวกรอง
        </button>
      </EmptyState>

      <template v-else>
        <!-- Receive table -->
        <div class="table-wrap">
          <table class="data-table">
            <caption class="sr-only">
              รายการที่สั่งซื้อแล้วและรอการยืนยันรับของ
            </caption>
            <thead>
              <tr>
                <th scope="col">
                  ชื่อยา
                </th>
                <th scope="col">
                  บริษัท
                </th>
                <th scope="col">
                  วันที่สั่งซื้อ
                </th>
                <th scope="col">
                  วันที่รับของ
                </th>
                <th scope="col" class="col-actions">
                  <span class="sr-only">การจัดการ</span>
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
                  {{ formatDate(order.order_date) }}
                  <span
                    v-if="daysOverdue(order.order_date) >= OVERDUE_DAYS"
                    class="overdue-chip"
                  >
                    ค้าง {{ daysOverdue(order.order_date) }} วัน
                  </span>
                </td>
                <td>
                  <div class="date-cell">
                    <input
                      v-model="order.received_date_input"
                      type="date"
                      class="form-input form-input-sm"
                      :max="todayIso()"
                      :aria-label="`วันที่รับของ ${order.drugs.name}`"
                    >
                    <button
                      type="button"
                      class="btn btn-subtle btn-sm"
                      title="ตั้งวันที่เป็นวันนี้"
                      @click="order.received_date_input = todayIso()"
                    >
                      วันนี้
                    </button>
                  </div>
                </td>
                <td class="col-actions">
                  <div class="row-actions">
                    <button
                      type="button"
                      class="btn btn-danger-soft btn-icon btn-sm"
                      :disabled="order.isSaving || isCancelling"
                      :title="`ยกเลิกรายการ ${order.drugs.name}`"
                      :aria-label="`ยกเลิกรายการ ${order.drugs.name}`"
                      @click="requestCancel(order)"
                    >
                      <AppIcon name="x" :size="15" />
                    </button>
                    <button
                      type="button"
                      class="btn btn-primary btn-icon btn-sm"
                      :disabled="!order.received_date_input || order.isSaving"
                      :title="`บันทึกการรับของ ${order.drugs.name}`"
                      :aria-label="`บันทึกการรับของ ${order.drugs.name}`"
                      @click="markAsReceived(order)"
                    >
                      <span v-if="order.isSaving" class="spinner spinner-sm" />
                      <AppIcon v-else name="check" :size="15" />
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Pagination -->
        <div class="pagination">
          <span>แสดง {{ rangeStart }}-{{ rangeEnd }} จาก {{ filteredOrders.length }} รายการ</span>

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

    <!-- Cancel confirmation -->
    <AppModal
      v-if="orderToCancel"
      title="ยืนยันการยกเลิกรายการ"
      size="sm"
      @close="dismissCancel"
    >
      <p class="cancel-question">
        ยกเลิกรายการ "<strong>{{ orderToCancel.drugs.name }}</strong>"
        จาก {{ orderToCancel.suppliers.name }}?
      </p>
      <p class="cancel-hint">
        ใช้เมื่อสั่งซื้อแล้วแต่ไม่ได้รับยาจริง - รายการจะออกจากคิวรอรับของ
        และยังอยู่ในประวัติพร้อมสถานะ "ยกเลิก"
      </p>

      <template #footer>
        <button type="button" class="btn btn-ghost" :disabled="isCancelling" @click="dismissCancel">
          ปิด
        </button>
        <button type="button" class="btn btn-danger" :disabled="isCancelling" @click="confirmCancel">
          <span v-if="isCancelling" class="spinner spinner-sm" />
          <AppIcon v-else name="x" :size="15" />
          {{ isCancelling ? 'กำลังบันทึก...' : 'ยืนยันยกเลิก' }}
        </button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.date-cell {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  white-space: nowrap;
}

.form-input-sm {
  min-height: 34px;
  padding: 0.3rem 0.5rem;
  font-size: var(--text-sm);
}

.row-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.4rem;
}

/* Urgency chip next to the order date once a queue entry passes OVERDUE_DAYS. */
.overdue-chip {
  display: inline-block;
  margin-left: 0.4rem;
  padding: 0.05rem 0.45rem;
  border-radius: var(--radius-full);
  background-color: var(--danger-soft);
  color: var(--danger);
  font-size: var(--text-xs);
  font-weight: 500;
  white-space: nowrap;
}

.cancel-question {
  margin: 0 0 0.5rem;
  color: var(--text);
}

.cancel-hint {
  margin: 0;
  color: var(--text-2);
  font-size: var(--text-sm);
}

.btn-primary .spinner-sm {
  border-color: color-mix(in srgb, var(--on-primary) 35%, transparent);
  border-top-color: var(--on-primary);
}

.btn-danger .spinner-sm {
  border-color: color-mix(in srgb, #ffffff 35%, transparent);
  border-top-color: #ffffff;
}
</style>
