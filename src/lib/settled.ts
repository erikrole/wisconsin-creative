/**
 * Reads `Promise.allSettled` results for aggregate endpoints that should still
 * answer when one query fails. A rejected result is logged under `scope`, its
 * label is recorded in `partialFailures`, and the fallback is returned so the
 * response can render the rest.
 *
 *   const settledValue = settledReader("dashboard");
 *   const count = settledValue(countResult, 0, "count", partialFailures);
 */
export function settledReader(scope: string) {
  return function settledValue<T>(
    result: PromiseSettledResult<T>,
    fallback: T,
    label: string,
    partialFailures: string[],
  ): T {
    if (result.status === "fulfilled") return result.value;
    console.error(`[${scope}] ${label} failed`, result.reason);
    partialFailures.push(label);
    return fallback;
  };
}
