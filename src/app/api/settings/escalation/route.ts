import { z } from "zod";
import { withAuth } from "@/lib/api";
import { createAuditEntry } from "@/lib/audit";
import { HttpError, ok } from "@/lib/http";
import { db } from "@/lib/db";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { visibleActiveUserWhere } from "@/lib/user-visibility";
import {
  normalizeCheckoutEscalationConfig,
  overdueResponderConfigKey,
} from "@/lib/checkout-escalation-policy";
import { unique } from "@/lib/utils";

const patchEscalationSchema = z.union([
  z.object({
    maxRequesterNotificationsPerDueDate: z.number().int().min(1).max(20).optional(),
    maxOperationalNotificationsPerDueDate: z.number().int().min(1).max(100).optional(),
  }).refine(
    (d) => d.maxRequesterNotificationsPerDueDate !== undefined
      || d.maxOperationalNotificationsPerDueDate !== undefined,
    { message: "Provide at least one notification cap" },
  ),
  z.object({
    locationId: z.string().trim().min(1).max(128),
    responderUserIds: z.array(z.string().trim().min(1).max(128)).max(10),
  }),
  z.object({
    ruleId: z.string().trim().min(1).max(128),
    enabled: z.boolean().optional(),
    notifyAdmins: z.boolean().optional(),
    notifyRequester: z.boolean().optional(),
  }).refine(
    (d) => d.enabled !== undefined || d.notifyAdmins !== undefined || d.notifyRequester !== undefined,
    { message: "Provide at least one field to update" }
  ),
]);

/**
 * GET /api/settings/escalation
 * Returns escalation rules and system config. Admin only.
 */
export const GET = withAuth(async (_req, { user }) => {
  if (user.role !== "ADMIN") throw new HttpError(403, "Admin only");

  const [rules, config, locations, responderCandidates, responderConfigs] = await Promise.all([
    db.escalationRule.findMany({ orderBy: { sortOrder: "asc" } }),
    db.systemConfig.findUnique({ where: { key: "escalation" } }),
    db.location.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.user.findMany({
      where: visibleActiveUserWhere({ role: { in: ["ADMIN", "STAFF"] } }),
      select: { id: true, name: true, email: true, role: true, locationId: true },
      orderBy: [{ role: "asc" }, { name: "asc" }],
    }),
    db.systemConfig.findMany({
      where: { key: { startsWith: "overdue_responders:" } },
      select: { key: true, value: true },
    }),
  ]);

  const escalationConfig = normalizeCheckoutEscalationConfig(config?.value);
  const respondersByLocation = new Map(responderConfigs.map((row) => {
    const value = row.value && typeof row.value === "object" ? row.value as { userIds?: unknown } : {};
    const userIds = Array.isArray(value.userIds)
      ? value.userIds.filter((id): id is string => typeof id === "string")
      : [];
    return [row.key.slice("overdue_responders:".length), userIds];
  }));

  return ok({
    data: {
      rules,
      config: escalationConfig,
      locations: locations.map((location) => ({
        ...location,
        responderUserIds: respondersByLocation.get(location.id) ?? [],
      })),
      responderCandidates,
    },
  });
});

/**
 * PATCH /api/settings/escalation
 * Update a single escalation rule or the system config.
 * Updates one rule, the two fatigue caps, or one location's responder list.
 */
export const PATCH = withAuth(async (req, { user }) => {
  if (user.role !== "ADMIN") throw new HttpError(403, "Admin only");
  await enforceRateLimit(`escalation:write:${user.id}`, SETTINGS_MUTATION_LIMIT);

  const body = patchEscalationSchema.parse(await req.json());

  // Update system config
  if ("maxRequesterNotificationsPerDueDate" in body || "maxOperationalNotificationsPerDueDate" in body) {
    const existing = await db.systemConfig.findUnique({ where: { key: "escalation" } });
    const before = existing?.value as Record<string, unknown> | null;
    const current = normalizeCheckoutEscalationConfig(before);
    const next = {
      maxRequesterNotificationsPerDueDate: body.maxRequesterNotificationsPerDueDate
        ?? current.maxRequesterNotificationsPerDueDate,
      maxOperationalNotificationsPerDueDate: body.maxOperationalNotificationsPerDueDate
        ?? current.maxOperationalNotificationsPerDueDate,
    };
    await db.systemConfig.upsert({
      where: { key: "escalation" },
      update: { value: next },
      create: { key: "escalation", value: next },
    });
    await createAuditEntry({
      actorId: user.id,
      actorRole: user.role,
      entityType: "system_config",
      entityId: "escalation",
      action: "escalation_config_updated",
      before: before ?? { existed: false },
      after: next,
    });
    return ok({ config: next });
  }

  if ("locationId" in body) {
    const responderUserIds = unique(body.responderUserIds);
    const [location, eligibleCount, existing] = await Promise.all([
      db.location.findFirst({ where: { id: body.locationId, active: true }, select: { id: true, name: true } }),
      db.user.count({
        where: visibleActiveUserWhere({
          id: { in: responderUserIds },
          role: { in: ["ADMIN", "STAFF"] },
        }),
      }),
      db.systemConfig.findUnique({ where: { key: overdueResponderConfigKey(body.locationId) } }),
    ]);
    if (!location) throw new HttpError(404, "Active location not found");
    if (eligibleCount !== responderUserIds.length) {
      throw new HttpError(400, "Every overdue responder must be an active visible staff or admin user");
    }
    const before = existing?.value && typeof existing.value === "object" && !Array.isArray(existing.value)
      ? existing.value as Record<string, unknown>
      : { userIds: [] };
    const value = { userIds: responderUserIds };
    await db.systemConfig.upsert({
      where: { key: overdueResponderConfigKey(body.locationId) },
      update: { value },
      create: { key: overdueResponderConfigKey(body.locationId), value },
    });
    await createAuditEntry({
      actorId: user.id,
      actorRole: user.role,
      entityType: "system_config",
      entityId: overdueResponderConfigKey(body.locationId),
      action: "overdue_responders_updated",
      before,
      after: { locationId: location.id, locationName: location.name, ...value },
    });
    return ok({ locationId: body.locationId, responderUserIds });
  }

  // Update a rule
  if ("ruleId" in body) {
    const data: Record<string, boolean> = {};
    if (body.enabled !== undefined) data.enabled = body.enabled;
    if (body.notifyAdmins !== undefined) data.notifyAdmins = body.notifyAdmins;
    if (body.notifyRequester !== undefined) data.notifyRequester = body.notifyRequester;

    const beforeRule = await db.escalationRule.findUnique({ where: { id: body.ruleId } });
    if (!beforeRule) throw new HttpError(404, "Escalation rule not found");
    const rule = await db.escalationRule.update({
      where: { id: body.ruleId },
      data,
    });
    await createAuditEntry({
      actorId: user.id,
      actorRole: user.role,
      entityType: "escalation_rule",
      entityId: body.ruleId,
      action: "escalation_rule_updated",
      before: beforeRule ? { enabled: beforeRule.enabled, notifyAdmins: beforeRule.notifyAdmins, notifyRequester: beforeRule.notifyRequester } : undefined,
      after: data,
    });
    return ok(rule);
  }

  throw new HttpError(400, "Provide a rule, notification cap, or responder assignment");
});
