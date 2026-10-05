import { timingSafeEqual } from "node:crypto";

import { env } from "@/lib/env";

/** Holds the OAuth state and PKCE verifier between start and callback. */
export const OAUTH_COOKIE = "wc_youtube_oauth";
export const OAUTH_COOKIE_PATH = "/api/youtube/oauth";
export const OAUTH_COOKIE_MAX_AGE = 600;

export const oauthCookieOptions = () => ({
  httpOnly: true,
  secure: new URL(env.appUrl).protocol === "https:",
  sameSite: "lax" as const,
  path: OAUTH_COOKIE_PATH,
});

export function encodeOAuthCookie(state: string, verifier: string, userId: string): string {
  return [state, verifier, userId].join(".");
}

/** The verifier, when the returned state and signed-in user match what start issued. */
export function verifierFor(cookieValue: string | undefined, state: string | null, userId: string): string | null {
  const [expectedState, verifier, expectedUser] = (cookieValue ?? "").split(".");
  if (!expectedState || !verifier || !expectedUser || !state || expectedUser !== userId) return null;
  const a = Buffer.from(expectedState);
  const b = Buffer.from(state);
  return a.length === b.length && timingSafeEqual(a, b) ? verifier : null;
}

export function toolUrl(result: string, message?: string): URL {
  const url = new URL("/youtube", env.appUrl);
  url.searchParams.set("connection", result);
  if (message) url.searchParams.set("message", message.slice(0, 200));
  return url;
}
