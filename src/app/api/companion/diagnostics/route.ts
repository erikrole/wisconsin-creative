import { withHandler } from "@/lib/api";
import { requireCompanion } from "@/lib/companion-store";
import { HttpError, ok } from "@/lib/http";
import { checkRateLimit, enforceRateLimit, getClientIp } from "@/lib/rate-limit";
import { readBoundedJson } from "@/lib/error-reporting/request-body";
import { diagnosticUploadSchema } from "@/lib/schemas/error-reports";
import { storeMetricKitPayload } from "@/lib/services/app-diagnostics";

const MAX_BODY_BYTES = 2_000_000;

/**
 * POST /api/companion/diagnostics — the Mac menu bar app uploads one MetricKit
 * diagnostic payload with its companion credential. Unlike the companion's
 * own routes this one writes to the database, but MetricKit delivers at most
 * once a day and only after something went wrong.
 */
export const POST = withHandler(async (req) => {
  await enforceRateLimit(`companion:diagnostics:ip:${getClientIp(req)}`, { max: 30, windowMs: 60 * 60_000 });
  const companion = await requireCompanion(req);
  const limit = await checkRateLimit(`diagnostics:${companion.userId}`, { max: 30, windowMs: 24 * 60 * 60_000 });
  if (!limit.allowed) throw new HttpError(429, "Too many diagnostic uploads");

  const body = diagnosticUploadSchema.parse(await readBoundedJson(req, MAX_BODY_BYTES, "Diagnostic payload"));
  if (body.platform !== "macos") throw new HttpError(400, "Only the Mac app uploads here");
  const stored = await storeMetricKitPayload(body.payload, "macos", { id: companion.userId, role: companion.role }, body.sessions);
  return ok({ data: { stored } });
});
