/** Managed previews contain synthetic data and still require explicit user access.
 * Production stays opt-in; an explicit false disables sign-in in every environment. */
export function radioClipAuthEnabled(): boolean {
  const configured = process.env.RADIO_CLIP_AUTH_ENABLED;
  if (configured === "false") return false;
  if (configured === "true") return true;
  return process.env.WC_ENVIRONMENT === "preview"
    && /^[a-f0-9]{20}$/.test(process.env.WC_PREVIEW_KEY ?? "");
}
