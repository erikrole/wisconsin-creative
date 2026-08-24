import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { withAuth } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createAuditEntry } from "@/lib/audit";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { passkeyRegistrationVerifySchema } from "@/lib/validation";
import { verifyPasskeyRegistration } from "@/lib/passkey";

/** POST /api/auth/passkey/registration/verify — finish an authenticated enrollment ceremony. */
export const POST = withAuth(async (req, { user }) => {
  requirePermission(user.role, "user", "edit_self");
  await enforceRateLimit(`passkey:register:verify:${user.id}`, { max: 10, windowMs: 60_000 });
  const body = passkeyRegistrationVerifySchema.parse(await req.json());
  const credential = await verifyPasskeyRegistration(
    user.id,
    body.response as unknown as RegistrationResponseJSON,
    body.name,
    req.headers.get("user-agent"),
  );

  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "passkey_credential",
    entityId: credential.id,
    action: "passkey_registered",
    after: {
      name: credential.name,
      deviceType: credential.deviceType,
      backedUp: credential.backedUp,
    },
  });

  return ok({
    data: {
      id: credential.id,
      name: credential.name,
      createdAt: credential.createdAt,
    },
  }, 201);
});
