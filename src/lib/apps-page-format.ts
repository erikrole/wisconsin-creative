/** Formats a plain YYYY-MM-DD date (already in Madison time) without shifting it across time zones. */
export function formatAppDate(date: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${date}T12:00:00Z`),
  );
}
