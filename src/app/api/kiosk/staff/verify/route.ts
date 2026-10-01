import { z } from "zod";
import { db } from "@/lib/db";
import { withKiosk } from "@/lib/api";
import { ok } from "@/lib/http";
import { createAuditEntry } from "@/lib/audit";
import { enforceRateLimit } from "@/lib/rate-limit";
import { kioskRosterUserWhere } from "@/lib/user-visibility";
import { normalizeWiscardNumber, wiscardScanWhere } from "@/lib/validation";
import { canManageAnyCheckout } from "@/lib/services/kiosk-actor";
import { issueKioskStaffToken } from "@/lib/kiosk-staff-token";

const verifyBody = z.object({
  scanValue: z.string().trim().min(1).max(128),
});

/**
 * POST /api/kiosk/staff/verify — C5 staff proof. A staff ID card scan returns
 * the staff person and a 10-minute token bound to them and this kiosk. Staff
 * actions on someone else's booking send it as `X-Kiosk-Staff-Token`.
 * Refusals answer `success: false` with a sentence, like identify.
 */
export const POST = withKiosk(async (req, { kiosk }) => {
  await enforceRateLimit(`kiosk:staff-verify:${kiosk.kioskId}`, { max: 20, windowMs: 60_000 });
  const body = verifyBody.parse(await req.json());
  const wiscardNumber = normalizeWiscardNumber(body.scanValue);
  if (!wiscardNumber) {
    return ok({ success: false, error: "That isn't an ID card. Scan your staff ID card." });
  }

  const user = await db.user.findFirst({
    where: { AND: [kioskRosterUserWhere(), wiscardScanWhere(wiscardNumber) ?? {}] },
    select: { id: true, name: true, avatarUrl: true, role: true },
  });
  if (!user) {
    return ok({ success: false, error: "No one matches that card. Scan your staff ID card." });
  }

  if (!canManageAnyCheckout(user.role)) {
    await createAuditEntry({
      actorId: user.id,
      actorRole: user.role,
      entityType: "user",
      entityId: user.id,
      action: "kiosk_staff_verify_refused",
      after: { kioskDeviceId: kiosk.kioskId },
    });
    return ok({ success: false, error: "That card isn't a staff card." });
  }

  const { token, expiresAt } = issueKioskStaffToken({ userId: user.id, kioskId: kiosk.kioskId });
  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "user",
    entityId: user.id,
    action: "kiosk_staff_verified",
    after: { kioskDeviceId: kiosk.kioskId, expiresAt: expiresAt.toISOString() },
  });

  return ok({ success: true, data: { user, staffToken: token, expiresAt: expiresAt.toISOString() } });
});
