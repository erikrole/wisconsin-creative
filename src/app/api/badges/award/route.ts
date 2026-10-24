import { z } from "zod";
import { withAuth } from "@/lib/api";
import { createAuditEntry } from "@/lib/audit";
import { badgesEnabled } from "@/lib/badges";
import { customBadgeIconOptions } from "@/lib/badges/display";
import { awardBadgeManually } from "@/lib/badges/queries";
import { HttpError, ok } from "@/lib/http";
import { requireRole } from "@/lib/rbac";

const customBadgeDefinitionSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().min(2).max(180),
  icon: z.enum(customBadgeIconOptions).optional(),
});

const manualAwardSchema = z.object({
  userId: z.string().cuid(),
  definitionId: z.string().cuid().optional(),
  customDefinition: customBadgeDefinitionSchema.optional(),
  note: z.string().trim().max(500).optional(),
}).superRefine((value, ctx) => {
  const hasDefinition = Boolean(value.definitionId);
  const hasCustomDefinition = Boolean(value.customDefinition);
  if (hasDefinition === hasCustomDefinition) {
    ctx.addIssue({
      code: "custom",
      path: ["definitionId"],
      message: "Choose an existing badge or define one custom badge",
    });
  }
});

export const POST = withAuth(async (req, { user }) => {
  requireRole(user.role, ["ADMIN"]);
  if (!badgesEnabled()) {
    throw new HttpError(409, "Badges are disabled");
  }

  const body = manualAwardSchema.parse(await req.json());
  const award = await awardBadgeManually({
    userId: body.userId,
    definitionId: body.definitionId,
    customDefinition: body.customDefinition,
    awardedById: user.id,
    note: body.note,
  });

  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "badge_award",
    entityId: award.id,
    action: "badge_awarded_manually",
    after: {
      userId: body.userId,
      definitionId: award.definition.id,
      badgeKey: award.definition.key,
      customDefinition: body.customDefinition ?? null,
      note: body.note ?? null,
    },
  });

  return ok({
    data: {
      id: award.id,
      userId: award.userId,
      definitionId: award.definitionId,
      awardedAt: award.awardedAt.toISOString(),
      source: award.source,
      note: award.note,
      definition: award.definition,
    },
  }, 201);
});
