import { db } from "@/lib/db";
import { randomHex, tokenHash } from "@/lib/auth";

/**
 * The sign-up link token an invite email carries (D-037 amendment, 2026-10-23).
 *
 * Knowing an invited address is not proof of owning its inbox, so sign-up
 * also needs the token that only the email delivered. The database keeps an
 * HMAC of it; the raw value lives in the link alone. Every send rotates it,
 * so a resend invalidates the older link, and a claim clears it.
 */
export const INVITE_TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

/** Mint a fresh token for an unclaimed invite and return the raw value for the link. */
export async function issueInviteToken(allowedEmailId: string): Promise<string | null> {
  const raw = randomHex(32);
  const issued = await db.allowedEmail.updateMany({
    where: { id: allowedEmailId, claimedAt: null },
    data: { inviteTokenHash: await tokenHash(raw), inviteTokenIssuedAt: new Date() },
  });
  return issued.count === 1 ? raw : null;
}

/** True when `raw` is the current, unexpired token for this invite row. */
export async function inviteTokenMatches(
  invite: { inviteTokenHash: string | null; inviteTokenIssuedAt: Date | null },
  raw: string | null | undefined,
  now = new Date(),
): Promise<boolean> {
  if (!raw || !invite.inviteTokenHash || !invite.inviteTokenIssuedAt) return false;
  if (invite.inviteTokenIssuedAt.getTime() + INVITE_TOKEN_TTL_MS <= now.getTime()) return false;
  return (await tokenHash(raw)) === invite.inviteTokenHash;
}
