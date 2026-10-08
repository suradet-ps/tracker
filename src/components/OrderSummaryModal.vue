<!-- src/components/OrderSummaryModal.vue -->
<script setup lang="ts">
import type { GroupedOrders, OrderViewOrder, SupplierOrderGroup } from '@/types/database';

import { computed, ref } from 'vue';
import AppIcon from '@/components/ui/AppIcon.vue';
import AppModal from '@/components/ui/AppModal.vue';
import { supabase } from '@/supabase/client';
import { formatMoney, formatQuantity } from '@/utils/number';

// ─────────────────────────────────────────────
// Props & Emits
// ─────────────────────────────────────────────

const props = defineProps<{
  groupedOrders: GroupedOrders;
}>();

const emit = defineEmits<{
  close: [];
  ordersSent: [];
}>();

// ─────────────────────────────────────────────
// Local state
// ─────────────────────────────────────────────

const isSending = ref<boolean>(false);
const error = ref<string | null>(null);

// ─────────────────────────────────────────────
// Totals
// ─────────────────────────────────────────────

function groupTotal(group: SupplierOrderGroup): number {
  return group.orders.reduce((sum, order) => sum + (order.total_price ?? 0), 0);
}

const grandTotal = computed<number>(() =>
  Object.values(props.groupedOrders)
    .reduce((sum, group) => sum + groupTotal(group), 0),
);

// ─────────────────────────────────────────────
// Telegram MarkdownV2 helpers
// ─────────────────────────────────────────────

const MARKDOWN_V2_SPECIAL_CHARS = /([_*[\]()~`>#+\-=|{}.!])/g;

/**
 * Escapes special characters for Telegram MarkdownV2 parse mode.
 * Safely handles `null`, `undefined`, and non-string values.
 */
function escapeMarkdownV2(text: string | number | null | undefined): string {
  return String(text ?? '').replace(MARKDOWN_V2_SPECIAL_CHARS, '\\$1');
}

/**
 * Drops a leading "บริษัท" so the salutation never repeats it: supplier
 * names in the database usually already carry the prefix.
 */
function stripCompanyPrefix(name: string): string {
  const stripped = name.replace(/^บริษัท\s*/u, '').trim();
  return stripped || name.trim();
}

/**
 * Formats a `Date` to a Thai locale date string, then escapes it for MarkdownV2.
 */
function formatThaiDate(date: Date): string {
  const formatted = date.toLocaleDateString('th-TH', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  return escapeMarkdownV2(formatted);
}

/**
 * Formats a `Date` to an ISO date string (YYYY-MM-DD) suitable for database storage.
 * Uses local date components to avoid UTC offset issues.
 */
function toIsoDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Builds a single Telegram MarkdownV2 message for a supplier's order group.
 */
function buildTelegramMessage(
  supplierName: string,
  orders: OrderViewOrder[],
  dateTelegram: string,
): string {
  const safeSupplierName = escapeMarkdownV2(stripCompanyPrefix(supplierName));

  // ── Document title ───────────────────────────
  let message = `*ใบขอสั่งซื้อยา*\n\n`;

  // ── Addressing ──────────────────────────────
  message += `เรียน บริษัท ${safeSupplierName}\n`;
  message += `เรื่อง ขออนุมัติสั่งซื้อยา\n`;
  message += `ลงวันที่ ${dateTelegram}\n\n`;

  // ── Body ────────────────────────────────────
  message += `ด้วยงานเภสัชกรรม โรงพยาบาลสระโบสถ์\n`;
  message += `มีความประสงค์ขอสั่งซื้อยา ดังรายการต่อไปนี้\n\n`;
  message += `*รายละเอียดรายการยาที่ขอสั่งซื้อ*\n\n`;

  // ── Drug list ───────────────────────────────
  orders.forEach((order, index) => {
    const drugName = escapeMarkdownV2(order.drugs.name);
    const form = escapeMarkdownV2(order.drugs.form);
    const strength = escapeMarkdownV2(order.drugs.strength);
    const packaging = escapeMarkdownV2(order.packaging);
    const quantity = escapeMarkdownV2(order.quantity);
    const unit = escapeMarkdownV2(order.unit_count);

    message += `*${index + 1}\\.* *${drugName}*`;
    if (form)
      message += ` \\[${form}\\]`;
    if (strength)
      message += ` \\(${strength}\\)`;
    message += `\n`;

    if (packaging)
      message += `   บรรจุภัณฑ์: ${packaging}\n`;

    message += `   จำนวน: ${quantity} × ${unit}\n\n`;
  });

  // ── Footer ──────────────────────────────────
  message += `หมายเหตุ กรุณาออกบิลโดยไม่ลงวันที่\n\n`;
  message += `ขอแสดงความนับถือ\n`;
  message += `_งานเภสัชกรรม รพ\\.สระโบสถ์_`;

  return message;
}

// ─────────────────────────────────────────────
// Core action
// ─────────────────────────────────────────────

/**
 * Ignore dismissal requests (Escape, backdrop, close button) while the
 * send is in flight: unmounting mid-flight would strand the result.
 */
function handleClose(): void {
  if (!isSending.value)
    emit('close');
}

async function confirmAndSend(): Promise<void> {
  isSending.value = true;
  error.value = null;

  const successfulIds: number[] = [];

  try {
    const orderDate = new Date();
    const dateTelegram = formatThaiDate(orderDate);
    const dateForDatabase = toIsoDateString(orderDate);

    // Send a Telegram notification per supplier group
    for (const supplierName of Object.keys(props.groupedOrders)) {
      const group = props.groupedOrders[supplierName];
      if (!group)
        continue;

      const message = buildTelegramMessage(supplierName, group.orders, dateTelegram);

      // Collect IDs for this supplier group
      const groupOrderIds = group.orders.map(order => order.id);

      // Invoke Supabase Edge Function to send Telegram notification
      const { data: functionResponse, error: functionError } = await supabase.functions.invoke(
        'send-telegram-notify',
        { body: { message } },
      );

      if (functionError) {
        throw new Error(
          `Failed to send notification for ${supplierName}: ${functionError.message}`,
        );
      }

      // The edge function may return an error in the response body
      const responseBody = functionResponse as { error?: string } | null;
      if (responseBody?.error) {
        throw new Error(
          `Edge function returned an error for ${supplierName}: ${responseBody.error}`,
        );
      }

      // Notification succeeded - update DB for this supplier's orders immediately
      const { error: dbError } = await supabase
        .from('purchase_orders')
        .update({ status: 'สั่งแล้ว', order_date: dateForDatabase })
        .in('id', groupOrderIds);

      if (dbError) {
        console.error(`DB update failed for supplier "${supplierName}" after notification was sent.`, dbError);
        throw new Error(
          `Notification sent for ${supplierName}, but DB update failed: ${dbError.message}`,
        );
      }

      // Track successfully processed IDs
      successfulIds.push(...groupOrderIds);
    }

    emit('ordersSent');
  }
  catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ';

    if (successfulIds.length > 0) {
      error.value = `${errorMsg} (${successfulIds.length} รายการถูกส่งและอัปเดตสำเร็จแล้ว)`;
    }
    else {
      error.value = errorMsg;
    }

    console.error('An error occurred in confirmAndSend:', err);
  }
  finally {
    isSending.value = false;
  }
}
</script>

<template>
  <AppModal title="สรุปรายการสั่งซื้อ" size="lg" @close="handleClose">
    <!-- Sending -->
    <div v-if="isSending" class="sending-state">
      <span class="spinner" />
      <p class="sending-title">
        กำลังส่งคำสั่งซื้อ...
      </p>
      <p class="sending-desc">
        ระบบกำลังแจ้งเตือนผ่าน Telegram และอัปเดตสถานะ กรุณาอย่าปิดหน้าต่างนี้
      </p>
    </div>

    <!-- Review -->
    <template v-else>
      <p class="modal-note">
        <AppIcon name="send" :size="15" />
        เมื่อยืนยัน ระบบจะส่งข้อความถึงบริษัทผ่าน Telegram และเปลี่ยนสถานะเป็น
        <strong>สั่งแล้ว</strong> ทันที
      </p>

      <div class="supplier-list">
        <section v-for="(group, supplierName) in groupedOrders" :key="supplierName" class="supplier-group">
          <header class="group-head">
            <span class="group-name">
              <AppIcon name="building" :size="15" />
              {{ supplierName }}
            </span>
            <span class="group-meta">
              {{ group.orders.length }} รายการ · ฿{{ formatMoney(groupTotal(group)) }}
            </span>
          </header>

          <ul class="group-list">
            <li v-for="order in group.orders" :key="order.id">
              <div class="line-main">
                <span class="line-name">
                  {{ order.drugs.name }}
                  <span class="line-meta">
                    <template v-if="order.drugs.form"> [{{ order.drugs.form }}]</template>
                    <template v-if="order.drugs.strength"> ({{ order.drugs.strength }})</template>
                    <template v-if="order.packaging"> · {{ order.packaging }}</template>
                  </span>
                </span>
                <span class="line-qty">
                  จำนวน {{ formatQuantity(order.quantity) }} × {{ order.unit_count }}
                </span>
              </div>
              <span class="line-total">฿{{ formatMoney(order.total_price) }}</span>
            </li>
          </ul>
        </section>
      </div>

      <div class="grand-total">
        <span>รวมทั้งสิ้น</span>
        <strong>฿{{ formatMoney(grandTotal) }}</strong>
      </div>

      <div v-if="error" class="alert alert-error" role="alert">
        <AppIcon name="alertCircle" :size="17" />
        <span><strong>เกิดข้อผิดพลาด:</strong> {{ error }}</span>
      </div>
    </template>

    <template #footer>
      <button type="button" class="btn btn-ghost" :disabled="isSending" @click="emit('close')">
        ยกเลิก
      </button>
      <button
        type="button"
        class="btn btn-primary"
        :disabled="isSending || Object.keys(groupedOrders).length === 0"
        @click="confirmAndSend"
      >
        <span v-if="isSending" class="spinner spinner-sm" />
        <AppIcon v-else name="send" :size="15" />
        {{ isSending ? 'กำลังส่ง...' : 'ยืนยันและส่งคำสั่งซื้อ' }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
.modal-note {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.7rem 0.9rem;
  margin-bottom: 1.1rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background-color: var(--surface-2);
  color: var(--text-2);
  font-size: var(--text-sm);
}

.modal-note .icon {
  flex-shrink: 0;
  margin-top: 0.15rem;
  color: var(--primary);
}

.supplier-list {
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
}

.group-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding-bottom: 0.5rem;
}

.group-name {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  font-weight: 600;
}

.group-name .icon {
  color: var(--text-3);
}

.group-meta {
  color: var(--text-3);
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
}

.group-list {
  list-style: none;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.group-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.65rem 0.9rem;
  border-bottom: 1px solid var(--border);
}

.group-list li:last-child {
  border-bottom: none;
}

.group-list li:nth-child(even) {
  background-color: var(--surface-2);
}

.line-main {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
}

.line-name {
  font-weight: 500;
}

.line-meta {
  color: var(--text-3);
  font-size: var(--text-sm);
}

.line-qty {
  color: var(--text-2);
  font-size: var(--text-sm);
}

.line-total {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  white-space: nowrap;
}

.grand-total {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 1.1rem;
  padding: 0.85rem 1rem;
  border-radius: var(--radius-md);
  background-color: var(--primary-soft);
  color: var(--primary);
}

.grand-total strong {
  font-size: var(--text-lg);
  font-variant-numeric: tabular-nums;
}

.sending-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  padding: 3rem 1rem;
  text-align: center;
}

.sending-title {
  font-size: var(--text-lg);
  font-weight: 600;
}

.sending-desc {
  max-width: 34ch;
  color: var(--text-3);
  font-size: var(--text-sm);
}

.btn-primary .spinner-sm {
  border-color: color-mix(in srgb, var(--on-primary) 35%, transparent);
  border-top-color: var(--on-primary);
}
</style>
