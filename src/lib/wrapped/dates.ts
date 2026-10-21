/**
 * Client-safe Wrapped dates. `recap.ts` derives the same instants from the app
 * timezone on the server; a test keeps the two in step.
 */
export const WRAPPED_UNLOCK_ISO = "2026-12-01T06:00:00.000Z";
/** Entry points stop inviting people in after the holidays. */
export const WRAPPED_PROMO_END_ISO = "2027-01-16T06:00:00.000Z";

export function wrappedPromoState(now: Date, isAdmin: boolean): "hidden" | "preview" | "open" {
  const time = now.getTime();
  if (time >= Date.parse(WRAPPED_UNLOCK_ISO)) return time < Date.parse(WRAPPED_PROMO_END_ISO) ? "open" : "hidden";
  return isAdmin ? "preview" : "hidden";
}
