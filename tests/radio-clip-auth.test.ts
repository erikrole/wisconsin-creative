import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { Role } from "@prisma/client";
const mocks = vi.hoisted(() => ({
  session: { findUnique: vi.fn() },
  radioClipAuthorization: { findUnique: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
  radioClipSession: { findUnique: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
  user: { findUnique: vi.fn(), update: vi.fn() }, auditLog: { create: vi.fn() },
  $transaction: vi.fn(), cookie: "browser", actor: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: mocks }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => mocks.cookie ? { value: mocks.cookie } : undefined }) }));
vi.mock("@/lib/env", () => ({ env: { sessionCookieName: "session", trustedOrigins: [] } }));
vi.mock("@/lib/auth", () => ({ tokenHash: async (s: string) => `hashed:${s}`, randomHex: () => "a".repeat(64), requireAuth: mocks.actor }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: vi.fn(), getClientIp: () => "127.0.0.1" }));
vi.mock("@/lib/services/companion-projection-publisher", () => ({ deferCompanionProjectionRefresh: vi.fn() }));
vi.mock("@/lib/preview-activity", () => ({ recordPreviewActivity: vi.fn() }));
import { authorizeRadioClip, exchangeRadioClip, radioClipIdentity, requireRadioClipSession, revokeRadioClipSession } from "@/lib/services/radio-clip-auth";
import { radioClipReturnTo, RADIO_CLIP_CALLBACK } from "@/lib/radio-clip-contract";
import { GET as availability } from "@/app/api/radio-clip/availability/route";
import { POST as authorize } from "@/app/api/radio-clip/authorize/route";
import { PATCH as access } from "@/app/api/radio-clip/access/[id]/route";
const verifier = "v".repeat(43);
const challenge = createHash("sha256").update(verifier).digest("base64url");
const input = { state: "s".repeat(43), codeChallenge: challenge };
const identity = { id: "user", name: "Fixture", email: "fixture@example.invalid", role: Role.STUDENT, active: true, forcePasswordChange: false, radioClipEnabled: true, avatarUrl: null };
const parent = () => ({ id: "browser-session", userId: "user", expiresAt: new Date(Date.now() + 3_600_000), user: { ...identity } });
const grant = () => ({ id: "grant", parentSessionId: "browser-session", expiresAt: new Date(Date.now() + 120_000), challenge, parentSession: parent() });
const bearer = () => new Request("https://example.invalid/api/radio-clip/session", { headers: { authorization: `Bearer ${"a".repeat(64)}` } });
const ctx = { params: Promise.resolve({}) };
beforeEach(() => {
  vi.clearAllMocks(); process.env.RADIO_CLIP_AUTH_ENABLED = "true"; mocks.cookie = "browser";
  mocks.$transaction.mockImplementation(async (fn: (tx: typeof mocks) => unknown) => fn(mocks));
  mocks.session.findUnique.mockResolvedValue(parent()); mocks.radioClipAuthorization.findUnique.mockResolvedValue(grant());
  mocks.radioClipAuthorization.create.mockResolvedValue({ id: "grant" }); mocks.radioClipAuthorization.deleteMany.mockResolvedValue({ count: 1 });
  mocks.radioClipSession.create.mockResolvedValue({ id: "native" }); mocks.radioClipSession.findUnique.mockResolvedValue({ id: "native", expiresAt: new Date(Date.now() + 3_600_000), parentSession: parent() });
  mocks.user.findUnique.mockResolvedValue(identity); mocks.actor.mockResolvedValue(identity);
});
describe("Radio Clip authorization", () => {
  it.each([undefined, "false", "true"])("availability reports rollout without authentication or database access (%s)", async flag => {
    if (flag === undefined) delete process.env.RADIO_CLIP_AUTH_ENABLED;
    else process.env.RADIO_CLIP_AUTH_ENABLED = flag;
    const res = await availability(new Request("https://example.invalid/api/radio-clip/availability"), ctx);
    expect(await res.json()).toEqual({ version: 1, available: flag === "true" });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.actor).not.toHaveBeenCalled(); expect(mocks.$transaction).not.toHaveBeenCalled();
  });
  it.each([Role.ADMIN, Role.STAFF, Role.STUDENT])("requires explicit access even for %s", role => {
    expect(() => radioClipIdentity({ ...identity, role, radioClipEnabled: false })).toThrow();
    expect(radioClipIdentity({ ...identity, role }).canPublish).toBe(role !== Role.STUDENT);
  });
  it.each([{ active: false }, { forcePasswordChange: true }, { role: Role.COLLABORATOR }])("denies ineligible identity %j", changes => {
    expect(() => radioClipIdentity({ ...identity, ...changes })).toThrow();
  });
  it("fails closed when the rollout flag is off", async () => {
    process.env.RADIO_CLIP_AUTH_ENABLED = "false";
    await expect(exchangeRadioClip({ code: "a".repeat(64), codeVerifier: verifier })).rejects.toMatchObject({ status: 503 });
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });
  it("issues a fixed callback with state, only hashes in storage and no secrets in audit", async () => {
    const result = await authorizeRadioClip(identity, input);
    expect(result.callbackURL).toBe(`${RADIO_CLIP_CALLBACK}?code=${"a".repeat(64)}&state=${input.state}`);
    expect(mocks.radioClipAuthorization.create.mock.calls[0]?.[0].data.codeHash).toBe(`hashed:radio-clip-code:${"a".repeat(64)}`);
    expect(JSON.stringify(mocks.auditLog.create.mock.calls)).not.toContain("a".repeat(64));
  });
  it("refuses preview and cross-account browser identity", async () => {
    await expect(authorizeRadioClip({ ...identity, preview: {} } as never, input)).rejects.toMatchObject({ status: 403 });
    await expect(authorizeRadioClip({ ...identity, id: "other" }, input)).rejects.toMatchObject({ status: 401 });
  });
  it("requires CSRF origin on browser approval", async () => {
    const res = await authorize(new Request("https://example.invalid/api/radio-clip/authorize", { method: "POST", body: JSON.stringify(input) }), ctx);
    expect(res.status).toBe(403); expect(mocks.radioClipAuthorization.create).not.toHaveBeenCalled();
  });
  it("exchanges PKCE once and caps native lifetime at parent expiry", async () => {
    const result = await exchangeRadioClip({ code: "a".repeat(64), codeVerifier: verifier });
    expect(result.user.canPublish).toBe(false); expect(new Date(result.expiresAt).getTime()).toBeLessThanOrEqual(Date.now() + 3_600_000);
    expect(mocks.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
    mocks.radioClipAuthorization.findUnique.mockResolvedValue(null);
    await expect(exchangeRadioClip({ code: "a".repeat(64), codeVerifier: verifier })).rejects.toMatchObject({ status: 401 });
    expect(mocks.radioClipSession.create).toHaveBeenCalledTimes(1);
  });
  it("refuses a wrong verifier without consuming the code", async () => {
    await expect(exchangeRadioClip({ code: "a".repeat(64), codeVerifier: "x".repeat(43) })).rejects.toMatchObject({ status: 401 });
    expect(mocks.radioClipAuthorization.deleteMany).not.toHaveBeenCalled();
  });
  it("only one competing consume may create a session", async () => {
    mocks.radioClipAuthorization.deleteMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const results = await Promise.allSettled([1, 2].map(() => exchangeRadioClip({ code: "a".repeat(64), codeVerifier: verifier })));
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1); expect(mocks.radioClipSession.create).toHaveBeenCalledTimes(1);
  });
  it.each(["code", "parent", "revoked"])('refuses expired/revoked %s at exchange', async mode => {
    const value = grant();
    if (mode === "code") value.expiresAt = new Date(0);
    if (mode === "parent") value.parentSession.expiresAt = new Date(0);
    if (mode === "revoked") value.parentSession.user.radioClipEnabled = false;
    mocks.radioClipAuthorization.findUnique.mockResolvedValue(value);
    await expect(exchangeRadioClip({ code: "a".repeat(64), codeVerifier: verifier })).rejects.toThrow();
    expect(mocks.radioClipSession.create).not.toHaveBeenCalled();
  });
  it("never accepts a browser cookie as a native bearer", async () => {
    await expect(requireRadioClipSession(new Request("https://example.invalid", { headers: { cookie: "session=browser" } }))).rejects.toMatchObject({ status: 401 });
  });
  it("rechecks access and current role on every native request", async () => {
    expect((await requireRadioClipSession(bearer())).user.canPublish).toBe(false);
    const value = parent(); value.user.radioClipEnabled = false;
    mocks.radioClipSession.findUnique.mockResolvedValue({ expiresAt: value.expiresAt, parentSession: value });
    await expect(requireRadioClipSession(bearer())).rejects.toMatchObject({ status: 403 });
  });
  it("allows idempotent signout after feature disabled", async () => {
    process.env.RADIO_CLIP_AUTH_ENABLED = "false";
    await revokeRadioClipSession(bearer()); expect(mocks.radioClipSession.deleteMany).toHaveBeenCalledWith({ where: { id: "native" } });
    mocks.radioClipSession.findUnique.mockResolvedValue(null); await revokeRadioClipSession(bearer());
  });
  it.each([Role.STAFF, Role.STUDENT, Role.COLLABORATOR])("%s cannot grant access", async role => {
    mocks.actor.mockResolvedValue({ ...identity, role });
    const res = await access(new Request("https://example.invalid/api/radio-clip/access/user", { method: "PATCH", headers: { origin: "https://example.invalid" }, body: JSON.stringify({ enabled: true }) }), { params: Promise.resolve({ id: "user" }) });
    expect(res.status).toBe(403); expect(mocks.user.update).not.toHaveBeenCalled();
  });
  it("admin revocation removes outstanding grants and sessions atomically", async () => {
    mocks.actor.mockResolvedValue({ ...identity, role: Role.ADMIN });
    const res = await access(new Request("https://example.invalid/api/radio-clip/access/user", { method: "PATCH", headers: { origin: "https://example.invalid" }, body: JSON.stringify({ enabled: false }) }), { params: Promise.resolve({ id: "user" }) });
    expect(res.status).toBe(200); expect(mocks.radioClipSession.deleteMany).toHaveBeenCalledWith({ where: { parentSession: { userId: "user" } } });
    expect(mocks.auditLog.create).toHaveBeenCalled();
  });
  it("restricts login return to the validated first-party flow", () => {
    const good = `/radio-clip/authorize?${new URLSearchParams(input)}`;
    expect(radioClipReturnTo(good)).toBe(good);
    for (const bad of ["https://evil.invalid", "//evil.invalid", "/radio-clip/authorize?state=x", good + "#fragment", good + "&redirect=https://evil.invalid", "/radio-clip/authorize/../other?" + new URLSearchParams(input)]) expect(radioClipReturnTo(bad)).toBe("/");
  });
});
