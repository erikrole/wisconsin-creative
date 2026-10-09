import { withHandler } from "@/lib/api-handler";
import { ok } from "@/lib/http";
import { enforceRateLimit, getClientIp } from "@/lib/rate-limit";
import { exchangeRadioClip } from "@/lib/services/radio-clip-auth";
export const POST = withHandler(async req => {
  await enforceRateLimit(`radio-clip:token:${getClientIp(req)}`, { max: 20, windowMs: 60_000 });
  return ok(await exchangeRadioClip(await req.json()));
});
