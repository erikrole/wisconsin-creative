import { db } from "@/lib/db";
import { withHandler } from "@/lib/api";
import { HttpError, ok } from "@/lib/http";
import { tokenHash, createKioskSession } from "@/lib/auth";
import { checkRateLimit, enforceRateLimit, getClientIp, isRateLimitExhausted } from "@/lib/rate-limit";
import { activateBody } from "@/lib/schemas/kiosk";
import { createSystemAuditEntry } from "@/lib/audit";
import { deferCompanionProjectionRefreshForCommittedMutation } from "@/lib/services/companion-projection-publisher";

/**
 * Activate a kiosk device with a 6-digit code.
 * No auth required — this IS the auth bootstrapping step.
 *
 * Rate-limited per IP to slow brute-force enumeration of the 6-digit
 * (~1M) keyspace. The limiter is Upstash/KV-backed cross-instance in
 * production, with a per-instance in-memory fallback (see lib/rate-limit.ts).
 *
 * Per-IP limits alone do not bound a distributed guesser, so failed
 * activations across every IP also share one global budget. Only failures
 * count toward it; once it is spent, activation pauses for everyone until the
 * window rolls over.
 */
const ACTIVATION_GLOBAL_FAILURE_KEY = "kiosk:activate:failures:global";
const ACTIVATION_GLOBAL_FAILURE_LIMIT = { max: 30, windowMs: 60 * 60_000 };

async function rejectActivation(message: string): Promise<never> {
  await checkRateLimit(ACTIVATION_GLOBAL_FAILURE_KEY, ACTIVATION_GLOBAL_FAILURE_LIMIT);
  throw new HttpError(401, message);
}

export const POST = withHandler(async (req) => {
  const ip = getClientIp(req);
  await enforceRateLimit(`kiosk:activate:${ip}`, { max: 5, windowMs: 15 * 60_000 });
  if (await isRateLimitExhausted(ACTIVATION_GLOBAL_FAILURE_KEY, ACTIVATION_GLOBAL_FAILURE_LIMIT)) {
    throw new HttpError(
      429,
      "Kiosk activation is paused after too many incorrect codes. Try again in an hour, or ask an admin for help.",
    );
  }

  const { code } = activateBody.parse(await req.json());
  const hashedCode = await tokenHash(code);
  await enforceRateLimit(`kiosk:activate:code:${hashedCode}`, { max: 5, windowMs: 60 * 60_000 });

  // Hash the code and look up device
  const device = await db.kioskDevice.findUnique({
    where: { activationCode: hashedCode },
    include: { location: { select: { id: true, name: true } } },
  });

  if (!device) {
    return rejectActivation("Invalid activation code");
  }

  if (!device.active) {
    return rejectActivation("This kiosk device has been deactivated");
  }

  // Codes are time-bounded. A null expiry means the code was already redeemed
  // (cleared below) or predates this field — treat both as no longer valid.
  if (!device.activationCodeExpiresAt || device.activationCodeExpiresAt <= new Date()) {
    return rejectActivation("This activation code has expired. Ask an admin to generate a new one.");
  }

  // Single-use: atomically clear the code so it can't be redeemed twice. The
  // guarded updateMany means only one of two concurrent requests wins the
  // redemption — the loser sees count 0 and is rejected. Already-activated
  // kiosks stay signed in via the sliding session, so this never forces the
  // fleet to re-activate; only a fresh code can mint a new session.
  const redeemed = await db.kioskDevice.updateMany({
    where: { id: device.id, activationCode: hashedCode },
    data: { activationCode: null, activationCodeExpiresAt: null },
  });
  if (redeemed.count !== 1) {
    return rejectActivation("Invalid activation code");
  }

  // Create session (sets cookie) and return the raw token to the native app so
  // it can survive app-container wipes by mirroring the token into Keychain.
  const sessionToken = await createKioskSession(device.id);
  deferCompanionProjectionRefreshForCommittedMutation(req);

  // Audit kiosk activation (no user actor — use device ID as entity)
  await createSystemAuditEntry({
    entityType: "kiosk_device",
    entityId: device.id,
    action: "kiosk_activated",
    after: { deviceName: device.name, locationId: device.locationId, ip },
  });

  return ok({
    kioskId: device.id,
    name: device.name,
    location: device.location,
    sessionToken,
  });
});
