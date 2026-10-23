import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";

// Same ownership guard as the existing continuity harness: never accept an app URL.
const root = realpathSync(process.env.WC_ONBOARDING_POSTGRES_ROOT ?? "/missing-owned-cluster");
const connection = new URL(process.env.WC_ONBOARDING_POSTGRES_URL ?? "invalid:");
if (!root.startsWith(`${realpathSync("/tmp")}/wc-onboarding-pg-`) || connection.hostname !== "localhost"
  || connection.username !== "wc_onboarding_test" || connection.pathname !== "/wc_onboarding_test"
  || connection.searchParams.get("host") !== path.join(root, "socket")) throw new Error("Refusing an unowned database.");
connection.searchParams.set("connection_limit", "8");
const client = new PrismaClient({ datasourceUrl: connection.href });
let hashGate: { arrived: () => void; released: Promise<void> } | null = null;
const jar = new Map<string, string>();
vi.mock("@/lib/db", () => ({ get db() { return client; } }));
// Only the framework's cookie context is supplied; HMAC/bcrypt/session writes stay real.
vi.mock("next/headers", () => ({ cookies: async () => ({
  get: (name: string) => jar.has(name) ? { value: jar.get(name) } : undefined,
  set: (name: string, value: string) => { jar.set(name, value); },
  delete: (name: string) => { jar.delete(name); },
}) }));
vi.mock("@/lib/auth", async (original) => {
  const auth = await original<typeof import("@/lib/auth")>();
  return { ...auth, hashPassword: async (password: string) => {
    const gate = hashGate;
    if (gate) { hashGate = null; gate.arrived(); await gate.released; }
    return auth.hashPassword(password);
  } };
});
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => ({ allowed: true }), getClientIp: () => "127.0.0.1" }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
import { verifyPassword, tokenHash } from "@/lib/auth";
import { env } from "@/lib/env";
import { issueInviteToken, INVITE_TOKEN_TTL_MS } from "@/lib/services/invite-token";
import { POST as register } from "@/app/api/auth/register/route";
import { POST as discover } from "@/app/api/auth/discover/route";

const email = "invite.postgres@example.test";
const password = "Local-Fixture-Only-82";
const context = { params: Promise.resolve({}) };
function request(route: string, body: object) {
  return new Request(`${env.appUrl}/api/auth/${route}`, { method: "POST",
    headers: { origin: env.appUrl, "content-type": "application/json" }, body: JSON.stringify(body) });
}
const claim = (inviteToken?: string) => register(request("register", { name: "Test Student", email, password, inviteToken }), context);
const lookup = (invite?: string) => discover(request("discover", { email, invite }), context);
async function invitation() {
  const row = await client.allowedEmail.create({ data: { email, role: "STUDENT", createdById: "invite-test-admin" } });
  const token = await issueInviteToken(row.id);
  expect(token).not.toBeNull();
  return { id: row.id, token: token! };
}
function pauseHash() {
  let arrived!: () => void; let release!: () => void;
  const ready = new Promise<void>((resolve) => { arrived = resolve; });
  const released = new Promise<void>((resolve) => { release = resolve; });
  hashGate = { arrived, released };
  return { ready, release };
}

beforeEach(async () => {
  hashGate = null; jar.clear();
  await client.$executeRawUnsafe("TRUNCATE users, allowed_emails CASCADE");
  await client.user.create({ data: { id: "invite-test-admin", email: "admin.fixture@example.test", name: "Fixture Admin", passwordHash: "not-a-login", role: "ADMIN" } });
});
afterAll(() => client.$disconnect());

describe("invite signup against owned disposable PostgreSQL", () => {
  it("requires inbox proof, commits one claimed account/session, and rejects reuse", async () => {
    const invite = await invitation();
    expect(await (await lookup()).json()).toEqual({ flow: "onboarding", inviteLink: "required" });
    expect(await (await lookup(invite.token)).json()).toEqual({ flow: "onboarding", inviteLink: "valid" });
    expect((await claim()).status).toBe(403);
    expect((await claim("incorrect-proof")).status).toBe(403);
    expect(await client.user.count({ where: { email } })).toBe(0);
    const accepted = await claim(invite.token);
    expect(accepted.status).toBe(201);
    const account = await client.user.findUniqueOrThrow({ where: { email } });
    expect(account).toMatchObject({ role: "STUDENT", onboardingRequired: true });
    expect(await verifyPassword(account.passwordHash, password)).toBe(true);
    expect(await client.allowedEmail.findUniqueOrThrow({ where: { id: invite.id } })).toMatchObject({ claimedById: account.id, inviteTokenHash: null, inviteTokenIssuedAt: null });
    const rawCookie = jar.get(env.sessionCookieName);
    expect(rawCookie).toBeTruthy();
    expect(await client.session.findFirstOrThrow({ where: { userId: account.id } })).toMatchObject({ tokenHash: await tokenHash(rawCookie!) });
    expect(await client.auditLog.count({ where: { action: "registered", entityId: account.id } })).toBe(1);
    expect((await claim(invite.token)).status).toBe(403);
    expect(await issueInviteToken(invite.id)).toBeNull();
    expect(await client.session.count({ where: { userId: account.id } })).toBe(1);
  });

  it("rolls back a stale in-flight claim when a resend rotates its proof", async () => {
    const invite = await invitation(); const barrier = pauseHash();
    const oldClaim = claim(invite.token);
    await barrier.ready;
    const fresh = await issueInviteToken(invite.id);
    barrier.release();
    expect((await oldClaim).status).toBe(403);
    expect(await client.user.count({ where: { email } })).toBe(0);
    expect(await client.session.count()).toBe(0);
    expect(await client.allowedEmail.findUniqueOrThrow({ where: { id: invite.id } })).toMatchObject({ claimedAt: null, inviteTokenHash: await tokenHash(fresh!) });
    expect((await claim(fresh!)).status).toBe(201);
  });

  it("allows only one of two concurrent claims to commit", async () => {
    const invite = await invitation();
    const responses = await Promise.all([claim(invite.token), claim(invite.token)]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 403]);
    const account = await client.user.findUniqueOrThrow({ where: { email } });
    expect(await client.user.count({ where: { email } })).toBe(1);
    expect(await client.session.count({ where: { userId: account.id } })).toBe(1);
    expect(await client.allowedEmail.findUniqueOrThrow({ where: { id: invite.id } })).toMatchObject({ claimedById: account.id, inviteTokenHash: null });
  });

  it("rejects expired proof before creating any account or session", async () => {
    const invite = await invitation();
    await client.allowedEmail.update({ where: { id: invite.id }, data: { inviteTokenIssuedAt: new Date(Date.now() - INVITE_TOKEN_TTL_MS - 1) } });
    expect((await claim(invite.token)).status).toBe(403);
    expect(await client.user.count({ where: { email } })).toBe(0);
    expect(await client.session.count()).toBe(0);
    expect((await client.allowedEmail.findUniqueOrThrow({ where: { id: invite.id } })).claimedAt).toBeNull();
  });

  it("applies the additive 0203 SQL to legacy invite rows and enforces hash uniqueness", async () => {
    const sql = readFileSync("prisma/migrations/0203_allowed_email_invite_token/migration.sql", "utf8");
    await expect(client.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("CREATE SCHEMA invite_migration_fixture");
      await tx.$executeRawUnsafe("SET LOCAL search_path TO invite_migration_fixture");
      await tx.$executeRawUnsafe("CREATE TABLE allowed_emails (id text PRIMARY KEY)");
      await tx.$executeRawUnsafe("INSERT INTO allowed_emails (id) VALUES ('legacy-1'), ('legacy-2')");
      for (const statement of sql.replace(/^--.*$/gm, "").split(";").filter((s) => s.trim())) await tx.$executeRawUnsafe(statement);
      expect(await tx.$queryRawUnsafe("SELECT invite_token_hash, invite_token_issued_at FROM allowed_emails ORDER BY id")).toEqual([{ invite_token_hash: null, invite_token_issued_at: null }, { invite_token_hash: null, invite_token_issued_at: null }]);
      await tx.$executeRawUnsafe("UPDATE allowed_emails SET invite_token_hash = 'fixture-hash' WHERE id = 'legacy-1'");
      await tx.$executeRawUnsafe("UPDATE allowed_emails SET invite_token_hash = 'fixture-hash' WHERE id = 'legacy-2'");
    })).rejects.toMatchObject({ code: "P2010", meta: { code: "23505" } });
    // The failing uniqueness probe rolls back the entire private schema.
    expect(await client.$queryRawUnsafe("SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'invite_migration_fixture'")).toEqual([]);
  });
});
