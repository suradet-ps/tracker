<!-- src/views/AutoPlanView.vue -->
<script setup lang="ts">
import type {
  AutoOrderFunctionResponse,
  AutoOrderPlanWithRelations,
  AutoOrderRunResult,
  AutoOrderRunWithRelations,
} from '@/types/database';

import { computed, onMounted, ref, watch } from 'vue';
import AutoPlanForm from '@/components/AutoPlanForm.vue';
import AppIcon from '@/components/ui/AppIcon.vue';
import AppModal from '@/components/ui/AppModal.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import StatCard from '@/components/ui/StatCard.vue';
import { useNotificationStore } from '@/stores/notification';
import { useOrderCountsStore } from '@/stores/order-counts';
import { supabase } from '@/supabase/client';
import { bangkokTodayIso, formatDate } from '@/utils/date';
import { formatMoney, formatQuantity } from '@/utils/number';

type StatusFilter = 'all' | 'active' | 'paused';

const notificationStore = useNotificationStore();
const countsStore = useOrderCountsStore();

// ─────────────────────────────────────────────
// State
// ─────────────────────────────────────────────

const plans = ref<AutoOrderPlanWithRelations[]>([]);
const loading = ref<boolean>(true);
const error = ref<string | null>(null);
const searchQuery = ref<string>('');
const statusFilter = ref<StatusFilter>('all');
const page = ref<number>(1);
const pageSize = ref<number>(25);
/** Cached Bangkok date; refreshed on every plan fetch. */
const today = ref<string>(bangkokTodayIso());

const showForm = ref<boolean>(false);
const editingPlan = ref<AutoOrderPlanWithRelations | null>(null);

const planToDelete = ref<AutoOrderPlanWithRelations | null>(null);
const isDeleting = ref<boolean>(false);

const runTarget = ref<AutoOrderPlanWithRelations | null>(null);
const runningMode = ref<'dry' | 'real' | null>(null);
const isRunning = computed<boolean>(() => runningMode.value !== null);
const runError = ref<string | null>(null);
const dryRunResult = ref<AutoOrderRunResult | null>(null);
const togglingId = ref<number | null>(null);

const showRuns = ref<boolean>(false);
const runs = ref<AutoOrderRunWithRelations[]>([]);
const runsLoading = ref<boolean>(false);
const runsError = ref<string | null>(null);

const OVERDUE_DAYS = 14;
const MS_PER_DAY = 86_400_000;

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function daysUntil(isoDate: string): number {
  return Math.round(
    (Date.parse(`${isoDate}T00:00:00Z`) - Date.parse(`${today.value}T00:00:00Z`)) / MS_PER_DAY,
  );
}

/** Quantity the plan will create each cycle (same formula as the edge function). */
function orderQuantity(plan: AutoOrderPlanWithRelations): number {
  const monthly = plan.usage_quantity / plan.usage_months;
  return Math.max(1, Math.ceil(monthly * plan.interval_months));
}

function cycleValue(plan: AutoOrderPlanWithRelations): number {
  return orderQuantity(plan) * plan.price_per_unit;
}

function dueLabel(plan: AutoOrderPlanWithRelations, days: number = daysUntil(plan.next_order_date)): string | null {
  if (!plan.is_active)
    return null;

  if (days < 0)
    return `เลยกำหนด ${Math.abs(days)} วัน`;
  if (days === 0)
    return 'ครบกำหนดวันนี้';
  if (days <= OVERDUE_DAYS)
    return `อีก ${days} วัน`;

  return null;
}

function runStatusLabel(status: AutoOrderRunWithRelations['status']): string {
  switch (status) {
    case 'skipped_open_draft':
      return 'ข้ามรอบ';
    case 'error':
      return 'ผิดพลาด';
    case 'created':
    default:
      return 'สร้างร่างแล้ว';
  }
}

function runStatusClass(status: AutoOrderRunWithRelations['status']): string {
  switch (status) {
    case 'skipped_open_draft':
      return 'run-skipped';
    case 'error':
      return 'run-error';
    case 'created':
    default:
      return 'run-created';
  }
}

async function extractFunctionError(functionError: unknown): Promise<string> {
  const context = (functionError as { context?: Response }).context;

  if (context instanceof Response) {
    try {
      const body = await context.clone().json() as { error?: string };
      if (body?.error)
        return body.error;
    }
    catch {
      // Fall through to the generic error message.
    }
  }

  if (functionError instanceof Error)
    return functionError.message;

  return 'เรียกฟังก์ชันสร้างแผนอัตโนมัติไม่สำเร็จ';
}

// ─────────────────────────────────────────────
// Computed
// ─────────────────────────────────────────────

const activePlans = computed<AutoOrderPlanWithRelations[]>(
  () => plans.value.filter(plan => plan.is_active),
);

const activeDrugIds = computed<number[]>(
  () => activePlans.value.map(plan => plan.drug_id),
);

const dueSoonCount = computed<number>(() =>
  activePlans.value.filter((plan) => {
    const days = daysUntil(plan.next_order_date);
    return days <= OVERDUE_DAYS;
  }).length,
);

const pausedCount = computed<number>(
  () => plans.value.filter(plan => !plan.is_active).length,
);

const filteredPlans = computed<AutoOrderPlanWithRelations[]>(() => {
  const query = searchQuery.value.trim().toLowerCase();

  return plans.value.filter((plan) => {
    const drugText = `${plan.drugs.name} ${plan.drugs.form ?? ''} ${plan.drugs.strength ?? ''}`.toLowerCase();
    const matchesQuery = !query
      || drugText.includes(query)
      || plan.suppliers.name.toLowerCase().includes(query);
    const matchesStatus = statusFilter.value === 'all'
      || (statusFilter.value === 'active' && plan.is_active)
      || (statusFilter.value === 'paused' && !plan.is_active);

    return matchesQuery && matchesStatus;
  });
});

const hasActiveFilter = computed<boolean>(
  () => searchQuery.value.trim() !== '' || statusFilter.value !== 'all',
);

// ─────────────────────────────────────────────
// Pagination
// ─────────────────────────────────────────────

const totalPages = computed<number>(
  () => Math.max(1, Math.ceil(filteredPlans.value.length / pageSize.value)),
);

const pagedPlans = computed<AutoOrderPlanWithRelations[]>(() => {
  const start = (page.value - 1) * pageSize.value;
  return filteredPlans.value.slice(start, start + pageSize.value);
});

const rangeStart = computed<number>(
  () => (filteredPlans.value.length === 0 ? 0 : (page.value - 1) * pageSize.value + 1),
);

const rangeEnd = computed<number>(
  () => Math.min(page.value * pageSize.value, filteredPlans.value.length),
);

type PlanRowView = {
  plan: AutoOrderPlanWithRelations;
  quantity: number;
  cycleValue: number;
  nextDateLabel: string;
  dueLabel: string | null;
  isOverdue: boolean;
};

/** Everything the table needs, calculated once per visible row. */
const planRows = computed<PlanRowView[]>(() =>
  pagedPlans.value.map((plan) => {
    const days = daysUntil(plan.next_order_date);
    return {
      plan,
      quantity: orderQuantity(plan),
      cycleValue: cycleValue(plan),
      nextDateLabel: formatDate(plan.next_order_date),
      dueLabel: dueLabel(plan, days),
      isOverdue: plan.is_active && days < 0,
    };
  }),
);

watch([searchQuery, statusFilter, pageSize], () => {
  page.value = 1;
});

watch(totalPages, (max: number) => {
  if (page.value > max)
    page.value = max;
});

// ─────────────────────────────────────────────
// Data fetching
// ─────────────────────────────────────────────

async function fetchPlans(): Promise<void> {
  loading.value = true;
  error.value = null;
  today.value = bangkokTodayIso();

  try {
    const { data, error: fetchError } = await supabase
      .from('auto_order_plans')
      .select('id, drug_id, usage_quantity, usage_months, interval_months, next_order_date, unit_count, packaging, price_per_unit, is_active, created_at, updated_at, drugs (*), suppliers (*)')
      .order('next_order_date', { ascending: true });

    if (fetchError)
      throw fetchError;

    plans.value = (data ?? []) as unknown as AutoOrderPlanWithRelations[];
  }
  catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ';
    error.value = `ไม่สามารถดึงแผนสั่งซื้อได้: ${message}`;
  }
  finally {
    loading.value = false;
  }
}

async function fetchRuns(): Promise<void> {
  runsLoading.value = true;
  runsError.value = null;

  try {
    const { data, error: fetchError } = await supabase
      .from('auto_order_runs')
      .select('id, run_date, quantity, status, message, created_at, auto_order_plans (drugs (name, form, strength), suppliers (name))')
      .order('created_at', { ascending: false })
      .limit(50);

    if (fetchError)
      throw fetchError;

    runs.value = (data ?? []) as unknown as AutoOrderRunWithRelations[];
  }
  catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ';
    runsError.value = `ไม่สามารถดึงประวัติการรันได้: ${message}`;
  }
  finally {
    runsLoading.value = false;
  }
}

// ─────────────────────────────────────────────
// Plan actions
// ─────────────────────────────────────────────

function openCreate(): void {
  editingPlan.value = null;
  showForm.value = true;
}

function openEdit(plan: AutoOrderPlanWithRelations): void {
  editingPlan.value = plan;
  showForm.value = true;
}

function closeForm(): void {
  showForm.value = false;
  editingPlan.value = null;
}

function handleSaved(): void {
  const wasEditing = Boolean(editingPlan.value);
  closeForm();
  notificationStore.showNotification({
    message: wasEditing ? 'บันทึกการแก้ไขแผนเรียบร้อย!' : 'เพิ่มแผนสั่งซื้ออัตโนมัติเรียบร้อย!',
    type: 'success',
  });
  fetchPlans();
}

async function togglePlan(plan: AutoOrderPlanWithRelations): Promise<void> {
  togglingId.value = plan.id;

  try {
    const { error: updateError } = await supabase
      .from('auto_order_plans')
      .update({ is_active: !plan.is_active, updated_at: new Date().toISOString() })
      .eq('id', plan.id);

    if (updateError)
      throw updateError;

    notificationStore.showNotification({
      message: plan.is_active
        ? `หยุดแผน "${plan.drugs.name}" แล้ว`
        : `เปิดใช้งานแผน "${plan.drugs.name}" แล้ว`,
      type: 'success',
    });
    await fetchPlans();
  }
  catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ';
    notificationStore.showNotification({
      message: message.includes('auto_order_plans_one_active_per_drug')
        ? 'ยานี้มีแผนเปิดใช้งานอยู่แล้ว กรุณาหยุดแผนเดิมก่อน'
        : `เกิดข้อผิดพลาด: ${message}`,
      type: 'error',
    });
  }
  finally {
    togglingId.value = null;
  }
}

async function confirmDelete(): Promise<void> {
  if (!planToDelete.value)
    return;

  isDeleting.value = true;

  try {
    const { error: deleteError } = await supabase
      .from('auto_order_plans')
      .delete()
      .eq('id', planToDelete.value.id);

    if (deleteError)
      throw deleteError;

    notificationStore.showNotification({
      message: `ลบแผน "${planToDelete.value.drugs.name}" เรียบร้อย!`,
      type: 'success',
    });
    planToDelete.value = null;
    await fetchPlans();
  }
  catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ';
    notificationStore.showNotification({
      message: `เกิดข้อผิดพลาด: ${message}`,
      type: 'error',
    });
  }
  finally {
    isDeleting.value = false;
  }
}

// ─────────────────────────────────────────────
// Manual runs
// ─────────────────────────────────────────────

function openRun(plan: AutoOrderPlanWithRelations): void {
  runTarget.value = plan;
  runError.value = null;
  dryRunResult.value = null;
}

function closeRun(): void {
  if (isRunning.value)
    return;
  runTarget.value = null;
  runError.value = null;
  dryRunResult.value = null;
}

async function runPlan(mode: 'dry' | 'real'): Promise<void> {
  const plan = runTarget.value;
  if (!plan)
    return;

  runningMode.value = mode;
  runError.value = null;
  dryRunResult.value = null;

  try {
    const { data, error: functionError } = await supabase.functions.invoke<AutoOrderFunctionResponse>(
      'generate-auto-orders',
      { body: { plan_id: plan.id, dry_run: mode === 'dry' } },
    );

    if (functionError)
      throw new Error(await extractFunctionError(functionError));

    if (!data || data.error)
      throw new Error(data?.error ?? 'ฟังก์ชันไม่ส่งผลลัพธ์กลับมา');

    const result = data.results?.[0];

    if (!result)
      throw new Error('ไม่พบผลลัพธ์ของแผนนี้');

    if (mode === 'dry') {
      dryRunResult.value = result;
      return;
    }

    if (result.status === 'error') {
      runError.value = result.message;
      return;
    }

    const notificationNote = data.notification_error
      ? ' แต่แจ้งเตือน Telegram ไม่สำเร็จ'
      : '';

    notificationStore.showNotification({
      message: result.status === 'skipped_open_draft'
        ? `ข้ามรอบของ "${plan.drugs.name}" เพราะมีร่างรอตรวจอยู่แล้ว`
        : `สร้างร่างใบสั่งซื้อ "${plan.drugs.name}" เรียบร้อย!${notificationNote}`,
      type: result.status === 'skipped_open_draft' ? 'info' : (data.notification_error ? 'error' : 'success'),
    });

    runningMode.value = null;
    closeRun();
    await fetchPlans();
    countsStore.refresh();
  }
  catch (err: unknown) {
    runError.value = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ';
  }
  finally {
    runningMode.value = null;
  }
}

async function openRunHistory(): Promise<void> {
  showRuns.value = true;
  await fetchRuns();
}

onMounted(fetchPlans);
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <h1 class="page-title">
          แผนสั่งซื้ออัตโนมัติ
        </h1>
        <p class="page-desc">
          กำหนดยอดใช้ย้อนหลังและรอบการสั่งซื้อ ระบบจะสร้างใบสั่งซื้อฉบับร่าง
          ให้ตรวจสอบพร้อมแจ้งเตือน Telegram ตามกำหนด
        </p>
      </div>
      <div class="page-actions">
        <button type="button" class="btn btn-ghost" @click="openRunHistory">
          <AppIcon name="history" :size="16" />
          ประวัติการทำงาน
        </button>
        <button type="button" class="btn btn-primary" @click="openCreate">
          <AppIcon name="plus" :size="16" />
          เพิ่มแผน
        </button>
      </div>
    </header>

    <!-- Loading -->
    <div v-if="loading" class="state-block" aria-busy="true">
      <span class="spinner" />
      <p class="state-title">
        กำลังโหลดแผนสั่งซื้อ...
      </p>
      <p class="state-desc">
        กำลังดึงแผนอัตโนมัติและข้อมูลยาจากฐานข้อมูล
      </p>
    </div>

    <!-- Error -->
    <EmptyState
      v-else-if="error"
      is-error
      icon="alertCircle"
      title="โหลดแผนไม่สำเร็จ"
      :description="error"
    >
      <button type="button" class="btn btn-ghost" @click="fetchPlans">
        <AppIcon name="refresh" :size="16" />
        ลองใหม่อีกครั้ง
      </button>
    </EmptyState>

    <!-- Empty -->
    <EmptyState
      v-else-if="plans.length === 0"
      icon="calendar"
      title="ยังไม่มีแผนสั่งซื้ออัตโนมัติ"
      description="เลือกยา ระบุยอดใช้ย้อนหลังและรอบสั่งซื้อ ระบบจะสร้างร่างใบสั่งซื้อให้ตามกำหนด"
    >
      <button type="button" class="btn btn-primary" @click="openCreate">
        <AppIcon name="plus" :size="16" />
        เพิ่มแผนแรก
      </button>
    </EmptyState>

    <template v-else>
      <!-- Metrics -->
      <div class="stat-grid">
        <StatCard label="แผนที่เปิดใช้งาน" :value="activePlans.length" hint="กำลังทำงานตามรอบ" icon="calendar" />
        <StatCard label="ใกล้ถึงกำหนด" :value="dueSoonCount" hint="ภายใน 14 วัน" icon="clock" tone="peach" />
        <StatCard label="หยุดชั่วคราว" :value="pausedCount" hint="ไม่สร้างร่าง" icon="pause" tone="sand" />
      </div>

      <!-- Toolbar -->
      <div class="toolbar">
        <div class="input-wrap search-field">
          <AppIcon name="search" :size="16" class="input-icon" />
          <input
            v-model="searchQuery"
            type="search"
            class="form-input"
            placeholder="ค้นหาชื่อยาหรือบริษัท..."
            aria-label="ค้นหาแผนสั่งซื้อ"
            autocomplete="off"
          >
        </div>

        <div class="select-field">
          <select v-model="statusFilter" class="form-select" aria-label="กรองตามสถานะ">
            <option value="all">
              ทุกสถานะ
            </option>
            <option value="active">
              เปิดใช้งาน
            </option>
            <option value="paused">
              หยุดชั่วคราว
            </option>
          </select>
        </div>

        <div class="toolbar-meta">
          <span>แสดง <strong>{{ filteredPlans.length }}</strong> / {{ plans.length }} แผน</span>
          <button v-if="hasActiveFilter" type="button" class="btn btn-subtle btn-sm" @click="searchQuery = ''; statusFilter = 'all'">
            ล้างตัวกรอง
          </button>
          <button aria-label="รีเฟรช" type="button" class="btn btn-subtle btn-sm" @click="fetchPlans">
            <AppIcon name="refresh" :size="15" />
          </button>
        </div>
      </div>

      <!-- Filtered to nothing -->
      <EmptyState
        v-if="filteredPlans.length === 0"
        icon="search"
        title="ไม่พบแผนที่ตรงกับตัวกรอง"
        description="ลองเปลี่ยนคำค้นหาหรือเลือกสถานะอื่น"
      >
        <button
          type="button"
          class="btn btn-ghost"
          @click="searchQuery = ''; statusFilter = 'all'"
        >
          ล้างตัวกรอง
        </button>
      </EmptyState>

      <!-- Plan table -->
      <div v-else class="table-wrap">
        <table class="data-table plan-table">
          <caption class="sr-only">
            แผนสั่งซื้ออัตโนมัติ
          </caption>
          <thead>
            <tr>
              <th scope="col">
                ชื่อยา
              </th>
              <th scope="col">
                บริษัท
              </th>
              <th scope="col" class="num">
                ยอดใช้ย้อนหลัง
              </th>
              <th scope="col" class="num">
                สั่งทุก
              </th>
              <th scope="col" class="num">
                จำนวน/ครั้ง
              </th>
              <th scope="col">
                รอบถัดไป
              </th>
              <th scope="col">
                สถานะ
              </th>
              <th scope="col" class="col-actions">
                <span class="sr-only">การจัดการ</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in planRows" :key="row.plan.id" :class="{ 'is-paused': !row.plan.is_active }">
              <td>
                <span class="row-title">{{ row.plan.drugs.name }}</span>
                <span class="row-meta">
                  {{ row.plan.drugs.form }} {{ row.plan.drugs.strength }}
                  <template v-if="row.plan.packaging"> · {{ row.plan.packaging }}</template>
                </span>
              </td>
              <td>{{ row.plan.suppliers.name }}</td>
              <td class="num">
                {{ formatQuantity(row.plan.usage_quantity) }}
                <span class="cell-meta">/ {{ row.plan.usage_months }} เดือน</span>
              </td>
              <td class="num">
                {{ row.plan.interval_months }} เดือน
              </td>
              <td class="num">
                <strong>{{ formatQuantity(row.quantity) }}</strong> × {{ row.plan.unit_count }}
                <span class="cell-meta">฿{{ formatMoney(row.cycleValue) }}</span>
              </td>
              <td>
                <span class="next-date">{{ row.nextDateLabel }}</span>
                <span
                  v-if="row.dueLabel"
                  class="due-chip"
                  :class="{ 'is-overdue': row.isOverdue }"
                >
                  {{ row.dueLabel }}
                </span>
                <span v-else-if="!row.plan.is_active" class="cell-meta">หยุดอยู่</span>
              </td>
              <td>
                <span class="badge" :class="row.plan.is_active ? 'plan-active' : 'plan-paused'">
                  <span class="badge-dot" />
                  {{ row.plan.is_active ? 'เปิดใช้งาน' : 'หยุดชั่วคราว' }}
                </span>
              </td>
              <td class="col-actions">
                <div class="row-actions">
                  <button
                    type="button"
                    class="btn btn-ghost btn-icon btn-sm"
                    :disabled="!row.plan.is_active || isRunning"
                    :title="`รันแผน ${row.plan.drugs.name} เดี๋ยวนี้`"
                    :aria-label="`รันแผน ${row.plan.drugs.name} เดี๋ยวนี้`"
                    @click="openRun(row.plan)"
                  >
                    <AppIcon name="play" :size="14" />
                  </button>
                  <button
                    type="button"
                    class="btn btn-subtle btn-icon btn-sm"
                    :title="`แก้ไขแผน ${row.plan.drugs.name}`"
                    :aria-label="`แก้ไขแผน ${row.plan.drugs.name}`"
                    @click="openEdit(row.plan)"
                  >
                    <AppIcon name="pencil" :size="14" />
                  </button>
                  <button
                    type="button"
                    class="btn btn-subtle btn-icon btn-sm"
                    :disabled="togglingId === row.plan.id"
                    :title="row.plan.is_active ? `หยุดแผน ${row.plan.drugs.name}` : `เปิดแผน ${row.plan.drugs.name}`"
                    :aria-label="row.plan.is_active ? `หยุดแผน ${row.plan.drugs.name}` : `เปิดแผน ${row.plan.drugs.name}`"
                    @click="togglePlan(row.plan)"
                  >
                    <span v-if="togglingId === row.plan.id" class="spinner spinner-sm" />
                    <AppIcon v-else :name="row.plan.is_active ? 'pause' : 'play'" :size="14" />
                  </button>
                  <button
                    type="button"
                    class="btn btn-danger-soft btn-icon btn-sm"
                    :title="`ลบแผน ${row.plan.drugs.name}`"
                    :aria-label="`ลบแผน ${row.plan.drugs.name}`"
                    @click="planToDelete = row.plan"
                  >
                    <AppIcon name="trash" :size="14" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Pagination -->
      <div v-if="filteredPlans.length > 0" class="pagination">
        <span>แสดง {{ rangeStart }}-{{ rangeEnd }} จาก {{ filteredPlans.length }} แผน</span>

        <div class="page-controls">
          <label class="page-size">
            <span class="sr-only">จำนวนแผนต่อหน้า</span>
            <select v-model.number="pageSize" class="form-select form-select-sm" aria-label="จำนวนแผนต่อหน้า">
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

    <!-- Create / edit -->
    <AutoPlanForm
      v-if="showForm"
      :plan="editingPlan"
      :active-drug-ids="activeDrugIds"
      @close="closeForm"
      @saved="handleSaved"
    />

    <!-- Delete confirmation -->
    <AppModal
      v-if="planToDelete"
      title="ลบแผนสั่งซื้ออัตโนมัติ"
      size="sm"
      @close="planToDelete = null"
    >
      <p class="confirm-text">
        ลบแผน "<strong>{{ planToDelete.drugs.name }}</strong>"?
      </p>
      <p class="confirm-hint">
        ระบบจะหยุดสร้างร่างใบสั่งซื้อสำหรับยานี้ และประวัติการรันของแผนนี้จะถูกลบด้วย
      </p>

      <template #footer>
        <button type="button" class="btn btn-ghost" :disabled="isDeleting" @click="planToDelete = null">
          ยกเลิก
        </button>
        <button type="button" class="btn btn-danger" :disabled="isDeleting" @click="confirmDelete">
          <span v-if="isDeleting" class="spinner spinner-sm" />
          <AppIcon v-else name="trash" :size="15" />
          {{ isDeleting ? 'กำลังลบ...' : 'ยืนยันลบ' }}
        </button>
      </template>
    </AppModal>

    <!-- Manual run -->
    <AppModal
      v-if="runTarget"
      title="รันแผนเดี๋ยวนี้"
      size="md"
      @close="closeRun"
    >
      <p class="run-drug">
        {{ runTarget.drugs.name }}
        <span class="run-meta">{{ runTarget.drugs.form }} {{ runTarget.drugs.strength }}</span>
      </p>

      <div class="run-summary">
        <div>
          <span class="run-label">ใช้เฉลี่ย</span>
          <span class="run-value">{{ formatQuantity(runTarget.usage_quantity / runTarget.usage_months) }} {{ runTarget.unit_count }}/เดือน</span>
        </div>
        <div>
          <span class="run-label">จะสร้างครั้งละ</span>
          <span class="run-value">{{ formatQuantity(orderQuantity(runTarget)) }} {{ runTarget.unit_count }}</span>
        </div>
        <div>
          <span class="run-label">รอบถัดไป</span>
          <span class="run-value">{{ formatDate(runTarget.next_order_date) }}</span>
        </div>
      </div>

      <p class="run-note">
        "ทดลอง" จะคำนวณผลให้ดูโดยไม่บันทึกข้อมูลและไม่ส่ง Telegram<br>
        "สร้างร่างเลย" จะสร้างใบสั่งซื้อสถานะ <strong>ต้องสั่งซื้อ</strong>,
        แจ้งเตือน Telegram และเลื่อนรอบถัดไป
      </p>

      <div v-if="dryRunResult" class="alert" :class="dryRunResult.status === 'skipped_open_draft' ? 'alert-warning' : 'alert-success'">
        <AppIcon :name="dryRunResult.status === 'skipped_open_draft' ? 'alertTriangle' : 'checkCircle'" :size="17" />
        <span>{{ dryRunResult.message }}</span>
      </div>

      <div v-if="runError" class="alert alert-error" role="alert">
        <AppIcon name="alertCircle" :size="17" />
        <span>{{ runError }}</span>
      </div>

      <template #footer>
        <button type="button" class="btn btn-ghost" :disabled="isRunning" @click="closeRun">
          ปิด
        </button>
        <button type="button" class="btn btn-ghost" :disabled="isRunning" @click="runPlan('dry')">
          <span v-if="runningMode === 'dry'" class="spinner spinner-sm" />
          <AppIcon v-else name="eye" :size="15" />
          {{ runningMode === 'dry' ? 'กำลังทดลอง...' : 'ทดลอง' }}
        </button>
        <button type="button" class="btn btn-primary" :disabled="isRunning" @click="runPlan('real')">
          <span v-if="runningMode === 'real'" class="spinner spinner-sm" />
          <AppIcon v-else name="play" :size="15" />
          {{ runningMode === 'real' ? 'กำลังสร้าง...' : 'สร้างร่างเลย' }}
        </button>
      </template>
    </AppModal>

    <!-- Run history -->
    <AppModal
      v-if="showRuns"
      title="ประวัติการทำงานของแผน"
      size="lg"
      @close="showRuns = false"
    >
      <div v-if="runsLoading" class="state-block history-state" aria-busy="true">
        <span class="spinner" />
        <p class="state-title">
          กำลังโหลดประวัติ...
        </p>
      </div>

      <div v-else-if="runsError" class="alert alert-error">
        <AppIcon name="alertCircle" :size="17" />
        <span>{{ runsError }}</span>
      </div>

      <EmptyState
        v-else-if="runs.length === 0"
        icon="history"
        title="ยังไม่มีประวัติการทำงาน"
        description="เมื่อระบบสร้างร่างใบสั่งซื้อหรือข้ามรอบ ประวัติจะแสดงที่นี่"
      />

      <div v-else class="table-wrap history-wrap">
        <table class="data-table">
          <caption class="sr-only">
            ประวัติการรันแผนสั่งซื้ออัตโนมัติ
          </caption>
          <thead>
            <tr>
              <th scope="col">
                วันที่
              </th>
              <th scope="col">
                ยา
              </th>
              <th scope="col" class="num">
                จำนวน
              </th>
              <th scope="col">
                ผลลัพธ์
              </th>
              <th scope="col">
                หมายเหตุ
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="run in runs" :key="run.id">
              <td>{{ formatDate(run.run_date) }}</td>
              <td>
                <span class="row-title">{{ run.auto_order_plans?.drugs?.name ?? '-' }}</span>
                <span class="row-meta">{{ run.auto_order_plans?.suppliers?.name ?? '' }}</span>
              </td>
              <td class="num">
                {{ formatQuantity(run.quantity) }}
              </td>
              <td>
                <span class="run-badge" :class="runStatusClass(run.status)">
                  {{ runStatusLabel(run.status) }}
                </span>
              </td>
              <td class="history-message">
                {{ run.message ?? '-' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <template #footer>
        <button type="button" class="btn btn-ghost" @click="showRuns = false">
          ปิด
        </button>
        <button type="button" class="btn btn-ghost" :disabled="runsLoading" @click="fetchRuns">
          <AppIcon name="refresh" :size="15" />
          รีเฟรช
        </button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.plan-table {
  min-width: 1040px;
}

.page-size .form-select-sm {
  min-height: 32px;
  padding: 0.2rem 1.9rem 0.2rem 0.6rem;
  font-size: var(--text-sm);
}

.data-table tbody tr.is-paused {
  opacity: 0.7;
}

.cell-meta {
  display: block;
  margin-top: 1px;
  color: var(--text-3);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}

.next-date {
  font-variant-numeric: tabular-nums;
}

.due-chip {
  display: inline-block;
  margin-left: 0.4rem;
  padding: 0.05rem 0.45rem;
  border-radius: var(--radius-full);
  background-color: var(--warning-soft);
  color: var(--warning);
  font-size: var(--text-xs);
  font-weight: 500;
  white-space: nowrap;
}

.due-chip.is-overdue {
  background-color: var(--danger-soft);
  color: var(--danger);
}

.plan-active {
  background-color: var(--success-soft);
  color: var(--success);
}

.plan-paused {
  background-color: var(--surface-3);
  color: var(--text-3);
}

.row-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.3rem;
}

.confirm-text {
  margin: 0 0 0.5rem;
  color: var(--text);
}

.confirm-hint {
  margin: 0;
  color: var(--text-2);
  font-size: var(--text-sm);
}

.run-drug {
  margin: 0 0 0.75rem;
  font-size: var(--text-lg);
  font-weight: 600;
}

.run-meta {
  display: block;
  margin-top: 0.1rem;
  color: var(--text-3);
  font-size: var(--text-sm);
  font-weight: 400;
}

.run-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 0.75rem;
  padding: 0.85rem 1rem;
  margin-bottom: 0.9rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background-color: var(--surface-2);
}

.run-label {
  display: block;
  color: var(--text-3);
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.run-value {
  display: block;
  margin-top: 0.1rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.run-note {
  margin: 0 0 0.9rem;
  color: var(--text-2);
  font-size: var(--text-sm);
}

.history-state {
  padding: 2.5rem 1rem;
}

.history-wrap {
  max-height: min(56vh, 520px);
}

.history-message {
  max-width: 28ch;
  color: var(--text-2);
  font-size: var(--text-sm);
}

.run-badge {
  display: inline-flex;
  align-items: center;
  padding: 0.15rem 0.55rem;
  border-radius: var(--radius-full);
  font-size: var(--text-xs);
  font-weight: 500;
  white-space: nowrap;
}

.run-created {
  background-color: var(--success-soft);
  color: var(--success);
}

.run-skipped {
  background-color: var(--warning-soft);
  color: var(--warning);
}

.run-error {
  background-color: var(--danger-soft);
  color: var(--danger);
}

.btn-primary .spinner-sm {
  border-color: color-mix(in srgb, var(--on-primary) 35%, transparent);
  border-top-color: var(--on-primary);
}
</style>
