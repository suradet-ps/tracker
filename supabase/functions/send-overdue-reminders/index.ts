/// <reference lib="deno.ns" />
import { sendTelegramMessage } from '../_shared/telegram.ts';

/**
 * Overdue-order reminders.
 *
 * Sends one polite follow-up message per supplier for orders that have been
 * สั่งแล้ว for more than OVERDUE_DAYS days (default 14). Scheduled by pg_cron
 * (see supabase/cron/overdue-reminders.sql), which calls this function with
 * the `x-cron-secret` header so the public endpoint cannot be triggered by
 * anyone else.
 *
 * Messages are plain text on purpose: the pharmacy forwards them straight to
 * the supplier representative, and MarkdownV2 escaping would leak into the
 * forwarded text.
 */

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
const TELEGRAM_CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID');
const CRON_SECRET = Deno.env.get('CRON_SECRET');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const OVERDUE_DAYS_ENV = Number(Deno.env.get('OVERDUE_DAYS') ?? '14');
const DEFAULT_OVERDUE_DAYS = Number.isFinite(OVERDUE_DAYS_ENV) && OVERDUE_DAYS_ENV > 0
  ? OVERDUE_DAYS_ENV
  : 14;
const SIGNATURE = Deno.env.get('SIGNATURE') ?? 'งานเภสัชกรรม โรงพยาบาลสระโบสถ์';

const MS_PER_DAY = 86_400_000;
const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

interface OverdueRow {
  id: number;
  order_date: string;
  quantity: number;
  unit_count: string | null;
  drugs: { name: string; form: string | null; strength: string | null } | null;
  suppliers: { name: string } | null;
}

/** Current date in Asia/Bangkok as `YYYY-MM-DD` (UTC+7, no DST). */
function bangkokToday(): string {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** `iso` shifted back by `days` days, as `YYYY-MM-DD`. */
function isoDaysBefore(iso: string, days: number): string {
  const shifted = Date.parse(`${iso}T00:00:00Z`) - days * MS_PER_DAY;
  return new Date(shifted).toISOString().slice(0, 10);
}

/** Whole days between two `YYYY-MM-DD` dates. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY);
}

/** `2026-10-01` becomes `1 ต.ค. 2569` (Buddhist era, matching the app). */
function formatThaiDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return `${day ?? 0} ${THAI_MONTHS[(month ?? 1) - 1] ?? ''} ${(year ?? 0) + 543}`;
}

/** Trim trailing zeros from a numeric quantity (`100.000` becomes `100`). */
function formatQuantity(value: number): string {
  return String(Number(value));
}

/** One numbered order entry inside a supplier message. */
function orderEntry(row: OverdueRow, index: number, today: string): string[] {
  const name = row.drugs?.name ?? 'ไม่ระบุชื่อยา';
  const strength = row.drugs?.strength ? ` ความแรง ${row.drugs.strength}` : '';
  const form = row.drugs?.form ? ` (${row.drugs.form})` : '';
  const unitCount = row.unit_count?.trim();
  const unit = unitCount ? ` x ${unitCount}` : '';
  const days = daysBetween(row.order_date, today);

  return [
    `${index}. ${name}${strength}${form} จำนวน ${formatQuantity(row.quantity)}${unit}`,
    `   สั่งซื้อเมื่อ ${formatThaiDate(row.order_date)} (ค้าง ${days} วัน)`,
    '',
  ];
}

/** Polite follow-up letter for one supplier, ready to forward. */
function buildSupplierMessage(supplierName: string, rows: OverdueRow[], today: string): string {
  const lines: string[] = [
    `เรียน ท่านผู้แทนจำหน่าย ${supplierName}`,
    '',
    `${SIGNATURE} ขอเรียนสอบถามสถานะการจัดส่งยา`,
    `ที่ได้สั่งซื้อไปแล้วแต่ยังไม่ได้รับของ จำนวน ${rows.length} รายการ ดังนี้`,
    '',
  ];

  rows.forEach((row, index) => lines.push(...orderEntry(row, index + 1, today)));

  lines.push(
    'จึงเรียนมาเพื่อโปรดตรวจสอบและแจ้งกำหนดการจัดส่งให้ทราบด้วย',
    'หากจัดส่งแล้ว กรุณาแจ้งกำหนดวันหรือเลขพัสดุด้วย จะขอบคุณยิ่ง',
    '',
    SIGNATURE,
  );

  return lines.join('\n');
}

/** Groups overdue rows by supplier, preserving the oldest-first order. */
function groupBySupplier(rows: OverdueRow[]): Map<string, OverdueRow[]> {
  const groups = new Map<string, OverdueRow[]>();

  for (const row of rows) {
    const supplier = row.suppliers?.name ?? 'ไม่ระบุบริษัท';
    const list = groups.get(supplier);
    if (list) {
      list.push(row);
    }
    else {
      groups.set(supplier, [row]);
    }
  }

  return groups;
}

/** Orders that have been สั่งแล้ว since on or before `cutoff`. */
async function fetchOverdueOrders(cutoff: string): Promise<OverdueRow[]> {
  const query = new URLSearchParams({
    select: 'id,order_date,quantity,unit_count,drugs(name,form,strength),suppliers(name)',
    status: 'eq.สั่งแล้ว',
    order_date: `lte.${cutoff}`,
    order: 'order_date.asc,id.asc',
  });

  const response = await fetch(`${SUPABASE_URL}/rest/v1/purchase_orders?${query}`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY ?? '',
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY ?? ''}`,
    },
  });

  if (!response.ok) {
    throw new Error(`purchase_orders query failed (${response.status}): ${await response.text()}`);
  }

  return await response.json() as OverdueRow[];
}

Deno.serve(async (req: Request): Promise<Response> => {
  const jsonHeaders = { 'Content-Type': 'application/json' };

  if (!CRON_SECRET) {
    return new Response(JSON.stringify({ error: 'CRON_SECRET is not set in Supabase.' }), {
      headers: jsonHeaders,
      status: 500,
    });
  }

  if (req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      headers: jsonHeaders,
      status: 401,
    });
  }

  try {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
      throw new Error('Telegram secrets (BOT_TOKEN or CHAT_ID) are not set in Supabase.');
    }
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Supabase service credentials are not available in the function environment.');
    }

    // The cron job may send { "days": N }; fall back to OVERDUE_DAYS / 14.
    const body = await req.json().catch(() => ({}));
    const requestedDays = Number(body?.days);
    const overdueDays = Number.isFinite(requestedDays) && requestedDays > 0
      ? requestedDays
      : DEFAULT_OVERDUE_DAYS;

    const today = bangkokToday();
    const rows = await fetchOverdueOrders(isoDaysBefore(today, overdueDays));
    const groups = groupBySupplier(rows);

    let parts = 0;
    for (const [supplier, orders] of groups) {
      parts += await sendTelegramMessage({
        botToken: TELEGRAM_BOT_TOKEN,
        chatId: TELEGRAM_CHAT_ID,
        text: buildSupplierMessage(supplier, orders, today),
      });
    }

    return new Response(JSON.stringify({
      status: 'ok',
      overdueDays,
      suppliers: groups.size,
      orders: rows.length,
      parts,
    }), { headers: jsonHeaders, status: 200 });
  }
  catch (error: unknown) {
    const errorMessage = error instanceof Error
      ? error.message
      : String(error) || 'An unknown error occurred';

    console.error('send-overdue-reminders failed:', errorMessage);

    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: jsonHeaders,
      status: 400,
    });
  }
});
