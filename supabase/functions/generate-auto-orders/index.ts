/// <reference lib="deno.ns" />
import { sendTelegramMessage } from '../_shared/telegram.ts';

/**
 * Automatic purchase-plan runner.
 *
 * Called two ways:
 *   - by pg_cron (see supabase/cron/auto-order-plans.sql) with the
 *     `x-cron-secret` header, processing every plan whose next_order_date is due;
 *   - by the Tracker UI with a signed-in user's JWT, passing
 *     `{ plan_id, dry_run }` so a pharmacist can test one plan immediately.
 *
 * A real run inserts a purchase order in `ต้องสั่งซื้อ` (a draft for review),
 * advances the plan's next_order_date, writes an audit row, and sends one
 * Telegram summary to the pharmacy chat. It never messages the supplier.
 */

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const AUTH_API_KEY = Deno.env.get('SUPABASE_ANON_KEY')
  ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')
  ?? SERVICE_ROLE_KEY;
const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
const TELEGRAM_CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID');
const CRON_SECRET = Deno.env.get('CRON_SECRET');

const AUTO_BATCH_NAME = 'Auto Plan';

interface PlanRow {
  id: string;
  drug_id: string;
  supplier_id: string;
  usage_quantity: number;
  usage_months: number;
  interval_months: number;
  order_quantity: number | null;
  next_order_date: string;
  unit_count: string;
  packaging: string | null;
  price_per_unit: number;
  is_active: boolean;
  drugs: { name: string; form: string | null; strength: string | null } | null;
  suppliers: { name: string } | null;
}

type RunStatus = 'created' | 'skipped_open_draft' | 'error';

interface RunResult {
  plan_id: string;
  drug_name: string;
  supplier_name: string;
  quantity: number;
  status: RunStatus;
  message: string;
  next_order_date: string;
}

const PLAN_SELECT = [
  'id',
  'drug_id',
  'supplier_id',
  'usage_quantity',
  'usage_months',
  'interval_months',
  'order_quantity',
  'next_order_date',
  'unit_count',
  'packaging',
  'price_per_unit',
  'is_active',
  'drugs(name,form,strength)',
  'suppliers(name)',
].join(',');

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ─────────────────────────────────────────────
// Date helpers (Asia/Bangkok, no DST)
// ─────────────────────────────────────────────

/** Current date in Asia/Bangkok as `YYYY-MM-DD`. */
function bangkokToday(): string {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Adds calendar months to an ISO date, clamping the day to the month end. */
function addMonths(iso: string, months: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  const targetIndex = (month ?? 1) - 1 + months;
  const targetYear = (year ?? 1970) + Math.floor(targetIndex / 12);
  const targetMonth = ((targetIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const targetDay = Math.min(day ?? 1, lastDay);

  return `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;
}

/**
 * Next scheduled date after a run. Keeps the cadence anchored to the previous
 * scheduled date, but skips past occurrences so a late run never creates a
 * backlog of drafts.
 */
function nextDueDate(previous: string, today: string, intervalMonths: number): string {
  let next = addMonths(previous, intervalMonths);

  while (Date.parse(`${next}T00:00:00Z`) <= Date.parse(`${today}T00:00:00Z`)) {
    next = addMonths(next, intervalMonths);
  }

  return next;
}

// ─────────────────────────────────────────────
// Domain helpers
// ─────────────────────────────────────────────

/**
 * Quantity for one cycle: the user's explicit override when set, otherwise
 * average monthly usage × interval, rounded up so the plan never under-orders.
 * Mirrors `src/utils/auto-plan.ts` and the preview in the Tracker UI.
 */
function orderQuantity(plan: PlanRow): number {
  const override = Number(plan.order_quantity);

  if (plan.order_quantity != null && Number.isFinite(override) && override > 0)
    return override;

  const monthly = plan.usage_quantity / plan.usage_months;
  return Math.max(1, Math.ceil(monthly * plan.interval_months));
}

function formatQuantity(value: number): string {
  return new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 }).format(value);
}

// ─────────────────────────────────────────────
// REST helpers (service role bypasses RLS)
// ─────────────────────────────────────────────

function restUrl(path: string, params?: Record<string, string>): string {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${path}`);
  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

async function rest<T>(
  path: string,
  options: { method?: string; params?: Record<string, string>; body?: unknown; prefer?: string } = {},
): Promise<T | null> {
  const headers: Record<string, string> = {
    apikey: SERVICE_ROLE_KEY ?? '',
    Authorization: `Bearer ${SERVICE_ROLE_KEY ?? ''}`,
    'Content-Type': 'application/json',
  };

  if (options.prefer) {
    headers.Prefer = options.prefer;
  }

  const response = await fetch(restUrl(path, options.params), {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${path} failed (${response.status}): ${text}`);
  }

  return text ? JSON.parse(text) as T : null;
}

async function fetchPlan(planId: string): Promise<PlanRow | null> {
  const rows = await rest<PlanRow[]>('auto_order_plans', {
    params: { select: PLAN_SELECT, id: `eq.${planId}`, limit: '1' },
  });
  return rows?.[0] ?? null;
}

async function fetchDuePlans(today: string): Promise<PlanRow[]> {
  const rows = await rest<PlanRow[]>('auto_order_plans', {
    params: {
      select: PLAN_SELECT,
      is_active: 'eq.true',
      next_order_date: `lte.${today}`,
      order: 'next_order_date.asc,id.asc',
    },
  });
  return rows ?? [];
}

async function hasOpenDraft(drugId: string): Promise<boolean> {
  const rows = await rest<Array<{ id: string }>>('purchase_orders', {
    params: {
      select: 'id',
      drug_id: `eq.${drugId}`,
      status: 'eq.ต้องสั่งซื้อ',
      limit: '1',
    },
  });
  return (rows?.length ?? 0) > 0;
}

async function autoBatchId(): Promise<string> {
  const rows = await rest<Array<{ id: string }>>('import_batches', {
    method: 'POST',
    params: { on_conflict: 'file_name' },
    prefer: 'resolution=merge-duplicates,return=representation',
    body: { file_name: AUTO_BATCH_NAME },
  });

  const id = rows?.[0]?.id;
  if (!id) {
    throw new Error('ไม่สามารถสร้าง import batch สำหรับแผนอัตโนมัติได้');
  }
  return id;
}

async function createDraft(plan: PlanRow, quantity: number): Promise<string> {
  const importBatchId = await autoBatchId();
  const totalPrice = Math.round(quantity * plan.price_per_unit * 100) / 100;

  const rows = await rest<Array<{ id: string }>>('purchase_orders', {
    method: 'POST',
    prefer: 'return=representation',
    body: {
      import_batch_id: importBatchId,
      supplier_id: plan.supplier_id,
      drug_id: plan.drug_id,
      quantity,
      unit_count: plan.unit_count.trim() || '-',
      price_per_unit: plan.price_per_unit,
      total_price: totalPrice,
      packaging: plan.packaging?.trim() || null,
      status: 'ต้องสั่งซื้อ',
    },
  });

  const id = rows?.[0]?.id;
  if (!id) {
    throw new Error('ไม่สามารถสร้างร่างใบสั่งซื้อได้');
  }
  return id;
}

async function advancePlan(planId: string, nextDate: string): Promise<void> {
  await rest('auto_order_plans', {
    method: 'PATCH',
    params: { id: `eq.${planId}` },
    prefer: 'return=minimal',
    body: { next_order_date: nextDate, updated_at: new Date().toISOString() },
  });
}

async function logRun(
  planId: string,
  status: RunStatus,
  purchaseOrderId: string | null,
  quantity: number,
  message: string,
  today: string,
): Promise<void> {
  await rest('auto_order_runs', {
    method: 'POST',
    prefer: 'return=minimal',
    body: {
      plan_id: planId,
      run_date: today,
      purchase_order_id: purchaseOrderId,
      quantity,
      status,
      message,
    },
  });
}

/** Skip-log dedupe: one `skipped_open_draft` row per plan per day. */
async function hasSkipLogToday(planId: string, today: string): Promise<boolean> {
  const rows = await rest<Array<{ id: string }>>('auto_order_runs', {
    params: {
      select: 'id',
      plan_id: `eq.${planId}`,
      run_date: `eq.${today}`,
      status: 'eq.skipped_open_draft',
      limit: '1',
    },
  });
  return (rows?.length ?? 0) > 0;
}

// ─────────────────────────────────────────────
// Plan execution
// ─────────────────────────────────────────────

async function processPlan(plan: PlanRow, today: string, dryRun: boolean): Promise<RunResult> {
  const drugName = plan.drugs?.name ?? 'ไม่ระบุชื่อยา';
  const supplierName = plan.suppliers?.name ?? 'ไม่ระบุบริษัท';
  const quantity = orderQuantity(plan);
  const nextDate = nextDueDate(plan.next_order_date, today, plan.interval_months);

  const base = {
    plan_id: plan.id,
    drug_name: drugName,
    supplier_name: supplierName,
    quantity,
    next_order_date: nextDate,
  };

  try {
    if (await hasOpenDraft(plan.drug_id)) {
      const message = `มียา "${drugName}" อยู่ในสถานะ ต้องสั่งซื้อ รอตรวจสอบอยู่ จึงข้ามรอบนี้`;

      if (!dryRun) {
        // Skipping consumes this cycle: without advancing, the next daily run
        // would create a second draft once the pharmacist processes the first.
        await advancePlan(plan.id, nextDate);

        if (!(await hasSkipLogToday(plan.id, today))) {
          await logRun(plan.id, 'skipped_open_draft', null, quantity, message, today);
        }
      }

      return { ...base, status: 'skipped_open_draft', message };
    }

    if (dryRun) {
      return {
        ...base,
        status: 'created',
        message: `จะสร้างร่างใบสั่งซื้อ ${formatQuantity(quantity)} ${plan.unit_count} และเลื่อนรอบถัดไปเป็น ${nextDate}`,
      };
    }

    const orderId = await createDraft(plan, quantity);
    await advancePlan(plan.id, nextDate);
    await logRun(
      plan.id,
      'created',
      orderId,
      quantity,
      `สร้างร่างใบสั่งซื้อ ${formatQuantity(quantity)} ${plan.unit_count} เรียบร้อย`,
      today,
    );

    return {
      ...base,
      status: 'created',
      message: `สร้างร่างใบสั่งซื้อ ${formatQuantity(quantity)} ${plan.unit_count} เรียบร้อย`,
    };
  }
  catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ';

    if (!dryRun) {
      try {
        await logRun(plan.id, 'error', null, quantity, message, today);
      }
      catch {
        // The run log is best-effort; the original error is what matters.
      }
    }

    return { ...base, status: 'error', message };
  }
}

// ─────────────────────────────────────────────
// Telegram summary (pharmacy chat only, never the supplier)
// ─────────────────────────────────────────────

function buildSummary(results: RunResult[]): string {
  const created = results.filter(result => result.status === 'created');
  const skipped = results.filter(result => result.status === 'skipped_open_draft');
  const failed = results.filter(result => result.status === 'error');

  const lines: string[] = ['แจ้งเตือนแผนสั่งซื้ออัตโนมัติ', ''];

  if (created.length > 0) {
    lines.push(`สร้างใบสั่งซื้อฉบับร่าง ${created.length} รายการ (สถานะ ต้องสั่งซื้อ) รอเภสัชกรตรวจสอบ:`);
    for (const result of created) {
      lines.push(`- ${result.drug_name} จำนวน ${formatQuantity(result.quantity)} จาก ${result.supplier_name}`);
    }
    lines.push('');
  }

  if (skipped.length > 0) {
    lines.push(`ข้าม ${skipped.length} รายการ เพราะมีร่างเดิมรอตรวจอยู่:`);
    for (const result of skipped) {
      lines.push(`- ${result.drug_name}`);
    }
    lines.push('');
  }

  if (failed.length > 0) {
    lines.push(`ผิดพลาด ${failed.length} รายการ:`);
    for (const result of failed) {
      lines.push(`- ${result.drug_name}: ${result.message}`);
    }
    lines.push('');
  }

  lines.push('เปิด Tracker > รายการต้องสั่งซื้อ เพื่อตรวจสอบและส่งบริษัท');

  return lines.join('\n');
}

// ─────────────────────────────────────────────
// Authorization
// ─────────────────────────────────────────────

async function verifyUser(token: string): Promise<boolean> {
  if (!SUPABASE_URL || !AUTH_API_KEY) {
    return false;
  }

  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: AUTH_API_KEY },
  });

  return response.ok;
}

/**
 * Cron requests carry `x-cron-secret`; UI requests carry the signed-in user's
 * bearer token. Returns the caller mode, or null when unauthorized.
 */
async function authorize(request: Request): Promise<'cron' | 'manual' | null> {
  if (request.headers.has('x-cron-secret')) {
    if (!CRON_SECRET) {
      throw new Error('CRON_SECRET is not set in Supabase.');
    }
    return request.headers.get('x-cron-secret') === CRON_SECRET ? 'cron' : null;
  }

  const authorization = request.headers.get('authorization');

  if (!authorization?.startsWith('Bearer ')) {
    return null;
  }

  return await verifyUser(authorization.slice('Bearer '.length)) ? 'manual' : null;
}

// ─────────────────────────────────────────────
// HTTP entrypoint
// ─────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      throw new Error('Supabase service credentials are not available in the function environment.');
    }

    const mode = await authorize(request);

    if (!mode) {
      return jsonResponse({ error: 'unauthorized' }, 401);
    }

    const body = await request.json().catch(() => ({}));
    const dryRun = body?.dry_run === true;
    const today = bangkokToday();

    let plans: PlanRow[];

    if (mode === 'cron') {
      plans = await fetchDuePlans(today);
    }
    else {
      const planId = typeof body?.plan_id === 'string' ? body.plan_id : '';

      if (!planId) {
        return jsonResponse({ error: 'plan_id is required' }, 400);
      }

      const plan = await fetchPlan(planId);

      if (!plan) {
        return jsonResponse({ error: 'ไม่พบแผนที่ระบุ' }, 404);
      }
      if (!plan.is_active) {
        return jsonResponse({ error: 'แผนนี้ถูกหยุดอยู่ กรุณาเปิดใช้งานก่อน' }, 400);
      }

      plans = [plan];
    }

    const results: RunResult[] = [];

    for (const plan of plans) {
      results.push(await processPlan(plan, today, dryRun));
    }

    let notificationError: string | undefined;

    // A skipped cycle now advances the plan, so notifying about it cannot
    // repeat every morning while the old draft waits for review.
    const shouldNotify = !dryRun && results.length > 0;

    if (shouldNotify) {
      try {
        if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
          throw new Error('Telegram secrets (BOT_TOKEN or CHAT_ID) are not set in Supabase.');
        }

        await sendTelegramMessage({
          botToken: TELEGRAM_BOT_TOKEN,
          chatId: TELEGRAM_CHAT_ID,
          text: buildSummary(results),
        });
      }
      catch (error: unknown) {
        notificationError = error instanceof Error ? error.message : 'ส่ง Telegram ไม่สำเร็จ';
        console.error('generate-auto-orders notification failed:', notificationError);
      }
    }

    return jsonResponse({
      status: 'ok',
      dry_run: dryRun,
      results,
      ...(notificationError ? { notification_error: notificationError } : {}),
    });
  }
  catch (error: unknown) {
    const message = error instanceof Error
      ? error.message
      : String(error) || 'An unknown error occurred';

    console.error('generate-auto-orders failed:', message);

    return jsonResponse({ error: message }, 500);
  }
});
