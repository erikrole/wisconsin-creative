import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { createAuditEntry } from "@/lib/audit";
import { csvField } from "@/lib/csv";
import { HttpError } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/rbac";
import { GEAR_PICK_CYCLE_ID } from "@/lib/gear-picks/catalog";
import {
  buildGearPicksCsvRows,
  GEAR_PICKS_CSV_HEADER,
  getGearPicksAdmin,
} from "@/lib/services/gear-picks";

const EXPORT_LIMIT = { max: 10, windowMs: 60_000 };

/** One CSV row per picked line, ready to paste into the equipment order sheet. */
export const GET = withAuth(async (_req, { user }) => {
  requirePermission(user.role, "gear_picks", "manage");
  const { allowed } = await checkRateLimit(`gear-picks:export:${user.id}`, EXPORT_LIMIT);
  if (!allowed) throw new HttpError(429, "Too many requests. Please wait a moment.");

  const overview = await getGearPicksAdmin();
  const rows = buildGearPicksCsvRows(overview.participants);

  const header = GEAR_PICKS_CSV_HEADER.map((label) => csvField(label)).join(",");
  const body = [
    header,
    ...rows.map((row) =>
      [
        csvField(row.group),
        csvField(row.person),
        csvField(row.itemNumber),
        csvField(row.item),
        csvField(row.color),
        csvField(row.size),
        csvField(row.quantity),
        csvField(row.unitPrice),
        csvField(row.lineTotal),
        csvField(row.submittedAt),
      ].join(","),
    ),
  ].join("\n");

  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "gear_pick_cycle",
    entityId: GEAR_PICK_CYCLE_ID,
    action: "export",
    after: { rowCount: rows.length, participantCount: overview.participants.length },
  });

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ua-gear-picks-${GEAR_PICK_CYCLE_ID}.csv"`,
    },
  });
});
