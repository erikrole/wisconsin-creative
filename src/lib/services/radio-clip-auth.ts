import { radioClipAuthEnabled } from "@/lib/radio-clip-feature";
import { createHash, timingSafeEqual } from "node:crypto";
import { Prisma, type User } from "@prisma/client";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { tokenHash, randomHex, type AuthUser } from "@/lib/auth";
import { HttpError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { createAuditEntryTx } from "@/lib/audit";
import { authorizationInput, exchangeInput, RADIO_CLIP_CALLBACK } from "@/lib/radio-clip-contract";

export function requireRadioClipEnabled() {
  if (!radioClipAuthEnabled()) throw new HttpError(503, "Radio Clip sign-in is not available yet.");
}
export function radioClipIdentity(user: Pick<User, "id" | "name" | "email" | "role" | "active" | "forcePasswordChange" | "radioClipEnabled">) {
  if (!user.active || user.forcePasswordChange || !user.radioClipEnabled) throw new HttpError(403, "This account does not currently have Radio Clip access.");
  requirePermission(user.role, "radio_clip", "access");
  return { id: user.id, name: user.name, email: user.email, role: user.role,
    canEditDrafts: true, canPublish: user.role === "ADMIN" || user.role === "STAFF" };
}
const isolationLevel = Prisma.TransactionIsolationLevel.Serializable;
const includeParent = { parentSession: { include: { user: true } } } as const;

export async function authorizeRadioClip(actor: AuthUser, body: unknown) {
  requireRadioClipEnabled();
  if (actor.preview) throw new HttpError(403, "Exit role preview before signing in to Radio Clip.");
  requirePermission(actor.role, "radio_clip", "access");
  const input = authorizationInput.parse(body);
  const cookie = (await cookies()).get(env.sessionCookieName)?.value;
  if (!cookie) throw new HttpError(401, "Sign in to Wisconsin Creative first.");
  const parentHash = await tokenHash(cookie);
  const code = randomHex(32);
  const codeHash = await tokenHash(`radio-clip-code:${code}`);
  await db.$transaction(async tx => {
    const parent = await tx.session.findUnique({ where: { tokenHash: parentHash }, include: { user: true } });
    if (!parent || parent.userId !== actor.id || parent.expiresAt <= new Date()) throw new HttpError(401, "Session expired.");
    radioClipIdentity(parent.user);
    // Bound outstanding authorizations per browser session, without exposing raw codes in audit.
    await tx.radioClipAuthorization.deleteMany({ where: { parentSessionId: parent.id } });
    const grant = await tx.radioClipAuthorization.create({ data: { codeHash, challenge: input.codeChallenge,
      parentSessionId: parent.id, expiresAt: new Date(Math.min(Date.now() + 120_000, parent.expiresAt.getTime())) } });
    await createAuditEntryTx(tx, { actorId: actor.id, actorRole: parent.user.role, entityType: "RadioClipAuthorization", entityId: grant.id, action: "AUTHORIZE" });
  }, { isolationLevel });
  const callback = new URL(RADIO_CLIP_CALLBACK);
  callback.searchParams.set("code", code); callback.searchParams.set("state", input.state);
  return { callbackURL: callback.toString() };
}

export async function exchangeRadioClip(body: unknown) {
  requireRadioClipEnabled();
  const input = exchangeInput.parse(body);
  const codeHash = await tokenHash(`radio-clip-code:${input.code}`);
  const challenge = createHash("sha256").update(input.codeVerifier).digest("base64url");
  const token = randomHex(32);
  const hash = await tokenHash(`radio-clip-session:${token}`);
  return db.$transaction(async tx => {
    const grant = await tx.radioClipAuthorization.findUnique({ where: { codeHash }, include: includeParent });
    if (!grant || grant.expiresAt <= new Date() || grant.parentSession.expiresAt <= new Date()
      || grant.challenge.length !== challenge.length || !timingSafeEqual(Buffer.from(grant.challenge), Buffer.from(challenge))) {
      throw new HttpError(401, "Authorization expired or invalid. Start sign-in again.");
    }
    const user = radioClipIdentity(grant.parentSession.user);
    const consumed = await tx.radioClipAuthorization.deleteMany({ where: { id: grant.id, expiresAt: { gt: new Date() } } });
    if (consumed.count !== 1) throw new HttpError(401, "Authorization already used.");
    const expiresAt = new Date(Math.min(Date.now() + 30 * 86400_000, grant.parentSession.expiresAt.getTime()));
    const session = await tx.radioClipSession.create({ data: { tokenHash: hash, parentSessionId: grant.parentSessionId, expiresAt } });
    await createAuditEntryTx(tx, { actorId: user.id, actorRole: user.role, entityType: "RadioClipSession", entityId: session.id, action: "SIGN_IN" });
    return { version: 1, token, expiresAt: expiresAt.toISOString(), user };
  }, { isolationLevel });
}

export async function requireRadioClipSession(req: Request) {
  requireRadioClipEnabled();
  const match = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.get("authorization") ?? "");
  if (!match) throw new HttpError(401, "Radio Clip sign-in required.");
  const hash = await tokenHash(`radio-clip-session:${match[1]}`);
  const session = await db.radioClipSession.findUnique({ where: { tokenHash: hash }, include: includeParent });
  if (!session || session.expiresAt <= new Date() || session.parentSession.expiresAt <= new Date()) throw new HttpError(401, "Radio Clip session expired.");
  const user = radioClipIdentity(session.parentSession.user);
  return { session, user };
}

export async function revokeRadioClipSession(req: Request) {
  // A possession-only, idempotent revoke works even after access is removed or the feature is disabled.
  const match = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.get("authorization") ?? "");
  if (!match) throw new HttpError(401, "Radio Clip token required.");
  const hash = await tokenHash(`radio-clip-session:${match[1]}`);
  await db.$transaction(async tx => {
    const session = await tx.radioClipSession.findUnique({ where: { tokenHash: hash }, include: includeParent });
    if (!session) return;
    await tx.radioClipSession.deleteMany({ where: { id: session.id } });
    await createAuditEntryTx(tx, { actorId: session.parentSession.userId, actorRole: session.parentSession.user.role, entityType: "RadioClipSession", entityId: session.id, action: "SIGN_OUT" });
  }, { isolationLevel });
}
