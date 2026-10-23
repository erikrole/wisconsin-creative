import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { ok, parsePagination } from "@/lib/http";
import { excludeHiringInvites } from "@/lib/hiring/invite-scope";
import { requirePermission } from "@/lib/rbac";
import { createAllowedEmailSchema, createAllowedEmailBulkSchema } from "@/lib/validation";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { shouldIncludeHiddenUsers } from "@/lib/user-visibility";
import { createAuditEntry } from "@/lib/audit";
import { sendInviteEmail } from "@/lib/services/invite-email";
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

// A 50-row roster with paced invite emails takes about 30 seconds.
export const maxDuration = 60;
const BULK_INVITE_EMAIL_GAP_MS = 600;

/** Add a single allowed email or bulk add */
export const POST = withAuth(async (req, { user }) => {
  requirePermission(user.role, "allowed_email", "create");
  await enforceRateLimit(`allowed-emails:write:${user.id}`, SETTINGS_MUTATION_LIMIT);

  const body = await req.json();

  // Bulk add
  if (Array.isArray(body.emails)) {
    const { emails } = createAllowedEmailBulkSchema.parse(body);

    const { createdEntries, ...result } = await createAllowedEmailInvitesBulk({ actor: user, emails });
    if (body?.sendInvite !== true) return ok(result, 201);

    // Same opt-in as a single add, one email per new non-collaborator invite.
    // Sequential and paced to stay under the email provider's rate limit.
    const emailed = { sent: 0, failed: 0, notConfigured: 0 };
    for (const [index, entry] of createdEntries.entries()) {
      if (entry.role === "COLLABORATOR") continue;
      if (index > 0) await new Promise((resolve) => setTimeout(resolve, BULK_INVITE_EMAIL_GAP_MS));
      const emailStatus = await sendInviteEmail({ email: entry.email, name: entry.preloadedName, allowedEmailId: entry.id });
      if (emailStatus === "sent") emailed.sent += 1;
      else if (emailStatus === "failed") emailed.failed += 1;
      else emailed.notConfigured += 1;
      await createAuditEntry({
        actorId: user.id,
        actorRole: user.role,
        entityType: "allowed_email",
        entityId: entry.id,
        action: "invite_sent",
        after: { emailStatus },
      });
    }
    return ok({ ...result, emailed }, 201);
  }

  // Single add
  const invite = createAllowedEmailSchema.parse(body);
  const { email: rawEmail } = invite;
  const email = rawEmail.toLowerCase();

  const result = await createAllowedEmailInvite({ actor: user, ...invite, email });
  if (result.skipped) return ok(result, 201);

  // Opt-in per add: the invite is the one automatic email a new person gets.
  // Collaborators are onboarded by their organization, not this email.
  if (body?.sendInvite === true && invite.role !== "COLLABORATOR") {
    const emailStatus = await sendInviteEmail({ email, name: "preloadedName" in invite ? invite.preloadedName : null, allowedEmailId: result.entry.id });
    await createAuditEntry({
      actorId: user.id,
      actorRole: user.role,
      entityType: "allowed_email",
      entityId: result.entry.id,
      action: "invite_sent",
      after: { emailStatus },
    });
    return ok({ ...result.entry, emailStatus }, 201);
  }

  return ok(result.entry, 201);
});
