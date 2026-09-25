import { withKiosk } from "@/lib/api";
import { db } from "@/lib/db";
import { ok } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";
import { kioskExtendWindow } from "@/lib/services/kiosk-extend-window";

/**
 * GET /api/kiosk/checkout/[id]/extend-window — how late this checkout can be
 * extended ("Can go until 10:00 PM", frame H1). Read-only; the PATCH still
 * validates the chosen time. `maxEndsAt` at or before `currentEndsAt` means it
 * cannot be extended; `null` means nothing claims the gear within a year.
 */
export const GET = withKiosk<{ id: string }>(async (_req, { kiosk, params }) => {
  await enforceRateLimit(`kiosk:extend-window:${kiosk.kioskId}`, { max: 60, windowMs: 60_000 });
  return ok(await kioskExtendWindow(db, params.id));
});
