import { z } from "zod";
import { db } from "@/lib/db";
import { withKiosk } from "@/lib/api";
import { ok } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";
import { kioskRosterUserWhere } from "@/lib/user-visibility";
import { normalizeWiscardNumber, wiscardScanWhere } from "@/lib/validation";

const identifyBody = z.object({
  scanValue: z.string().trim().min(1).max(128),
});

/**
 * Answers who owns a card number, so one kiosk session cannot be used to walk
 * the Wiscard keyspace. A person scanning cards at a counter stays far below.
 */
export const POST = withKiosk(async (req, { kiosk }) => {
  await enforceRateLimit(`kiosk:identify:${kiosk.kioskId}`, { max: 30, windowMs: 60_000 });
  const body = identifyBody.parse(await req.json());
  const wiscardNumber = normalizeWiscardNumber(body.scanValue);
  if (!wiscardNumber) {
    return ok({ success: false, error: "Scan a Wiscard to select a user" });
  }

  const user = await db.user.findFirst({
    where: { AND: [kioskRosterUserWhere(), wiscardScanWhere(wiscardNumber) ?? {}] },
    select: {
      id: true,
      name: true,
      avatarUrl: true,
      role: true,
    },
  });

  if (!user) {
    return ok({ success: false, error: "No active user found for that Wiscard" });
  }

  return ok({ success: true, data: user });
});
