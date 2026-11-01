export type ApiTokenScope = "READ" | "WRITE";

export const API_TOKEN_PREFIX = "wc_";
export const API_TOKEN_MAX_DAYS = 365;

/** The raw token from an `Authorization: Bearer wc_...` header, if one was sent. */
export function bearerTokenFrom(authorization: string | null | undefined): string | null {
  const match = /^Bearer\s+(wc_[0-9a-f]{64})$/i.exec(authorization ?? "");
  return match?.[1] ?? null;
}

const TOKEN_BLOCKED_PATHS = [
  /^\/api\/auth(\/|$)/,
  /^\/api\/me\/(change-password|account|passkeys|sessions|api-tokens)(\/|$)/,
];
const TOKEN_BLOCKED_ADMIN_WRITES = /^\/api\/users(\/[^/]+\/(reset-password|role))?\/?$/;

/** Credential, session and account-takeover routes that stay browser-only. */
export function isTokenBlockedRequest(pathname: string, method: string): boolean {
  if (TOKEN_BLOCKED_PATHS.some((re) => re.test(pathname))) return true;
  return method !== "GET" && method !== "HEAD" && TOKEN_BLOCKED_ADMIN_WRITES.test(pathname);
}
