import { z } from "zod";

export const RADIO_CLIP_CALLBACK = "com.wisconsincreative.radioclip:/authorize";
export const authorizationInput = z.object({
  state: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
  codeChallenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
}).strict();
export const exchangeInput = z.object({
  code: z.string().regex(/^[a-f0-9]{64}$/),
  codeVerifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
}).strict();

// Login may return only to this exact first-party flow, never an arbitrary URL.
export function radioClipReturnTo(raw: unknown): string {
  if (typeof raw !== "string" || !raw.startsWith("/radio-clip/authorize?")) return "/";
  try {
    const url = new URL(raw, "https://local.invalid");
    if (url.origin !== "https://local.invalid" || url.pathname !== "/radio-clip/authorize" || url.hash) return "/";
    const input = authorizationInput.parse(Object.fromEntries(url.searchParams));
    return `/radio-clip/authorize?${new URLSearchParams(input)}`;
  } catch { return "/"; }
}
