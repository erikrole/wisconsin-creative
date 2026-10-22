import { withKiosk } from "@/lib/api";
import { HttpError, ok } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { readBoundedJson } from "@/lib/error-reporting/request-body";
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

  const body = diagnosticUploadSchema.parse(await readBoundedJson(req, MAX_BODY_BYTES, "Diagnostic payload"));
  const stored = await storeMetricKitPayload(body.payload, "kiosk", null, body.sessions, {
    kiosk: kiosk.name,
    location: kiosk.locationName,
  });
  return ok({ data: { stored } });
});
