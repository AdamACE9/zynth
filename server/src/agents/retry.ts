/**
 * One retry layer for model calls, for the demo-critical paths.
 *
 * Why: every Gemini call in this codebase is wrapped in a try/catch that
 * degrades to deterministic stub content, which is the right instinct — the app
 * must never hard-fail mid-demo. But it means a *single* transient blip silently
 * costs the student real output. During one hour of testing this fired three
 * times, twice from `ConnectTimeoutError` (undici's 10s connect timeout, tried
 * IPv6 first) and once from a truncated response. The student saw a quiz full of
 * "[stub] Which statement best describes X?" placeholders, which reads as "this
 * product is fake" rather than "the network hiccuped" — and the quiz is the only
 * route to green, so it is the worst possible place to degrade.
 *
 * One cheap retry converts most of those into a normal call. This deliberately
 * does NOT replace the stub fallback; it just stops the fallback being reached by
 * a blip that would have succeeded 400ms later.
 *
 * Only transient faults are retried. A malformed prompt or a bad API key fails
 * identically on the second attempt, so retrying those just doubles the latency
 * before the inevitable fallback.
 */

/** Retryable: transport-level faults and server-side "try again" responses. */
function isTransient(err: unknown): boolean {
  const message = err instanceof Error ? `${err.message} ${String((err as { cause?: unknown }).cause ?? '')}` : String(err);
  const haystack = message.toLowerCase();

  return (
    haystack.includes('fetch failed') ||
    haystack.includes('connecttimeout') ||
    haystack.includes('etimedout') ||
    haystack.includes('econnreset') ||
    haystack.includes('econnrefused') ||
    haystack.includes('enotfound') ||
    haystack.includes('eai_again') ||
    haystack.includes('socket hang up') ||
    haystack.includes('network') ||
    // Rate limit / transient server errors from the API itself.
    haystack.includes('429') ||
    haystack.includes('resource_exhausted') ||
    haystack.includes('500') ||
    haystack.includes('503') ||
    haystack.includes('unavailable') ||
    // A truncated JSON body is worth one more roll of the dice: output length is
    // not deterministic, so the same prompt often comes back inside the budget.
    haystack.includes('unterminated string') ||
    haystack.includes('unexpected end of json')
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RetryOptions {
  /** Total attempts including the first. Default 2 — enough for a blip, not enough to stall a demo. */
  attempts?: number;
  /** Base delay; doubles per attempt. Rate-limit errors wait considerably longer. */
  baseDelayMs?: number;
  /** Shows up in the warning line so logs say which call retried. */
  label?: string;
}

/**
 * Runs `fn`, retrying transient failures. Re-throws the LAST error once attempts
 * are exhausted, so the caller's existing stub fallback still runs exactly as
 * before — this is strictly a layer in front of it, never a replacement.
 */
export async function withModelRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 2);
  const baseDelay = options.baseDelayMs ?? 450;
  const label = options.label ?? 'model call';

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (attempt >= attempts || !isTransient(err)) break;

      const message = err instanceof Error ? err.message : String(err);
      // A rate limit needs real time to clear; a dropped socket does not.
      const rateLimited = /429|resource_exhausted/i.test(message);
      const delay = rateLimited ? 2500 * attempt : baseDelay * 2 ** (attempt - 1);

      console.warn(
        `[retry] ${label} attempt ${attempt}/${attempts} failed (${message.slice(0, 120)}); retrying in ${delay}ms`,
      );
      await sleep(delay);
    }
  }

  throw lastError;
}
