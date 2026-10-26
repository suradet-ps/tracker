import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';

/** A stalled error body must not keep the sending modal locked forever. */
const FUNCTION_ERROR_BODY_TIMEOUT_MS = 5_000;

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
    let bodyTimeoutId: ReturnType<typeof setTimeout> | undefined;

    try {
      const body = await Promise.race([
        (err.context as Response).json() as Promise<{ error?: unknown }>,
        new Promise<null>((resolve) => {
          bodyTimeoutId = setTimeout(resolve, FUNCTION_ERROR_BODY_TIMEOUT_MS, null);
        }),
      ]);

      if (typeof body?.error === 'string' && body.error)
        return body.error;
    }
    catch {
      // Non-JSON error body: fall back to the generic SDK message.
    }
    finally {
      if (bodyTimeoutId !== undefined)
        clearTimeout(bodyTimeoutId);
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
