import { db } from "@/lib/db";
import { createSession, verifyPassword } from "@/lib/auth";
import { HttpError, ok } from "@/lib/http";
import { loginSchema } from "@/lib/validation";
import { withHandler } from "@/lib/api";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { createAuditEntry } from "@/lib/audit";
import {
  capabilitiesForActor,
  collaboratorPolicyMetadataForActor,
  compatibilityCollaboratorProfile,
  requireActiveCollaboratorPolicy,
} from "@/lib/collaborator-access";
import { collaboratorPolicyActorSelect } from "@/lib/services/collaborator-policies";
import { getCompanionUserEpoch, issueCompanionSession } from "@/lib/companion-store";
import { projectionForRole } from "@/lib/companion-projection-contract";
import { refreshCompanionProjection } from "@/lib/services/companion-projection";

// Per-account limit is the real brute-force defense; the per-IP ceiling is a
// generous backstop sized so a shared office/campus NAT (many users behind one
// public IP) does not lock out legitimate logins at peak.
const LOGIN_EMAIL_LIMIT = { max: 10, windowMs: 15 * 60 * 1000 }; // per account
const LOGIN_IP_LIMIT = { max: 150, windowMs: 15 * 60 * 1000 }; // per shared IP

export const POST = withHandler(async (req) => {
  const ip = getClientIp(req);
  const body = loginSchema.parse(await req.json());
  const email = body.email.toLowerCase();

  const [ipCheck, emailCheck] = await Promise.all([
    checkRateLimit(`login:ip:${ip}`, LOGIN_IP_LIMIT),
    checkRateLimit(`login:email:${email}`, LOGIN_EMAIL_LIMIT),
  ]);
  if (!ipCheck.allowed || !emailCheck.allowed) {
    throw new HttpError(429, "Too many login attempts. Please try again later.");
  }

  const user = await db.user.findUnique({
    where: { email },
    include: { collaboratorPolicy: { select: collaboratorPolicyActorSelect } },
  });

  if (!user) {
    throw new HttpError(401, "Invalid credentials");
  }

  // Verify the password before revealing anything account-specific. Checking
  // `active` first would let an unauthenticated caller enumerate which emails
  // map to deactivated accounts (403) versus valid-but-wrong-password (401).
  const valid = await verifyPassword(user.passwordHash, body.password);
  if (!valid) {
    throw new HttpError(401, "Invalid credentials");
  }

  if (!user.active) {
    throw new HttpError(403, "Your account has been deactivated. Contact Erik Role.");
  }

  requireActiveCollaboratorPolicy(user);

  const collaboratorPolicy = collaboratorPolicyMetadataForActor(user);

  const companionLogin = body.companion === true;
  if (companionLogin && user.forcePasswordChange) {
    throw new HttpError(403, "Change your password in Wisconsin Creative before enrolling this companion.");
  }
  if (!companionLogin) {
    await createSession(user.id, body.rememberMe ?? false);
  }

  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "session",
    entityId: user.id,
    action: "login",
    after: { ip },
  });

  const responseUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    affiliation: collaboratorPolicy?.affiliationKey ?? user.affiliation,
    collaboratorProfile: compatibilityCollaboratorProfile(collaboratorPolicy, user.collaboratorProfile),
    collaboratorPolicy,
    capabilities: capabilitiesForActor(user),
    staffingType: user.staffingType,
    forcePasswordChange: user.forcePasswordChange,
  };

  if (companionLogin) {
    if (user.role !== "ADMIN" && user.role !== "STAFF") {
      throw new HttpError(403, "The companion is available to staff accounts only.");
    }
    // Enrollment is an explicit user action that already woke Neon. Build the
    // external projection before responding so the companion never needs a
    // database-backed bootstrap request.
    const enrollmentEpoch = await getCompanionUserEpoch(user.id);
    const projection = await refreshCompanionProjection({ notify: false });
    const currentAuthority = await db.user.findUnique({
      where: { id: user.id },
      select: {
        passwordHash: true,
        role: true,
        active: true,
        forcePasswordChange: true,
      },
    });
    if (
      !currentAuthority ||
      currentAuthority.passwordHash !== user.passwordHash ||
      currentAuthority.role !== user.role ||
      currentAuthority.active !== user.active ||
      currentAuthority.forcePasswordChange !== user.forcePasswordChange
    ) {
      throw new HttpError(409, "Account access changed during companion enrollment. Sign in again.");
    }
    const companionToken = await issueCompanionSession(user, enrollmentEpoch);
    return ok({
      user: responseUser,
      companionToken,
      companionProjection: projectionForRole(projection, user.role),
    });
  }

  return ok({ user: responseUser });
});
