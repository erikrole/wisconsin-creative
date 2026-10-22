import { lookup } from "node:dns/promises";

/**
 * Reject URLs whose hostname resolves to a private, loopback, link-local,
 * CGNAT, or otherwise non-routable address. Done post-DNS so attackers
 * can't bypass with a public DNS record pointing at 127.0.0.1 (or AWS
 * metadata at 169.254.169.254, etc.).
 *
 * Throws a generic Error on rejection — callers wrap it in HttpError.
 */
export async function assertPublicHost(hostname: string): Promise<void> {
  const { address, family } = await lookup(hostname);
  const isPrivate =
    family === 4
      ? isPrivateIPv4(address)
      : family === 6
        ? isPrivateIPv6(address)
        : true;
  if (isPrivate) {
    throw new Error(`Host ${hostname} resolves to a private or non-routable address (${address}).`);
  }
}

function isPrivateIPv4(addr: string): boolean {
  const o = addr.split(".").map((n) => Number(n));
  if (o.length !== 4 || o.some((n) => Number.isNaN(n))) return true;
  const [a = 0, b = 0] = o; // length === 4 guaranteed by guard above
  return (
    a === 0 ||                            // 0.0.0.0/8
    a === 10 ||                           // 10/8
    a === 127 ||                          // loopback
    (a === 169 && b === 254) ||           // link-local (incl. AWS metadata 169.254.169.254)
    (a === 172 && b >= 16 && b <= 31) || // 172.16/12
    (a === 192 && b === 168) ||           // 192.168/16
    (a === 100 && b >= 64 && b <= 127) || // CGNAT 100.64/10
    a >= 224                              // multicast + reserved
  );
}

function isPrivateIPv6(addr: string): boolean {
  const lower = addr.toLowerCase();
  if (lower === "::" || lower === "::1") return true;
  if (lower.startsWith("fe80:")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique-local
  if (lower.startsWith("ff")) return true; // multicast
  if (lower.startsWith("::ffff:")) {
    // IPv4-mapped — re-check the v4 portion. Node may print it dotted
    // (::ffff:127.0.0.1) or as two hex groups (::ffff:7f00:1).
    const v4 = lower.slice("::ffff:".length);
    if (v4.includes(".")) return isPrivateIPv4(v4);
    const groups = v4.split(":").map((g) => Number.parseInt(g, 16));
    if (groups.length !== 2 || groups.some((g) => Number.isNaN(g))) return true;
    const [hi = 0, lo = 0] = groups;
    return isPrivateIPv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  return false;
}

const MAX_REDIRECTS = 5;

/**
 * fetch() that re-validates the destination on every redirect hop. A plain
 * fetch follows redirects itself, so a public URL that 302s to an internal
 * address would skip the check made on the first hostname.
 */
export async function fetchPublicUrl(url: string, init: RequestInit = {}): Promise<Response> {
  let current = new URL(url);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (current.protocol !== "http:" && current.protocol !== "https:") {
      throw new Error("URL must use http or https.");
    }
    await assertPublicHost(current.hostname);
    const response = await fetch(current, { ...init, redirect: "manual" });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location) return response;
    current = new URL(location, current);
  }
  throw new Error("Too many redirects.");
}
