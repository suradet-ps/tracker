/// <reference lib="deno.ns" />
import { sendTelegramMessage } from '../_shared/telegram.ts';

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
const TELEGRAM_CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const AUTH_API_KEY = Deno.env.get('SUPABASE_ANON_KEY')
  ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')
  ?? SERVICE_ROLE_KEY;

/**
 * How long a claimed notification blocks retries. The client aborts its
 * invoke after 30 seconds, but the function may still be sending; this
 * lease is longer than the edge-function wall-clock limit, so a retry can
 * only send again after the previous process is definitely gone.
 */
const CLAIM_LEASE_MS = 10 * 60 * 1000;

/** Upper bound for one request; well above a realistic supplier group. */
const MAX_ORDER_IDS = 250;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Browser origins allowed to call this function. Firebase Hosting and local
 * development are built in; set `ALLOWED_ORIGINS` (comma-separated) for a
 * custom domain. Vercel preview/production domains are matched separately.
 */
const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4173',
  'https://drug-tracker-system.web.app',
  'https://drug-tracker-system.firebaseapp.com',
];

const ALLOWED_ORIGINS = new Set([
  ...DEFAULT_ALLOWED_ORIGINS,
  ...(Deno.env.get('ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean),
]);

type NotificationStatus = 'sending' | 'sent' | 'failed';
type ClaimResult = 'claimed' | 'sent' | 'in_progress';
type StaffCheck = 'ok' | 'unauthorized' | 'forbidden';

interface AuthUser {
  id?: string;
}

interface NotificationRow {
  idempotency_key: string;
  order_ids: string[];
  status: NotificationStatus;
  attempts: number;
  last_error: string | null;
  started_at: string;
  sent_at: string | null;
}

interface OrderRow {
  id: string;
  quantity: number | string;
  unit_count: string | null;
  packaging: string | null;
  status: string;
  supplier_id: string;
  drugs: { name: string; form: string | null; strength: string | null } | null;
  suppliers: { name: string } | null;
}

function isSendableOrder(order: OrderRow): boolean {
  return order.status === 'ต้องสั่งซื้อ' || order.status === 'สั่งแล้ว';
}

// ─────────────────────────────────────────────
// CORS
// ─────────────────────────────────────────────

function isAllowedOrigin(origin: string): boolean {
  return ALLOWED_ORIGINS.has(origin)
    || /^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(origin);
}

function corsHeaders(origin: string | null): Record<string, string> | null {
  if (!origin) {
    return {};
  }

  if (!isAllowedOrigin(origin)) {
    return null;
  }

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

// ─────────────────────────────────────────────
// Telegram message formatting
// ─────────────────────────────────────────────

const MARKDOWN_V2_SPECIAL_CHARS = /([_*[\]()~`>#+\-=|{}.!])/g;

/**
 * Escapes a value for Telegram MarkdownV2. Whitespace and control characters
 * are collapsed so a value can never break the message structure.
 */
function escapeMarkdownV2(text: string | number | null | undefined): string {
  const singleLine = String(text ?? '')
    .replace(/[\p{Cc}\s]+/gu, ' ')
    .trim();

  return singleLine
    .replace(/\\/g, '\\\\')
    .replace(MARKDOWN_V2_SPECIAL_CHARS, '\\$1');
}

/** Drops a leading "บริษัท" so the salutation never repeats it. */
function stripCompanyPrefix(name: string): string {
  const stripped = name.replace(/^บริษัท\s*/u, '').trim();
  return stripped || name.trim();
}

/** Today in Asia/Bangkok, formatted like the app's Thai date. */
function bangkokDate(): string {
  return new Date().toLocaleDateString('th-TH', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/** Builds the supplier letter from server-side order rows, never client text. */
function buildTelegramMessage(orders: OrderRow[]): string {
  const supplierName = orders[0]?.suppliers?.name ?? 'ไม่ระบุบริษัท';
  const safeSupplierName = escapeMarkdownV2(stripCompanyPrefix(supplierName));
  const dateTelegram = escapeMarkdownV2(bangkokDate());

  let message = `*ใบขอสั่งซื้อยา*\n\n`;
  message += `เรียน บริษัท ${safeSupplierName}\n`;
  message += `เรื่อง ขออนุมัติสั่งซื้อยา\n`;
  message += `ลงวันที่ ${dateTelegram}\n\n`;
  message += `ด้วยงานเภสัชกรรม โรงพยาบาลสระโบสถ์\n`;
  message += `มีความประสงค์ขอสั่งซื้อยา ดังรายการต่อไปนี้\n\n`;
  message += `*รายละเอียดรายการยาที่ขอสั่งซื้อ*\n\n`;

  orders.forEach((order, index) => {
    const drug = order.drugs;
    const drugName = escapeMarkdownV2(drug?.name ?? 'ไม่ระบุชื่อยา');
    const form = escapeMarkdownV2(drug?.form);
    const strength = escapeMarkdownV2(drug?.strength);
    const packaging = escapeMarkdownV2(order.packaging);
    const quantity = escapeMarkdownV2(order.quantity);
    const unit = escapeMarkdownV2(order.unit_count);

    message += `*${index + 1}\\.* *${drugName}*`;
    if (form) {
      message += ` \\[${form}\\]`;
    }
    if (strength) {
      message += ` \\(${strength}\\)`;
    }
    message += `\n`;

    if (packaging) {
      message += `   บรรจุภัณฑ์: ${packaging}\n`;
    }

    message += `   จำนวน: ${quantity} × ${unit}\n\n`;
  });

  message += `หมายเหตุ กรุณาออกบิลโดยไม่ลงวันที่\n\n`;
  message += `ขอแสดงความนับถือ\n`;
  message += `_งานเภสัชกรรม รพ\\.สระโบสถ์_`;

  return message;
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
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
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

/** Parses the request into a unique, bounded list of order UUIDs. */
function parseOrderIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ORDER_IDS) {
    return null;
  }

  const ids = [...new Set(
    value.map(id => (typeof id === 'string' || typeof id === 'number' ? String(id).trim().toLowerCase() : '')),
  )];

  if (ids.length === 0 || ids.some(id => !UUID_PATTERN.test(id))) {
    return null;
  }

  return ids;
}

/** Loads every order in the group, in the caller's order. */
async function fetchOrders(orderIds: string[]): Promise<OrderRow[] | null> {
  const rows = await rest<OrderRow[]>('purchase_orders', {
    params: {
      select: 'id,quantity,unit_count,packaging,status,supplier_id,drugs(name,form,strength),suppliers(name)',
      id: `in.(${orderIds.join(',')})`,
    },
  });

  const byId = new Map((rows ?? []).map(row => [row.id, row]));
  const missing = orderIds.filter(id => !byId.has(id));

  if (missing.length > 0) {
    return null;
  }

  return orderIds.map(id => byId.get(id)!);
}

/** Returns the subset of order ids whose notification was already delivered. */
async function fetchSentOrderIds(orderIds: string[]): Promise<string[]> {
  const rows = await rest<string[]>('rpc/sent_order_ids', {
    method: 'POST',
    body: { p_order_ids: orderIds },
  });

  return rows ?? [];
}

// ─────────────────────────────────────────────
// Authorization
// ─────────────────────────────────────────────

/**
 * The public anon key is a valid JWT, so verifying the signature is not
 * enough. Resolve the caller and require an active pharmacist/admin profile.
 */
async function verifyStaff(token: string): Promise<StaffCheck> {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: AUTH_API_KEY },
  });

  if (!response.ok) {
    return 'unauthorized';
  }

  const user = await response.json().catch(() => null) as AuthUser | null;

  if (!user?.id) {
    return 'unauthorized';
  }

  const rows = await rest<Array<{ role: string }>>('profiles', {
    params: { select: 'role', id: `eq.${user.id}`, limit: '1' },
  });

  const role = rows?.[0]?.role;
  return role === 'pharmacist' || role === 'admin' ? 'ok' : 'forbidden';
}

// ─────────────────────────────────────────────
// Notification idempotency
// ─────────────────────────────────────────────

async function idempotencyKey(orderIds: string[]): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode([...orderIds].sort().join('\n')),
  );

  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function fetchNotification(key: string): Promise<NotificationRow | null> {
  const rows = await rest<NotificationRow[]>('telegram_notifications', {
    params: { select: '*', idempotency_key: `eq.${key}`, limit: '1' },
  });

  return rows?.[0] ?? null;
}

/**
 * Reserve the notification exactly once.
 *
 * - `claimed`: this request owns the send (new, failed, or an expired lease).
 * - `sent`: a previous attempt already delivered it; do not send again.
 * - `in_progress`: another request still owns an unexpired claim.
 */
async function claimNotification(key: string, orderIds: string[]): Promise<ClaimResult> {
  const inserted = await rest<NotificationRow[]>('telegram_notifications', {
    method: 'POST',
    params: { on_conflict: 'idempotency_key' },
    prefer: 'resolution=ignore-duplicates,return=representation',
    body: {
      idempotency_key: key,
      order_ids: orderIds,
      status: 'sending',
      started_at: new Date().toISOString(),
    },
  });

  if (inserted && inserted.length > 0) {
    return 'claimed';
  }

  const existing = await fetchNotification(key);

  if (!existing) {
    throw new Error('ไม่สามารถจองการแจ้งเตือนได้ กรุณาลองใหม่');
  }

  if (existing.status === 'sent') {
    return 'sent';
  }

  const startedAt = Date.parse(existing.started_at);
  const leaseActive = Number.isFinite(startedAt) && Date.now() - startedAt < CLAIM_LEASE_MS;

  if (existing.status === 'sending' && leaseActive) {
    return 'in_progress';
  }

  // Claim a failed send or an expired lease with an optimistic filter, so two
  // concurrent retries cannot both send this notification.
  const claimed = await rest<NotificationRow[]>('telegram_notifications', {
    method: 'PATCH',
    params: {
      idempotency_key: `eq.${key}`,
      status: `eq.${existing.status}`,
      started_at: `eq.${existing.started_at}`,
    },
    prefer: 'return=representation',
    body: {
      status: 'sending',
      attempts: existing.attempts + 1,
      last_error: null,
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  });

  if (claimed && claimed.length > 0) {
    return 'claimed';
  }

  // Another request won the race, or it finished between the read and the
  // update. Report `sent` if it completed so the caller can still update the
  // orders instead of asking the operator to retry.
  const latest = await fetchNotification(key);
  return latest?.status === 'sent' ? 'sent' : 'in_progress';
}

async function markNotificationSent(key: string): Promise<void> {
  const now = new Date().toISOString();

  await rest('telegram_notifications', {
    method: 'PATCH',
    params: { idempotency_key: `eq.${key}`, status: 'eq.sending' },
    prefer: 'return=minimal',
    body: { status: 'sent', sent_at: now, last_error: null, updated_at: now },
  });
}

async function markNotificationFailed(key: string, message: string): Promise<void> {
  try {
    await rest('telegram_notifications', {
      method: 'PATCH',
      params: { idempotency_key: `eq.${key}`, status: 'eq.sending' },
      prefer: 'return=minimal',
      body: {
        status: 'failed',
        last_error: message,
        updated_at: new Date().toISOString(),
      },
    });
  }
  catch (error: unknown) {
    // The lease will allow a retry even if this best-effort update is lost.
    console.error('Failed to record notification failure:', error);
  }
}

// ─────────────────────────────────────────────
// HTTP entrypoint
// ─────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get('origin');
  const cors = corsHeaders(origin);

  if (cors === null) {
    return jsonResponse({ error: 'Origin not allowed.' }, 403);
  }

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  try {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
      throw new Error('Telegram secrets (BOT_TOKEN or CHAT_ID) are not set in Supabase.');
    }
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !AUTH_API_KEY) {
      throw new Error('Supabase credentials are not available in the function environment.');
    }

    const authorization = req.headers.get('authorization');

    if (!authorization?.startsWith('Bearer ')) {
      return jsonResponse({ error: 'Unauthorized.' }, 401, cors);
    }

    const staff = await verifyStaff(authorization.slice('Bearer '.length));

    if (staff === 'unauthorized') {
      return jsonResponse({ error: 'Unauthorized.' }, 401, cors);
    }
    if (staff === 'forbidden') {
      return jsonResponse({ error: 'Only pharmacists and admins can send notifications.' }, 403, cors);
    }

    const body = await req.json().catch(() => null) as { order_ids?: unknown } | null;
    const orderIds = parseOrderIds(body?.order_ids);

    if (!orderIds) {
      return jsonResponse(
        { error: 'order_ids must contain between 1 and 250 valid order UUIDs.' },
        400,
        cors,
      );
    }

    const orders = await fetchOrders(orderIds);

    if (!orders) {
      return jsonResponse({ error: 'One or more order_ids were not found.' }, 404, cors);
    }

    const supplierId = orders[0]?.supplier_id;

    if (!supplierId || orders.some(order => order.supplier_id !== supplierId)) {
      return jsonResponse({ error: 'All order_ids must belong to one supplier.' }, 400, cors);
    }

    if (orders.some(order => !order.suppliers?.name || !order.drugs?.name)) {
      return jsonResponse({ error: 'One or more orders are missing drug or supplier data.' }, 422, cors);
    }

    if (orders.some(order => !isSendableOrder(order))) {
      return jsonResponse({ error: 'One or more orders are no longer awaiting notification.' }, 409, cors);
    }

    const sentOrderIds = await fetchSentOrderIds(orderIds);

    if (sentOrderIds.length === orderIds.length) {
      return jsonResponse({ status: 'ok', parts: 0, duplicate: true }, 200, cors);
    }

    if (sentOrderIds.length > 0) {
      return jsonResponse(
        { error: 'One or more orders were already notified.', order_ids: sentOrderIds },
        409,
        cors,
      );
    }

    const key = await idempotencyKey(orderIds);
    const claim = await claimNotification(key, orderIds);

    if (claim === 'sent') {
      return jsonResponse({ status: 'ok', parts: 0, duplicate: true }, 200, cors);
    }

    if (claim === 'in_progress') {
      return jsonResponse(
        { error: 'ข้อความนี้กำลังถูกส่งอยู่ กรุณารอสักครู่แล้วลองใหม่' },
        409,
        cors,
      );
    }

    // A cancellation can commit between the first read and the claim. Re-read
    // after claiming so a cancelled order is not announced; the remaining
    // window is closed by the outbox workflow in #126.
    const currentOrders = await fetchOrders(orderIds);

    if (!currentOrders || currentOrders.some(order => !isSendableOrder(order))) {
      await markNotificationFailed(key, 'Order status changed before the Telegram send.');
      return jsonResponse(
        { error: 'One or more orders changed before the notification was sent.' },
        409,
        cors,
      );
    }

    try {
      const parts = await sendTelegramMessage({
        botToken: TELEGRAM_BOT_TOKEN,
        chatId: TELEGRAM_CHAT_ID,
        text: buildTelegramMessage(currentOrders),
        parseMode: 'MarkdownV2',
      });

      await markNotificationSent(key);
      return jsonResponse({ status: 'ok', parts }, 200, cors);
    }
    catch (error: unknown) {
      await markNotificationFailed(key, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
  catch (error: unknown) {
    console.error('send-telegram-notify failed:', error);
    return jsonResponse({ error: 'Unable to send the notification.' }, 500, cors);
  }
});
