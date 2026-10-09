import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";
import { authorizeRadioClip } from "@/lib/services/radio-clip-auth";
export const POST = withAuth(async (req, { user }) => {
  await enforceRateLimit(`radio-clip:authorize:${user.id}`, { max: 10, windowMs: 60_000 });
  return ok(await authorizeRadioClip(user, await req.json()));
});
