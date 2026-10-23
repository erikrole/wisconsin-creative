import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { authDiscoverySchema } from "@/lib/validation";
import { withHandler } from "@/lib/api";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { inviteTokenMatches } from "@/lib/services/invite-token";

// Discovery is intentionally a small UX hint, not an authorization check. The
// registration route still re-checks the allowlist and claims it atomically.
// Keep both buckets bounded because a shared campus network can contain many
// legitimate users while an attacker should not be able to sweep the roster.
const DISCOVERY_EMAIL_LIMIT = { max: 20, windowMs: 15 * 60 * 1000 };
const DISCOVERY_IP_LIMIT = { max: 120, windowMs: 15 * 60 * 1000 };

export const POST = withHandler(async (req) => {
  const ip = getClientIp(req);
  const body = authDiscoverySchema.parse(await req.json());
  const email = body.email.toLowerCase();

  const [ipCheck, emailCheck] = await Promise.all([
    checkRateLimit(`auth-discovery:ip:${ip}`, DISCOVERY_IP_LIMIT),
    checkRateLimit(`auth-discovery:email:${email}`, DISCOVERY_EMAIL_LIMIT),
  ]);
  if (!ipCheck.allowed || !emailCheck.allowed) {
    throw new HttpError(429, "Too many sign-in attempts. Please try again later.");
  }

  const [allowedEmail, user] = await Promise.all([
    db.allowedEmail.findUnique({
      where: { email },
      select: {
        claimedAt: true,
        role: true,
        inviteTokenHash: true,
        inviteTokenIssuedAt: true,
        collaboratorPolicy: { select: { status: true } },
      },
    }),
    db.user.findUnique({
      where: { email },
      select: { id: true },
    }),
  ]);

  const pendingInvite = Boolean(
    allowedEmail
      && !allowedEmail.claimedAt
      && !user
      && (allowedEmail.role !== "COLLABORATOR" || allowedEmail.collaboratorPolicy?.status === "ACTIVE"),
  );

  // Deliberately return no role, name, or profile seed data. The only public
  // distinction is the requested onboarding affordance for an unclaimed
  // allowlist row; all other addresses continue through password sign-in.
  // For a pending invite, `inviteLink` says whether this visit arrived through
  // the emailed link: "required" sends the page to the resend affordance
  // instead of a sign-up form that the register route would refuse.
  if (!pendingInvite) return ok({ flow: "password" as const });
  const inviteLink = allowedEmail && (await inviteTokenMatches(allowedEmail, body.invite)) ? "valid" : "required";
  return ok({ flow: "onboarding" as const, inviteLink });
});
