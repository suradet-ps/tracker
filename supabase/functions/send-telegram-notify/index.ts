/// <reference lib="deno.ns" />
import { sendTelegramMessage } from '../_shared/telegram.ts';

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
const TELEGRAM_CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

/**
 * How long a claimed notification blocks retries. The client aborts its
 * invoke after 30 seconds, but the function may still be sending; this
 * lease is longer than the edge-function wall-clock limit, so a retry can
 * only send again after the previous process is definitely gone.
 */
const CLAIM_LEASE_MS = 10 * 60 * 1000;

type NotificationStatus = 'sending' | 'sent' | 'failed';
type ClaimResult = 'claimed' | 'sent' | 'in_progress';

interface NotificationRow {
  idempotency_key: string;
  order_ids: string[];
  status: NotificationStatus;
  attempts: number;
  last_error: string | null;
  started_at: string;
  sent_at: string | null;
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error) || 'An unknown error occurred';
}

/**
 * Order IDs are the stable identifier of one supplier group. Normalize them
 * so the same group produces the same key regardless of ordering or the
 * number/string representation returned by PostgREST.
 */
function normalizeOrderIds(value: unknown): string[] {
  if (!Array.isArray(value))
    return [];

  return [...new Set(
    value
      .map(id => (typeof id === 'string' || typeof id === 'number' ? String(id).trim() : ''))
      .filter(Boolean),
  )].sort();
}

async function idempotencyKey(orderIds: string[]): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(orderIds.join('\n')),
  );

  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

// ─────────────────────────────────────────────
// REST helpers (service role bypasses RLS)
// ─────────────────────────────────────────────

function restUrl(path: string, params?: Record<string, string>): string {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${path}`);
  for (const [key, value] of Object.entries(params ?? {}))
    url.searchParams.set(key, value);

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

  if (options.prefer)
    headers.Prefer = options.prefer;

  const response = await fetch(restUrl(path, options.params), {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const text = await response.text();

  if (!response.ok)
    throw new Error(`${path} failed (${response.status}): ${text}`);

  return text ? JSON.parse(text) as T : null;
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

  if (inserted && inserted.length > 0)
    return 'claimed';

  const existing = await fetchNotification(key);

  if (!existing)
    throw new Error('ไม่สามารถจองการแจ้งเตือนได้ กรุณาลองใหม่');

  if (existing.status === 'sent')
    return 'sent';

  const startedAt = Date.parse(existing.started_at);
  const leaseActive = Number.isFinite(startedAt) && Date.now() - startedAt < CLAIM_LEASE_MS;

  if (existing.status === 'sending' && leaseActive)
    return 'in_progress';

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

  if (claimed && claimed.length > 0)
    return 'claimed';

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
  if (req.method === 'OPTIONS')
    return new Response('ok', { headers: CORS_HEADERS });

  try {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
      throw new Error('Telegram secrets (BOT_TOKEN or CHAT_ID) are not set in Supabase.');
    }
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      throw new Error('Supabase service credentials are not available in the function environment.');
    }

    const body = await req.json().catch(() => null) as {
      message?: unknown;
      order_ids?: unknown;
    } | null;

    const message = typeof body?.message === 'string' ? body.message : '';
    const orderIds = normalizeOrderIds(body?.order_ids);

    if (!message)
      return jsonResponse({ error: 'Message text is required in the request body.' }, 400);
    if (orderIds.length === 0) {
      return jsonResponse(
        { error: 'order_ids is required so the notification can be deduplicated.' },
        400,
      );
    }

    const key = await idempotencyKey(orderIds);
    const claim = await claimNotification(key, orderIds);

    if (claim === 'sent')
      return jsonResponse({ status: 'ok', parts: 0, duplicate: true });

    if (claim === 'in_progress') {
      return jsonResponse(
        { error: 'ข้อความนี้กำลังถูกส่งอยู่ กรุณารอสักครู่แล้วลองใหม่' },
        409,
      );
    }

    try {
      const parts = await sendTelegramMessage({
        botToken: TELEGRAM_BOT_TOKEN,
        chatId: TELEGRAM_CHAT_ID,
        text: message,
        parseMode: 'MarkdownV2',
      });

      await markNotificationSent(key);
      return jsonResponse({ status: 'ok', parts });
    }
    catch (error: unknown) {
      await markNotificationFailed(key, errorMessage(error));
      throw error;
    }
  }
  catch (error: unknown) {
    return jsonResponse({ error: errorMessage(error) }, 400);
  }
});
