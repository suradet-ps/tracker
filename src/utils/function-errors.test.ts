import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { extractFunctionErrorMessage, isFunctionTimeoutError } from '@/utils/function-errors';

const HTTP_FALLBACK = 'Edge Function returned a non-2xx status code';

describe('extractFunctionErrorMessage', () => {
  it('reads the server error text from the HTTP error context', async () => {
    const body = { error: 'Telegram secrets (BOT_TOKEN or CHAT_ID) are not set in Supabase.' };
    const error = new FunctionsHttpError(new Response(JSON.stringify(body), { status: 400 }));

    await expect(extractFunctionErrorMessage(error)).resolves.toBe(body.error);
  });

  it('falls back to the generic message when the body is not JSON', async () => {
    const error = new FunctionsHttpError(new Response('bad gateway', { status: 502 }));

    await expect(extractFunctionErrorMessage(error)).resolves.toBe(HTTP_FALLBACK);
  });

  it('falls back to the generic message when the JSON body has no error field', async () => {
    const error = new FunctionsHttpError(new Response(JSON.stringify({ message: 'nope' }), { status: 400 }));

    await expect(extractFunctionErrorMessage(error)).resolves.toBe(HTTP_FALLBACK);
  });

  it('returns the message of plain errors and stringifies anything else', async () => {
    await expect(extractFunctionErrorMessage(new Error('boom'))).resolves.toBe('boom');
    await expect(extractFunctionErrorMessage('weird')).resolves.toBe('weird');
  });
});

describe('isFunctionTimeoutError', () => {
  it('detects the abort wrapped by the SDK timeout', () => {
    const abort = new DOMException('The operation was aborted.', 'AbortError');

    expect(isFunctionTimeoutError(new FunctionsFetchError(abort))).toBe(true);
  });

  it('rejects other fetch errors and HTTP errors', () => {
    expect(isFunctionTimeoutError(new FunctionsFetchError(new TypeError('fetch failed')))).toBe(false);
    expect(isFunctionTimeoutError(new FunctionsHttpError(new Response('x', { status: 500 })))).toBe(false);
    expect(isFunctionTimeoutError(new Error('plain'))).toBe(false);
  });
});
