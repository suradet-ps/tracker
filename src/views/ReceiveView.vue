<!-- src/views/ReceiveView.vue -->
<script setup lang="ts">
import type { ReceivableOrder, ReceiveViewOrder } from '@/types/database';

import { computed, onMounted, ref } from 'vue';
import AppIcon from '@/components/ui/AppIcon.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import StatCard from '@/components/ui/StatCard.vue';
import { useNotificationStore } from '@/stores/notification';
import { useOrderCountsStore } from '@/stores/order-counts';
import { supabase } from '@/supabase/client';
import { formatDate } from '@/utils/date';

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
const loading = ref<boolean>(true);
const error = ref<string | null>(null);

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

  return dates.length > 0 ? formatDate(dates[0]) : '—';
});

/** Whether any filter is currently active */
const hasActiveFilter = computed<boolean>(
  () => searchQuery.value.trim() !== '' || supplierFilter.value !== '',
);

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function clearFilters(): void {
  searchQuery.value = '';
  supplierFilter.value = '';
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

    orders.value = ((data ?? []) as unknown as ReceiveViewOrder[]).map(toReceivableOrder);

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
    const { error: updateError } = await supabase
      .from('purchase_orders')
      .update({
        received_date: order.received_date_input,
        status: 'รับของแล้ว',
      })
      .eq('id', order.id);

    if (updateError) {
      throw updateError;
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

// ─────────────────────────────────────────────
// Lifecycle
// ─────────────────────────────────────────────

onMounted(fetchOrdersToReceive);
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <h1 class="page-title">
          รายการรอรับของ
        </h1>
        <p class="page-desc">
          บันทึกวันที่รับของจริงเพื่อปิดรายการ — รายการจะย้ายไปอยู่ในประวัติทันที
        </p>
      </div>
      <div class="page-actions">
        <button type="button" class="btn btn-ghost" :disabled="loading" @click="fetchOrdersToReceive">
          <AppIcon name="refresh" :size="16" />
          รีเฟรช
        </button>
      </div>
    </header>

    <!-- Loading -->
    <div v-if="loading" class="state-block" aria-busy="true">
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
      v-else-if="error"
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
      <!-- Queue metrics -->
      <div class="stat-grid">
        <StatCard label="รอรับของ" :value="orders.length" hint="รายการที่สั่งแล้ว" icon="truck" />
        <StatCard label="บริษัทผู้จำหน่าย" :value="supplierNames.length" hint="ในคิวรอรับ" icon="building" />
        <StatCard label="สั่งซื้อเก่าสุด" :value="oldestOrderDate" hint="ควรรีบติดตาม" icon="clock" />
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

      <!-- Receive table -->
      <div v-else class="table-wrap">
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
            <tr v-for="order in filteredOrders" :key="order.id">
              <td>
                <span class="row-title">{{ order.drugs.name }}</span>
                <span class="row-meta">
                  {{ order.drugs.form }} {{ order.drugs.strength }}
                  <template v-if="order.packaging"> · {{ order.packaging }}</template>
                </span>
              </td>
              <td>{{ order.suppliers.name }}</td>
              <td>{{ formatDate(order.order_date) }}</td>
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
                <button
                  type="button"
                  class="btn btn-primary btn-sm"
                  :disabled="!order.received_date_input || order.isSaving"
                  @click="markAsReceived(order)"
                >
                  <span v-if="order.isSaving" class="spinner spinner-sm" />
                  <AppIcon v-else name="check" :size="15" />
                  {{ order.isSaving ? 'กำลังบันทึก...' : 'บันทึก' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
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

.btn-primary .spinner-sm {
  border-color: color-mix(in srgb, var(--on-primary) 35%, transparent);
  border-top-color: var(--on-primary);
}
</style>
