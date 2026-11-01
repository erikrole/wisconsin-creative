import { z } from "zod";
import { Role } from "@prisma/client";
import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { tokenHash } from "@/lib/auth";
import { API_TOKEN_MAX_DAYS, API_TOKEN_PREFIX } from "@/lib/api-token";
import { randomHex } from "@/lib/crypto";
import { enforceRateLimit } from "@/lib/rate-limit";
import { requireRole } from "@/lib/rbac";
import { createAuditEntry } from "@/lib/audit";

const MAX_ACTIVE_TOKENS = 10;

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  scope: z.enum(["READ", "WRITE"]),
  days: z.number().int().min(1).max(API_TOKEN_MAX_DAYS).default(90),
});

// withAuth already refuses tokens on this path, so a leaked token cannot mint
// more tokens or outlive its own revocation.
function requireBrowserSession(user: { role: Role }) {
  requireRole(user.role, [Role.ADMIN, Role.STAFF]);
}

/** GET /api/me/api-tokens — the caller's active tokens (never the secret). */
export const GET = withAuth(async (_req, { user }) => {
  requireBrowserSession(user);
  const tokens = await db.apiToken.findMany({
    where: { userId: user.id, expiresAt: { gt: new Date() } },
    select: { id: true, name: true, scope: true, expiresAt: true, lastUsedAt: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  return ok({ data: tokens });
});

/** POST /api/me/api-tokens — create a token. The secret is returned once. */
export const POST = withAuth(async (req, { user }) => {
  requireBrowserSession(user);
  await enforceRateLimit(`api-token:create:${user.id}`, { max: 10, windowMs: 60_000 });
  const body = createSchema.parse(await req.json());

  await db.apiToken.deleteMany({ where: { userId: user.id, expiresAt: { lt: new Date() } } });
  const active = await db.apiToken.count({ where: { userId: user.id, expiresAt: { gt: new Date() } } });
  if (active >= MAX_ACTIVE_TOKENS) {
    throw new HttpError(400, `You can have ${MAX_ACTIVE_TOKENS} active tokens. Revoke one first.`);
  }

  const secret = `${API_TOKEN_PREFIX}${randomHex(32)}`;
  const expiresAt = new Date(Date.now() + body.days * 24 * 60 * 60 * 1000);
  const token = await db.apiToken.create({
    data: { userId: user.id, name: body.name, scope: body.scope, tokenHash: await tokenHash(secret), expiresAt },
    select: { id: true, name: true, scope: true, expiresAt: true },
  });

  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "api_token",
    entityId: token.id,
    action: "api_token_created",
    after: { name: token.name, scope: token.scope, expiresAt: token.expiresAt },
  });

  return ok({ data: { ...token, secret } }, 201);
});
