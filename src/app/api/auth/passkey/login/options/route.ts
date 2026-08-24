import { withHandler } from "@/lib/api";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { HttpError, ok } from "@/lib/http";
import { passkeyLoginOptionsSchema } from "@/lib/validation";
import { createPasskeyAuthenticationOptions } from "@/lib/passkey";

/** POST /api/auth/passkey/login/options — begin a discoverable passkey sign-in. */
export const POST = withHandler(async (req) => {
  const ip = getClientIp(req);
  // Conditional UI starts a ceremony whenever a sign-in page is opened, and a
  // shared campus IP can carry many people. Keep the assertion budget itself at
  // 30 (see the verify route) but let option requests breathe.
  const { allowed } = await checkRateLimit(`passkey:login:options:${ip}`, { max: 120, windowMs: 15 * 60_000 });
  if (!allowed) throw new HttpError(429, "Too many passkey sign-in attempts. Please try again later.");

  const body = passkeyLoginOptionsSchema.parse(await req.json());
  const options = await createPasskeyAuthenticationOptions(body.rememberMe ?? false);
  return ok({ options });
});
