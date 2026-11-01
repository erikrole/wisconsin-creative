import { z } from "zod";
import { db } from "@/lib/db";
import { withKiosk } from "@/lib/api";
import { ok } from "@/lib/http";
import { requireKioskActor } from "@/lib/services/kiosk-actor";
import { loadTripChecklist, setTripCheck } from "@/lib/services/shared-case-checklist";

const patchSchema = z.object({
  actorId: z.string().min(1).max(64),
  itemId: z.string().min(1).max(64),
  checked: z.boolean(),
});

/**
 * The shared case checklist at kiosk pickup and return. Anyone identified at
 * the kiosk may tick items, like returning a shared case; each tick records who.
 */
export const GET = withKiosk<{ bookingId: string }>(async (_req, { params }) => {
  return ok({ data: await loadTripChecklist(params.bookingId) });
});

export const PATCH = withKiosk<{ bookingId: string }>(async (req, { params }) => {
  const body = patchSchema.parse(await req.json());
  const actor = await requireKioskActor(db, body.actorId);
  return ok({ data: await setTripCheck(params.bookingId, body, actor) });
});
