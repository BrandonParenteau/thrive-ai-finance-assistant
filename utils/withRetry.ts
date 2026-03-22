/**
 * Retries an async operation up to maxAttempts times with exponential backoff.
 * Only retries on transient network / rate-limit errors — not on auth or
 * validation failures that will never succeed on a retry.
 */

const RETRYABLE_PATTERNS = [
  "network request failed",
  "failed to fetch",
  "timeout",
  "timed out",
  "etimedout",
  "econnreset",
  "econnrefused",
  "503",
  "429",
  "resource-exhausted",
  "unavailable",
  "deadline-exceeded",
  "too many requests",
];

function isRetryable(error: unknown): boolean {
  const err = error as any;
  const msg = (err?.message ?? "").toLowerCase();
  const code = (err?.code ?? "").toLowerCase();
  const status = err?.status ?? err?.statusCode ?? 0;
  if (status === 429 || status === 503) return true;
  return RETRYABLE_PATTERNS.some((p) => msg.includes(p) || code.includes(p));
}

export interface RetryOptions {
  maxAttempts?: number;
  /** Base delay in ms — doubles on each retry (1 000, 2 000, 4 000 …) */
  baseDelayMs?: number;
  onRetry?: (attempt: number, error: unknown) => void;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const { maxAttempts = 3, baseDelayMs = 1_000, onRetry } = options;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt >= maxAttempts || !isRetryable(err)) {
        throw err;
      }
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      onRetry?.(attempt, err);
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
