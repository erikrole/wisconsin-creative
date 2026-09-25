import { z } from "zod";
import { withKiosk } from "@/lib/api";
import { HttpError, ok } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";
import { sendKioskNudge } from "@/lib/services/kiosk-nudge";

// Home has no one identified, so the actor is optional (Erik, 2026-09-25).
const schema = z.object({ actorId: z.string().min(1).optional() });

/**
 * Nudge the holder of an overdue personal checkout from the kiosk. Anyone at
 * the kiosk may send it; each booking is nudged at most once per local day and
 * a repeat answers `{ success: true, alreadyNudged: true }`.
 */
export const POST = withKiosk<{ id: string }>(async (req, { kiosk, params }) => {
  await enforceRateLimit(`kiosk:nudge:${kiosk.kioskId}`, { max: 20, windowMs: 60_000 });
  const raw = await req.text();
  let json: unknown = {};
  if (raw.trim()) {
    try {
      json = JSON.parse(raw);
    } catch {
      throw new HttpError(400, "Invalid request body");
    }
  }
  const body = schema.parse(json);
  return ok(await sendKioskNudge({ bookingId: params.id, actorId: body.actorId, kioskId: kiosk.kioskId }));
});
