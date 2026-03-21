/**
 * Run async fn up to maxAttempts times; delay between failures.
 * @param {(attempt: number) => Promise<T>} fn
 * @param {{
 *   maxAttempts?: number,
 *   delayMs?: number | ((err: Error, failedAttempt: number) => number),
 *   onRetry?: (err: Error, failedAttempt: number, delayMs: number) => void
 * }} opts
 * @returns {Promise<T>}
 */
export async function withRetry(fn, opts = {}) {
  const maxAttempts = opts.maxAttempts ?? 2;
  let lastErr = new Error("withRetry: no attempts");
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      if (attempt < maxAttempts) {
        const raw =
          typeof opts.delayMs === "function"
            ? opts.delayMs(lastErr, attempt)
            : (opts.delayMs ?? 2500);
        const delayMs = Math.max(0, Math.round(Number(raw) || 0));
        opts.onRetry?.(lastErr, attempt, delayMs);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  throw lastErr;
}
