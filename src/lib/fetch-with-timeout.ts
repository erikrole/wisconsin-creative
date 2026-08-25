/**
 * Fetch wrapper that aborts after a timeout.
 * Prevents UI from hanging indefinitely when Vercel serverless times out.
 */
export const BOOKING_MUTATION_TIMEOUT_MS = 30_000;

export function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit & { timeoutMs?: number },
): Promise<Response> {
  const { timeoutMs = 8000, ...fetchInit } = init ?? {};
  const controller = new AbortController();

  // Chain with any existing signal
  if (fetchInit.signal) {
    fetchInit.signal.addEventListener("abort", () => controller.abort());
  }

  const timer = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(input, { ...fetchInit, signal: controller.signal }).finally(() =>
    clearTimeout(timer),
  );
}
