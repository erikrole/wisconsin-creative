import { z } from "zod";
import { withAuth } from "@/lib/api";
import { HttpError, ok } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { parseDiagnosticPayload, storeDiagnostics } from "@/lib/services/app-diagnostics";

const MAX_BODY_BYTES = 2_000_000;

const bodySchema = z.object({
  platform: z.enum(["ios"]),
  payload: z.record(z.string(), z.unknown()),
}).strict();

/**
 * POST /api/diagnostics — an iOS install uploads one MetricKit diagnostic
 * payload (crashes, hangs, resource exceptions). Nothing identifies the user;
 * authentication only keeps the endpoint closed to the public.
 */
export const POST = withAuth(async (req, { user }) => {
  const limit = await checkRateLimit(`diagnostics:${user.id}`, { max: 30, windowMs: 24 * 60 * 60_000 });
  if (!limit.allowed) throw new HttpError(429, "Too many diagnostic uploads");
  const length = Number(req.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) throw new HttpError(413, "Diagnostic payload too large");

  const body = bodySchema.parse(await req.json());
  const stored = await storeDiagnostics(parseDiagnosticPayload(body.payload, body.platform));
  return ok({ data: { stored } });
});
