import { NextResponse } from "next/server";
import { withAuth, withHandler } from "@/lib/api";
import { createAuditEntry } from "@/lib/audit";
import { db } from "@/lib/db";
import { ok } from "@/lib/http";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/rbac";
import {
  normalizeOtsControl,
  OTS_CONTROL_KEY,
  otsControlInputSchema,
  type OtsControl,
} from "@/lib/services/ots-control";

/**
 * GET /api/ots/control: public. The board on the Daktronics player polls this
 * every few seconds and cannot sign in. It exposes only the board's mode.
 */
export const GET = withHandler(async () => {
  const row = await db.systemConfig.findUnique({ where: { key: OTS_CONTROL_KEY } });
  const control = normalizeOtsControl(row?.value);
  return NextResponse.json(
    { data: { mode: control.mode, scenario: control.scenario, gamePk: control.gamePk, updatedAt: control.updatedAt } },
    { headers: { "Cache-Control": "no-store" } },
  );
});

/** PUT /api/ots/control: staff and admins change what the board shows. */
export const PUT = withAuth(async (req, { user }) => {
  requirePermission(user.role, "ots_board", "control");
  await enforceRateLimit(`ots-control:write:${user.id}`, SETTINGS_MUTATION_LIMIT);

  const input = otsControlInputSchema.parse(await req.json());
  const existing = await db.systemConfig.findUnique({ where: { key: OTS_CONTROL_KEY } });
  const before = normalizeOtsControl(existing?.value);
  const after: OtsControl = { ...input, updatedAt: new Date().toISOString(), updatedBy: user.name || user.email };

  await db.systemConfig.upsert({
    where: { key: OTS_CONTROL_KEY },
    update: { value: after },
    create: { key: OTS_CONTROL_KEY, value: after },
  });

  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "system_config",
    entityId: OTS_CONTROL_KEY,
    action: "ots_control_updated",
    before,
    after,
  });

  return ok({ data: after });
});

