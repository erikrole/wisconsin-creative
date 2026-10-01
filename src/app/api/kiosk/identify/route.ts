import { z } from "zod";
import { db } from "@/lib/db";
import { withKiosk } from "@/lib/api";
import { ok } from "@/lib/http";
import { kioskRosterUserWhere } from "@/lib/user-visibility";
import { normalizeWiscardNumber, wiscardScanWhere } from "@/lib/validation";

const identifyBody = z.object({
  scanValue: z.string().trim().min(1).max(128),
});

export const POST = withKiosk(async (req) => {
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
