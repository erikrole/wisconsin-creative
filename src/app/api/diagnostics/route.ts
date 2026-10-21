import { withAuth } from "@/lib/api";
import { HttpError, ok } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { diagnosticUploadSchema } from "@/lib/schemas/error-reports";
import { storeMetricKitPayload } from "@/lib/services/app-diagnostics";

const MAX_BODY_BYTES = 2_000_000;

/**
 * POST /api/diagnostics — an Apple app uploads one MetricKit diagnostic
 * payload (crashes, hangs, resource exceptions), with what it remembers of its
 * last few runs. Reports are grouped into issues and tied to the signed-in
 * person so a crash can be followed up.
 */
export const POST = withAuth(async (req, { user }) => {
  const limit = await checkRateLimit(`diagnostics:${user.id}`, { max: 30, windowMs: 24 * 60 * 60_000 });
  if (!limit.allowed) throw new HttpError(429, "Too many diagnostic uploads");
  const length = Number(req.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) throw new HttpError(413, "Diagnostic payload too large");

  const body = diagnosticUploadSchema.parse(await req.json());
  if (body.platform === "kiosk") throw new HttpError(400, "Kiosks upload to /api/kiosk/diagnostics");
  const stored = await storeMetricKitPayload(body.payload, body.platform, { id: user.id, role: user.role }, body.sessions);
  return ok({ data: { stored } });
});
