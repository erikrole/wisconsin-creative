import { z } from "zod";
import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/rbac";
import { MAX_BULK_ASSIGNMENT_SPORTS } from "@/lib/bulk-schedule-assignment-types";
import { getSportRosterPreview } from "@/lib/services/sport-roster-preview";

const codesSchema = z.array(z.string().trim().min(1).max(40)).max(MAX_BULK_ASSIGNMENT_SPORTS);

export const GET = withAuth(async (req, { user }) => {
  requirePermission(user.role, "student_sport", "view");
  await enforceRateLimit(`schedule:sport-roster:${user.id}`, { max: 60, windowMs: 60_000 });
  const raw = new URL(req.url).searchParams.get("codes") ?? "";
  const codes = codesSchema.parse(raw.split(",").map((code) => code.trim()).filter(Boolean));
  return ok({ data: await getSportRosterPreview(codes) });
});
