import { z } from "zod";
import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  getImageSearchProviderName,
  isImageSearchConfigured,
  normalizeImageSearchQuery,
  searchProductImages,
} from "@/lib/image-search";

const querySchema = z.object({
  q: z.string().trim().min(1).max(200),
});

function logImageSearchUsage(event: {
  provider: string;
  status: string;
  resultCount: number;
  latencyMs: number;
  quotaExceeded: boolean;
}) {
  console.info("image-search", event);
}

export const GET = withAuth(async (req, { user }) => {
  requirePermission(user.role, "asset", "edit");

  const { searchParams } = new URL(req.url);
  const provider = getImageSearchProviderName();
  const configured = isImageSearchConfigured();

  if (searchParams.get("probe") === "1") {
    return ok({ data: { configured, provider } });
  }

  const parsed = querySchema.parse({
    q: searchParams.get("q") ?? "",
  });

  await enforceRateLimit(`image-search:${user.id}`, { max: 30, windowMs: 60_000 });

  const startedAt = Date.now();
  if (!configured) {
    logImageSearchUsage({
      provider: "none",
      status: "unconfigured",
      resultCount: 0,
      latencyMs: Date.now() - startedAt,
      quotaExceeded: false,
    });
    return ok({ data: { configured: false, provider: "none", quotaExceeded: false, results: [] } });
  }

  const outcome = await searchProductImages(normalizeImageSearchQuery(parsed.q));
  logImageSearchUsage({
    provider: outcome.provider,
    status: outcome.status,
    resultCount: outcome.status === "ok" ? outcome.results.length : 0,
    latencyMs: Date.now() - startedAt,
    quotaExceeded: outcome.status === "quota",
  });

  return ok({
    data: {
      configured: outcome.status !== "unconfigured",
      provider: outcome.provider,
      quotaExceeded: outcome.status === "quota",
      ...(outcome.status === "failed" ? { failed: true } : {}),
      results: outcome.status === "ok" ? outcome.results : [],
    },
  });
});
