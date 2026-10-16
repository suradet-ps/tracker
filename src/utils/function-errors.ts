import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';

/**
 * Reads the real message from a failed `supabase.functions.invoke` call.
 *
 * The SDK keeps a non-2xx response body in `error.context` while
 * `error.message` is only the generic "non-2xx status code", so the
 * server-side message (for example about missing Telegram secrets) never
 * reaches the operator without this.
 */
export async function extractFunctionErrorMessage(err: unknown): Promise<string> {
  if (err instanceof FunctionsHttpError) {
    try {
      const body = await (err.context as Response).json() as { error?: unknown };
      if (typeof body?.error === 'string' && body.error)
        return body.error;
    }
    catch {
      // Non-JSON error body: fall back to the generic SDK message.
    }
  }

  return err instanceof Error ? err.message : String(err);
}

/**
 * True when the invoke was aborted by its `timeout` option: the SDK wraps
 * the fetch AbortError in a `FunctionsFetchError`.
 */
export function isFunctionTimeoutError(err: unknown): boolean {
  return err instanceof FunctionsFetchError
    && (err.context as { name?: string } | undefined)?.name === 'AbortError';
}
