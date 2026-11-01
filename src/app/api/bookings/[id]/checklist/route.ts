import { z } from "zod";
import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requireBookingAction } from "@/lib/services/booking-rules";
import { enforceRateLimit, SCHEDULE_MUTATION_LIMIT } from "@/lib/rate-limit";
import { loadTripChecklist, setTripCheck } from "@/lib/services/shared-case-checklist";

const patchSchema = z.object({ itemId: z.string().min(1).max(64), checked: z.boolean() });

/** The shared case checklist for this booking, or `data: null` when it is not a shared case. */
export const GET = withAuth<{ id: string }>(async (_req, { user, params }) => {
  await requireBookingAction(params.id, user, "view");
  return ok({ data: await loadTripChecklist(params.id) });
});

export const PATCH = withAuth<{ id: string }>(async (req, { user, params }) => {
  await requireBookingAction(params.id, user, "view");
  await enforceRateLimit(`checklist:${user.id}`, SCHEDULE_MUTATION_LIMIT);
  const body = patchSchema.parse(await req.json());
  return ok({ data: await setTripCheck(params.id, body, user) });
});
