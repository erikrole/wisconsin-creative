import { withKiosk } from "@/lib/api";
import { HttpError, ok } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { diagnosticUploadSchema } from "@/lib/schemas/error-reports";
import { storeMetricKitPayload } from "@/lib/services/app-diagnostics";

const MAX_BODY_BYTES = 2_000_000;

/**
 * POST /api/kiosk/diagnostics — a kiosk iPad uploads one MetricKit diagnostic
 * payload. A kiosk has no signed-in person, so reports carry the kiosk and
 * its location instead.
 */
export const POST = withKiosk(async (req, { kiosk }) => {
  const limit = await checkRateLimit(`diagnostics:kiosk:${kiosk.kioskId}`, { max: 30, windowMs: 24 * 60 * 60_000 });
  if (!limit.allowed) throw new HttpError(429, "Too many diagnostic uploads");
  const length = Number(req.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) throw new HttpError(413, "Diagnostic payload too large");

  const body = diagnosticUploadSchema.parse(await req.json());
  const stored = await storeMetricKitPayload(body.payload, "kiosk", null, body.sessions, {
    kiosk: kiosk.name,
    location: kiosk.locationName,
  });
  return ok({ data: { stored } });
});
