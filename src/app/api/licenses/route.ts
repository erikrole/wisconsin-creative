import { z } from "zod";
import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { createAuditEntry } from "@/lib/audit";
import { listAllCodes, listCodes, createCode } from "@/lib/services/licenses";

const createSchema = z.object({
  code: z.string().min(4, "Code must be at least 4 characters").max(120, "Code must be 120 characters or fewer"),
  label: z.string().max(200, "Label must be 200 characters or fewer").optional(),
  accountEmail: z.string().email().optional(),
  expiresAt: z.string().datetime().optional(),
});

export const GET = withAuth(async (_req, { user }) => {
  requirePermission(user.role, "license", "view");
  const isAdmin = user.role === "ADMIN" || user.role === "STAFF";
  const codes = isAdmin ? await listAllCodes() : await listCodes();

  // Strip the code string from rows the requester does not hold.
  // Admins/staff see the management model. Students receive an explicit
  // self-service DTO: pool metadata, safe active-holder identity, and no
  // account email, occupant label, or management fields. Defense in depth —
  // clients also mask the key visually.
  if (!isAdmin) {
    const sanitized = codes.map((code) => {
      const isHolder = code.claims.some((claim) => claim.userId === user.id);
      return {
        id: code.id,
        code: isHolder ? code.code : "",
        label: code.label,
        expiresAt: code.expiresAt,
        status: code.status,
        claims: code.claims.map((claim) => {
          const isOwnClaim = claim.userId === user.id;
          return {
            id: claim.id,
            userId: isOwnClaim ? claim.userId : null,
            // A student can see who is using a slot, but does not need the
            // other account's stable id to understand the pool.
            user: claim.user
              ? {
                  ...(isOwnClaim ? { id: claim.user.id } : {}),
                  name: claim.user.name,
                  avatarUrl: claim.user.avatarUrl,
                }
              : null,
            occupantLabel: null,
            claimedAt: claim.claimedAt,
          };
        }),
      };
    });
    return ok({ data: sanitized });
  }

  return ok({ data: codes });
});

export const POST = withAuth(async (req, { user }) => {
  requirePermission(user.role, "license", "manage");
  const body = createSchema.parse(await req.json());
  const code = await createCode(
    body.code,
    body.label,
    user.id,
    body.accountEmail,
    body.expiresAt ? new Date(body.expiresAt) : undefined
  );

  createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "license_code",
    entityId: code.id,
    action: "create",
    after: { code: code.code, label: code.label },
  }).catch(console.error);

  return ok({ data: code }, 201);
});
