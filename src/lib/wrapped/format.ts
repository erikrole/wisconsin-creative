/** Client-safe: big numbers read with thousands separators; the card count-up uses the same format. */
export function formatCount(count: number): string {
  return count.toLocaleString("en-US");
}
