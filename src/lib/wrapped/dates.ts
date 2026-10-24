/**
 * Client-safe Wrapped dates. `recap.ts` derives the same instants from the app
 * timezone on the server; a test keeps the two in step.
 */
export const WRAPPED_UNLOCK_ISO = "2026-12-01T06:00:00.000Z";
/** The admin preview row stays hidden until Erik's real-data check (Nov 15, Central). */
export const WRAPPED_PREVIEW_START_ISO = "2026-11-15T06:00:00.000Z";
/** Entry points stop inviting people in after the holidays. */
export const WRAPPED_PROMO_END_ISO = "2027-01-16T06:00:00.000Z";

/** Collaborators can see the Scoreboard but not Wrapped, so they get no door. */
export function wrappedPromoState(now: Date, role: string | null | undefined): "hidden" | "preview" | "open" {
  if (!role || role === "COLLABORATOR") return "hidden";
  const isAdmin = role === "ADMIN";
  const time = now.getTime();
  if (time >= Date.parse(WRAPPED_UNLOCK_ISO)) return time < Date.parse(WRAPPED_PROMO_END_ISO) ? "open" : "hidden";
  return isAdmin && time >= Date.parse(WRAPPED_PREVIEW_START_ISO) ? "preview" : "hidden";
}
