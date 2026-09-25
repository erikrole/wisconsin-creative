import { randomBytes } from "crypto";
import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { ok } from "@/lib/http";
import { createAuditEntry } from "@/lib/audit";
import { enforceRateLimit } from "@/lib/rate-limit";
import { requireInternalActor } from "@/lib/rbac";
import { hashIcsToken, isHashedIcsToken } from "@/lib/ics-token";
import { env } from "@/lib/env";

/** The canonical feed URL, never the caller's origin (a legacy host dies). */
function feedUrl(token: string) {
  return `${env.appUrl}/api/shifts/ics/${token}`;
}

// Reports whether the current user has a feed. The stored value is a hash, so
// the raw token is only returned for a legacy raw row, once, while that row is
// upgraded to the hashed form; clients keep it from then on.
//
// A client holding a raw token can send it in `X-ICS-Token-Check` (a header,
// so it stays out of URLs and logs) to learn whether it is still current,
// i.e. whether the link was reset on another device.
export const GET = withAuth(async (req, { user }) => {
  requireInternalActor(user);
  const row = await db.user.findUnique({
    where: { id: user.id },
    select: { icsToken: true },
  });
  const stored = row?.icsToken ?? null;
  const check = req.headers.get("x-ics-token-check");
  const matches = check && stored
    ? stored === hashIcsToken(check) || stored === check
    : undefined;
  if (!stored) return ok({ data: { token: null, hasToken: false, ...(check ? { matches: false } : {}) } });
  if (isHashedIcsToken(stored)) return ok({ data: { token: null, hasToken: true, ...(matches !== undefined ? { matches } : {}) } });
  // Conditional on the raw value, so a rotation racing this read wins.
  await db.user.updateMany({
    where: { id: user.id, icsToken: stored },
    data: { icsToken: hashIcsToken(stored) },
  });
  return ok({ data: { token: stored, hasToken: true, feedUrl: feedUrl(stored) } });
});

// Generate or rotate the current user's ICS subscription token. Rotating
// invalidates the previous URL — if a user accidentally shared their
// calendar feed (Google Calendar shared with a household, screenshot in
// Slack, etc.), this is the recovery path.
export const POST = withAuth(async (_req, { user }) => {
  requireInternalActor(user);
  await enforceRateLimit(`shifts:ics-token:${user.id}`, { max: 5, windowMs: 60 * 60_000 });
  const token = randomBytes(24).toString("hex");
  await db.user.update({
    where: { id: user.id },
    data: { icsToken: hashIcsToken(token) },
  });
  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "user",
    entityId: user.id,
    action: "ics_token_rotated",
  });
  return ok({ data: { token, hasToken: true, feedUrl: feedUrl(token) } });
});
