import { db } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { HttpError, ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { createAuditEntry } from "@/lib/audit";
import { tokenHash, KIOSK_ACTIVATION_CODE_TTL_MS } from "@/lib/auth";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { generateActivationCode } from "@/lib/kiosk-activation";

/**
 * Regenerate the one-shot activation code for a kiosk device.
 * If the device is already activated, this intentionally resets its kiosk
 * session so staff can re-activate the same device row after an app reinstall.
 */
export const POST = withAuth<{ id: string }>(async (_req, { user, params }) => {
  requirePermission(user.role, "kiosk_device", "edit");
  await enforceRateLimit(`kiosk-devices:write:${user.id}`, SETTINGS_MUTATION_LIMIT);

  const device = await db.kioskDevice.findUnique({ where: { id: params.id } });
  if (!device) throw new HttpError(404, "Kiosk device not found");

  const rawCode = generateActivationCode();
  const hashedCode = await tokenHash(rawCode);
  const wasActivated = Boolean(device.activatedAt);

  await db.kioskDevice.update({
    where: { id: params.id },
    data: {
      activationCode: hashedCode,
      activationCodeExpiresAt: new Date(Date.now() + KIOSK_ACTIVATION_CODE_TTL_MS),
      activatedAt: null,
      sessionToken: null,
      sessionExpiresAt: null,
      lastSeenAt: null,
    },
  });

  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "kiosk_device",
    entityId: device.id,
    action: "regenerate_activation_code",
    before: { name: device.name, activated: wasActivated },
    after: { name: device.name, activated: false, sessionReset: wasActivated },
  });

  return ok({
    id: device.id,
    name: device.name,
    activationCode: rawCode,
    resetSession: wasActivated,
  });
});
