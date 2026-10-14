import { withAuth } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { passkeyRegistrationOptionsSchema } from "@/lib/validation";
import { createPasskeyRegistrationOptions, verifyCurrentPassword } from "@/lib/passkey";

/** POST /api/auth/passkey/registration/options — begin an authenticated enrollment ceremony. */
export const POST = withAuth(async (req, { user }) => {
  requirePermission(user.role, "user", "edit_self");
  await enforceRateLimit(`passkey:register:options:${user.id}`, { max: 5, windowMs: 60_000 });
  const body = passkeyRegistrationOptionsSchema.parse(await req.json());
  await verifyCurrentPassword(user.id, body.currentPassword);

  const options = await createPasskeyRegistrationOptions(
    {
      id: user.id,
      email: user.email,
      name: user.name,
    },
    { automatic: body.automatic === true },
  );
  // `options` is null only for an automatic upgrade on an account that
  // already has a passkey; the client then does nothing.
  return ok({ options });
});
