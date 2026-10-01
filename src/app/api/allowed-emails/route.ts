import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { ok, parsePagination } from "@/lib/http";
import { excludeHiringInvites } from "@/lib/hiring/invite-scope";
import { requirePermission } from "@/lib/rbac";
import { createAllowedEmailSchema, createAllowedEmailBulkSchema } from "@/lib/validation";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { shouldIncludeHiddenUsers } from "@/lib/user-visibility";
import {
  createAllowedEmailInvite,
  createAllowedEmailInvitesBulk,
} from "@/lib/services/onboarding-lifecycle";

/** List allowed emails (paginated, filterable) */
export const GET = withAuth(async (req, { user }) => {
  requirePermission(user.role, "allowed_email", "view");

  const url = new URL(req.url);
  const { limit, offset } = parsePagination(url.searchParams);
  const q = url.searchParams.get("q")?.trim() || "";
  const status = url.searchParams.get("status"); // "claimed" | "unclaimed" | null
  const includeHidden = shouldIncludeHiddenUsers(url.searchParams, user);

  const conditions: Prisma.AllowedEmailWhereInput[] = [];
  if (!includeHidden) {
    conditions.push({
      OR: [
        { claimedById: null },
        { claimedBy: { is: { hiddenFromRoster: false } } },
      ],
    });
  }
  if (q) {
    conditions.push({ email: { contains: q, mode: "insensitive" } });
  }
  if (status === "claimed") {
    conditions.push({ claimedAt: { not: null } });
  } else if (status === "unclaimed") {
    conditions.push({ claimedAt: null });
  }
  const hidden = excludeHiringInvites(user.role);
  if (hidden) conditions.push(hidden);
  const where: Prisma.AllowedEmailWhereInput = conditions.length > 0 ? { AND: conditions } : {};

  const [data, total] = await Promise.all([
    db.allowedEmail.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: offset,
      take: limit,
      include: {
        createdBy: { select: { id: true, name: true } },
        claimedBy: { select: { id: true, name: true } },
        collaboratorPolicy: {
          select: {
            id: true,
            status: true,
            version: true,
            affiliation: { select: { key: true, displayName: true, badgeLabel: true } },
            grants: { select: { capabilityKey: true } },
          },
        },
      },
    }),
    db.allowedEmail.count({ where }),
  ]);

  return ok({ data, total, limit, offset });
});

/** Add a single allowed email or bulk add */
export const POST = withAuth(async (req, { user }) => {
  requirePermission(user.role, "allowed_email", "create");
  await enforceRateLimit(`allowed-emails:write:${user.id}`, SETTINGS_MUTATION_LIMIT);

  const body = await req.json();

  // Bulk add
  if (Array.isArray(body.emails)) {
    const { emails } = createAllowedEmailBulkSchema.parse(body);

    const result = await createAllowedEmailInvitesBulk({ actor: user, emails });

    return ok(
      result,
      201
    );
  }

  // Single add
  const invite = createAllowedEmailSchema.parse(body);
  const { email: rawEmail } = invite;
  const email = rawEmail.toLowerCase();

  const result = await createAllowedEmailInvite({ actor: user, ...invite, email });
  if (result.skipped) return ok(result, 201);

  return ok(result.entry, 201);
});
