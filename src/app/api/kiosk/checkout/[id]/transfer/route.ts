import { z } from "zod";
import { after } from "next/server";
import { withKiosk } from "@/lib/api";
import { db } from "@/lib/db";
import { ok } from "@/lib/http";
import { transferKioskItems } from "@/lib/services/kiosk-item-transfer";
import { kioskOperationContext, readKioskOperationReplay, rejectKioskOperation, unreadableKioskOperation } from "@/lib/services/kiosk-operation-receipts";
import { scheduleCheckoutReturnLiveActivity } from "@/lib/live-activity-workflow";
import { endCheckoutReturnLiveActivities } from "@/lib/services/live-activities";
const schema = z.object({
  actorId: z.string().min(1), requestId: z.string().max(64), expectedUpdatedAt: z.string().datetime({ offset: true }),
  targetBookingId: z.string().min(1).optional(), targetUserId: z.string().min(1).optional(),
  assetIds: z.array(z.string().min(1)).max(100), bulkUnitIds: z.array(z.string().min(1)).max(100), reason: z.string().trim().min(3).max(500),
}).refine((body) => Boolean(body.targetBookingId) !== Boolean(body.targetUserId), { message: "Choose one receiving checkout or person" });
export const POST = withKiosk<{ id: string }>(async (req, { params, kiosk }) => {
  const raw: unknown = await req.json();
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const unreadable = unreadableKioskOperation(raw);
    if (unreadable) return ok(unreadable);
    throw parsed.error;
  }
  const body = parsed.data;
  const receipt = kioskOperationContext({ requestId: body.requestId, kioskId: kiosk.kioskId, actorId: body.actorId, operation: "transfer", sourceId: params.id, payload: body });
  const replay = await readKioskOperationReplay(db, receipt);
  if (replay) return ok(replay);
  try {
    const result = await transferKioskItems({ ...body, sourceId: params.id, expectedUpdatedAt: new Date(body.expectedUpdatedAt), kioskId: kiosk.kioskId, receipt });
    after(async () => { await Promise.allSettled([scheduleCheckoutReturnLiveActivity({ bookingId: result.targetBookingId, endsAt: result.endsAt }), ...(result.sourceClosed ? [endCheckoutReturnLiveActivities(params.id)] : [])]); });
    return ok(result);
  } catch (error) {
    const replay = await readKioskOperationReplay(db, receipt) ?? await rejectKioskOperation(db, receipt, error);
    if (replay) return ok(replay);
    throw error;
  }
});
