import { Role } from "@prisma/client";
import { z } from "zod";
import { withAuth } from "@/lib/api";
import { createAuditEntry } from "@/lib/audit";
import { badgesEnabled } from "@/lib/badges";
import {
  awardBadgeManually,
  ensureManualBadgeDefinition,
  type CustomBadgeDefinitionInput,
} from "@/lib/badges/queries";
import { customBadgeIconOptions } from "@/lib/badges/display";
import { captureBadgeError } from "@/lib/observability";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { requireRole } from "@/lib/rbac";
import { canViewHiddenUsers } from "@/lib/user-visibility";
import { buildUserDirectoryQuery, type UserDirectoryFilters } from "@/lib/user-directory-query";
import { MAX_BULK_BADGE_TARGETS } from "@/lib/request-limits";
import { optionalSportCodeSchema } from "@/lib/validation";

const customBadgeDefinitionSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().min(2).max(180),
  icon: z.enum(customBadgeIconOptions).optional(),
});

const bulkFiltersSchema = z.object({
  q: z.string().trim().max(200).optional(),
  role: z.enum(["ADMIN", "STAFF", "STUDENT", "COLLABORATOR"]).optional(),
  locationId: z.string().trim().min(1).max(100).optional(),
  year: z.enum(["FRESHMAN", "SOPHOMORE", "JUNIOR", "SENIOR", "GRAD"]).optional(),
  sport: optionalSportCodeSchema,
  area: z.enum(["VIDEO", "PHOTO", "GRAPHICS", "SOCIAL", "COMMS", "LIVE_PRODUCTION"]).optional(),
  includeHidden: z.boolean().optional().default(false),
});

const bulkAwardSchema = z.object({
  filters: bulkFiltersSchema.optional().default({}),
  userIds: z.array(z.string().trim().min(1).max(100)).min(1).max(MAX_BULK_BADGE_TARGETS).optional(),
  definitionId: z.string().cuid().optional(),
  customDefinition: customBadgeDefinitionSchema.optional(),
  note: z.string().trim().max(500).optional(),
}).superRefine((value, ctx) => {
  const hasDefinition = Boolean(value.definitionId);
  const hasCustomDefinition = Boolean(value.customDefinition);
  if (hasDefinition === hasCustomDefinition) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["definitionId"],
      message: "Choose an existing badge or define one custom badge",
    });
  }
});

const BULK_AWARD_CONCURRENCY = 8;

type BulkAwardResult = {
  userId: string;
  name: string;
  status: "awarded" | "skipped" | "failed";
  reason?: string;
};

function resultForError(target: { id: string; name: string }, error: unknown): BulkAwardResult {
  if (error instanceof HttpError && error.status === 409) {
    return { userId: target.id, name: target.name, status: "skipped", reason: "Already has this badge" };
  }

  captureBadgeError(error, { operation: "bulkBadgeAward", userId: target.id });
  return { userId: target.id, name: target.name, status: "failed", reason: "Could not award this badge" };
}

export const POST = withAuth(async (req, { user }) => {
  requireRole(user.role, [Role.ADMIN]);
  if (!badgesEnabled()) {
    throw new HttpError(409, "Badges are disabled");
  }

  const body = bulkAwardSchema.parse(await req.json());
  const explicitUserIds = body.userIds ? Array.from(new Set(body.userIds)) : null;
  const selectionFilters: UserDirectoryFilters = explicitUserIds ? {} : body.filters;
  const includeHidden = selectionFilters.includeHidden && canViewHiddenUsers(user);
  const { where } = buildUserDirectoryQuery(user, {
    q: selectionFilters.q,
    role: selectionFilters.role,
    locationId: selectionFilters.locationId,
    year: selectionFilters.year,
    sport: selectionFilters.sport,
    area: selectionFilters.area,
    includeHidden,
    active: "active",
  });
  const targetWhere = explicitUserIds
    ? { AND: [where, { id: { in: explicitUserIds } }] }
    : where;

  const targets = await db.user.findMany({
    where: targetWhere,
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: MAX_BULK_BADGE_TARGETS + 1,
    select: { id: true, name: true },
  });

  if (targets.length > MAX_BULK_BADGE_TARGETS) {
    throw new HttpError(
      422,
      explicitUserIds
        ? `Select no more than ${MAX_BULK_BADGE_TARGETS} users before awarding a badge.`
        : `This group has more than ${MAX_BULK_BADGE_TARGETS} active users. Add a filter before awarding a badge.`,
    );
  }

  if (targets.length === 0) {
    return ok({
      data: {
        definitionId: body.definitionId ?? null,
        requested: 0,
        awarded: 0,
        skipped: 0,
        failed: 0,
        results: [],
      },
    });
  }

  let definitionId = body.definitionId;
  if (!definitionId && body.customDefinition) {
    const definition = await ensureManualBadgeDefinition(body.customDefinition as CustomBadgeDefinitionInput);
    definitionId = definition.id;
  }

  const results: BulkAwardResult[] = [];
  for (let index = 0; index < targets.length; index += BULK_AWARD_CONCURRENCY) {
    const batch = targets.slice(index, index + BULK_AWARD_CONCURRENCY);
    const batchResults = await Promise.all(batch.map(async (target): Promise<BulkAwardResult> => {
      try {
        const award = await awardBadgeManually({
          userId: target.id,
          definitionId,
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
            userId: target.id,
            definitionId: award.definition.id,
            badgeKey: award.definition.key,
            customDefinition: body.customDefinition ?? null,
            note: body.note ?? null,
            bulk: true,
            targetCount: targets.length,
          },
        });

        return { userId: target.id, name: target.name, status: "awarded" };
      } catch (error) {
        return resultForError(target, error);
      }
    }));
    results.push(...batchResults);
  }

  return ok({
    data: {
      definitionId,
      requested: targets.length,
      awarded: results.filter((result) => result.status === "awarded").length,
      skipped: results.filter((result) => result.status === "skipped").length,
      failed: results.filter((result) => result.status === "failed").length,
      results,
    },
  });
});
