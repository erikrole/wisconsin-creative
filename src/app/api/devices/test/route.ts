import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { ok } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";
import { sendPush } from "@/lib/push/apns";
import { z } from "zod";

/** A real push per call; a handful a minute covers "tap again to be sure". */
const TEST_PUSH_LIMIT = { max: 5, windowMs: 60_000 };

const testPushSchema = z.object({
  token: z.string().min(1).max(512),
});

/**
 * Sends a real test push to the caller's current app installation and reports the
 * outcome, so "are my notifications working?" is answerable from the phone
 * in one tap instead of by reading serverless logs.
 */
export const POST = withAuth(async (req, { user }) => {
  await enforceRateLimit(`push-test:apns:${user.id}`, TEST_PUSH_LIMIT);
  const body = testPushSchema.parse(await req.json());
  const tokens = await db.deviceToken.findMany({
    where: { userId: user.id, token: body.token, revokedAt: null },
    select: { token: true },
  });

  if (tokens.length === 0) {
    return ok({ delivered: 0, devices: 0, revoked: 0 });
  }

  const { revoked, ok: delivered } = await sendPush(
    tokens.map((t) => t.token),
    {
      title: "Test notification",
      body: "Push delivery is working on this device.",
      payload: { href: "/notifications" },
      interruptionLevel: "passive",
    }
  );

  if (revoked.length > 0) {
    await db.deviceToken.updateMany({
      where: { token: { in: revoked } },
      data: { revokedAt: new Date() },
    });
  }

  return ok({ delivered, devices: tokens.length, revoked: revoked.length });
});
