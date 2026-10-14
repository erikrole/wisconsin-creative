const PLACEHOLDER_ORIGIN = "https://return-to.invalid";

/**
 * Where to send someone after they sign in, from an untrusted `?returnTo=`.
 * Only a same-origin app path survives: absolute and protocol-relative URLs,
 * backslash tricks, API routes, and the auth pages themselves all fall back
 * to null so the caller uses its default destination.
 */
export function safeReturnTo(value: string | null | undefined): string | null {
  if (!value || value.length > 2048) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  // Control characters (tabs, newlines) are stripped by URL parsing and can
  // turn "/\t/evil.com" into a protocol-relative URL.
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;

  let url: URL;
  try {
    url = new URL(value, PLACEHOLDER_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== PLACEHOLDER_ORIGIN) return null;

  const path = url.pathname;
  if (
    path === "/login" ||
    path.startsWith("/api/") ||
    path === "/change-password" ||
    path === "/forgot-password" ||
    path === "/reset-password" ||
    path === "/register"
  ) {
    return null;
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

export function loginPathWithReturnTo(returnTo: string | null | undefined): string {
  const safe = safeReturnTo(returnTo);
  return safe && safe !== "/" ? `/login?returnTo=${encodeURIComponent(safe)}` : "/login";
}
