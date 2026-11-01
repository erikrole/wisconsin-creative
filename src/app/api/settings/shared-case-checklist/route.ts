import { randomUUID } from "node:crypto";
import { z } from "zod";
import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { ok } from "@/lib/http";
import { requireRole } from "@/lib/rbac";
import { createAuditEntry } from "@/lib/audit";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { loadChecklistItems } from "@/lib/services/shared-case-checklist";
import {
  CHECKLIST_ITEMS_MAX,
  CHECKLIST_LABEL_MAX,
  CHECKLIST_SECTION_MAX,
  SHARED_CASE_CHECKLIST_KEY,
} from "@/lib/shared-case-checklist";

const putSchema = z.object({
  items: z.array(z.object({
    // Kept items keep their id so ticks on an open trip survive the edit.
    id: z.string().min(1).max(64).optional(),
    label: z.string().trim().min(1).max(CHECKLIST_LABEL_MAX),
    section: z.string().trim().max(CHECKLIST_SECTION_MAX).nullable().optional(),
  })).max(CHECKLIST_ITEMS_MAX),
});

/** GET/PUT /api/settings/shared-case-checklist — the list ticked on every shared case trip. Staff read, admins edit. */
export const GET = withAuth(async (_req, { user }) => {
  requireRole(user.role, ["ADMIN", "STAFF"]);
  return ok({ data: { items: await loadChecklistItems() } });
});

export const PUT = withAuth(async (req, { user }) => {
  requireRole(user.role, ["ADMIN"]);
  await enforceRateLimit(`shared-case-checklist:write:${user.id}`, SETTINGS_MUTATION_LIMIT);
  const body = putSchema.parse(await req.json());
  const before = await loadChecklistItems();
  const known = new Set(before.map((item) => item.id));
  const items = body.items.map((item) => ({
    id: item.id && known.has(item.id) ? item.id : randomUUID(),
    label: item.label,
    section: item.section || null,
  }));

  await db.systemConfig.upsert({
    where: { key: SHARED_CASE_CHECKLIST_KEY },
    update: { value: { items } },
    create: { key: SHARED_CASE_CHECKLIST_KEY, value: { items } },
  });
  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "system_config",
    entityId: SHARED_CASE_CHECKLIST_KEY,
    action: "shared_case_checklist_updated",
    before: { items: before.map((item) => item.label) },
    after: { items: items.map((item) => item.label) },
  });
  return ok({ data: { items } });
});
