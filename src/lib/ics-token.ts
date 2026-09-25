import { createHash } from "node:crypto";

/**
 * Shift-calendar feed tokens are stored as a SHA-256 digest, so a database
 * read or dump never yields a working feed URL. The raw token exists only in
 * the POST response that minted it and in the subscribed calendar.
 *
 * Tokens minted before hashing are still stored raw. They keep working, and
 * `GET /api/shifts/ics-token` upgrades one to the hashed form the first time
 * its owner reads it.
 */
const HASHED_PREFIX = "sha256:";

export function hashIcsToken(raw: string): string {
  return HASHED_PREFIX + createHash("sha256").update(raw).digest("hex");
}

export function isHashedIcsToken(stored: string | null | undefined): boolean {
  return typeof stored === "string" && stored.startsWith(HASHED_PREFIX);
}

/** Stored values that match a presented raw token: hashed, or legacy raw. */
export function icsTokenLookupValues(raw: string): string[] {
  return [hashIcsToken(raw), raw];
}
