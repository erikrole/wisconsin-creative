import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/audit", () => ({ createAuditEntry: vi.fn(), createAuditEntryTx: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(),
  SETTINGS_MUTATION_LIMIT: { limit: 100, windowMs: 60_000 },
}));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/services/onboarding-lifecycle", () => ({
  updatePendingAllowedEmailProfile: vi.fn(),
  createAllowedEmailInvite: vi.fn(),
  createAllowedEmailInvitesBulk: vi.fn(),
}));

const models = {
  allowedEmail: { findMany: vi.fn(), count: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), deleteMany: vi.fn() },
  user: { findMany: vi.fn() },
};
vi.mock("@/lib/db", () => ({ get db() { return models; } }));

import { requireAuth } from "@/lib/auth";
import { GET as listAllowed } from "@/app/api/allowed-emails/route";
import { DELETE as deleteAllowed, PATCH as patchAllowed } from "@/app/api/allowed-emails/[id]/route";
import { GET as readiness } from "@/app/api/users/onboarding-readiness/route";
import { updatePendingAllowedEmailProfile } from "@/lib/services/onboarding-lifecycle";
import { assertNotHiringInvite, excludeHiringInvites } from "@/lib/hiring/invite-scope";

const user = (role: "ADMIN" | "STAFF") => ({
  id: `${role}-1`,
  email: `${role}@example.test`,
  name: role,
  role,
  avatarUrl: null,
  forcePasswordChange: false,
});

const req = (url: string, method: string, body?: unknown) =>
  new Request(`https://app.example.com${url}`, {
    method,
    headers: { host: "app.example.com", origin: "https://app.example.com", "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const ctx = { params: Promise.resolve({ id: "invite-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  models.allowedEmail.findMany.mockResolvedValue([]);
  models.allowedEmail.count.mockResolvedValue(0);
  models.user.findMany.mockResolvedValue([]);
});

describe("hire invites stay inside the hiring boundary", () => {
  it("excludes application-linked invites for everyone except admins", () => {
    expect(excludeHiringInvites("ADMIN")).toBeNull();
    expect(excludeHiringInvites("STAFF")).toEqual({ applications: { none: {} } });
    expect(excludeHiringInvites("STUDENT")).toEqual({ applications: { none: {} } });
  });

  it("hides a hire invite from the staff allowlist listing, but not from admins", async () => {
    vi.mocked(requireAuth).mockResolvedValue(user("STAFF") as never);
    await listAllowed(req("/api/allowed-emails", "GET"), { params: Promise.resolve({}) });
    expect(JSON.stringify(models.allowedEmail.findMany.mock.calls[0]![0].where)).toContain('"applications":{"none":{}}');

    models.allowedEmail.findMany.mockClear();
    vi.mocked(requireAuth).mockResolvedValue(user("ADMIN") as never);
    await listAllowed(req("/api/allowed-emails", "GET"), { params: Promise.resolve({}) });
    expect(JSON.stringify(models.allowedEmail.findMany.mock.calls[0]![0].where)).not.toContain("applications");
  });

  it("hides hire invites from the onboarding readiness view for staff", async () => {
    vi.mocked(requireAuth).mockResolvedValue(user("STAFF") as never);
    await readiness(req("/api/users/onboarding-readiness", "GET"), { params: Promise.resolve({}) });
    expect(JSON.stringify(models.allowedEmail.findMany.mock.calls[0]![0].where)).toContain('"applications":{"none":{}}');

    models.allowedEmail.findMany.mockClear();
    vi.mocked(requireAuth).mockResolvedValue(user("ADMIN") as never);
    await readiness(req("/api/users/onboarding-readiness", "GET"), { params: Promise.resolve({}) });
    expect(JSON.stringify(models.allowedEmail.findMany.mock.calls[0]![0].where)).not.toContain("applications");
  });

  it("returns 404 (not 403) when staff try to edit or delete a hire invite, without touching it", async () => {
    vi.mocked(requireAuth).mockResolvedValue(user("STAFF") as never);
    models.allowedEmail.findFirst.mockResolvedValue({ id: "invite-1" }); // linked to an application

    const patched = await patchAllowed(req("/api/allowed-emails/invite-1", "PATCH", { preloadedName: "X", preloadedPrimaryArea: null, preloadedAreas: [], preloadedSportCodes: [] }), ctx);
    expect(patched.status).toBe(404);
    expect(updatePendingAllowedEmailProfile).not.toHaveBeenCalled();

    const deleted = await deleteAllowed(req("/api/allowed-emails/invite-1", "DELETE"), ctx);
    expect(deleted.status).toBe(404);
    expect(models.allowedEmail.deleteMany).not.toHaveBeenCalled();
  });

  it("enforces the scope inside the delete itself, so an invite adopted after the check still cannot be deleted by staff", async () => {
    vi.mocked(requireAuth).mockResolvedValue(user("STAFF") as never);
    models.allowedEmail.findFirst.mockResolvedValue(null); // the separate check passed...
    models.allowedEmail.findUnique.mockResolvedValue({ id: "invite-1", email: "x@example.edu", role: "STUDENT", claimedAt: null });
    models.allowedEmail.deleteMany.mockResolvedValue({ count: 0 }); // ...but the conditional delete matched nothing
    const res = await deleteAllowed(req("/api/allowed-emails/invite-1", "DELETE"), ctx);
    expect(models.allowedEmail.deleteMany.mock.calls[0]![0].where).toEqual({ id: "invite-1", claimedAt: null, applications: { none: {} } });
    expect(res.status).toBe(400);
  });

  it("does not add the scope to an admin's delete", async () => {
    vi.mocked(requireAuth).mockResolvedValue(user("ADMIN") as never);
    models.allowedEmail.findUnique.mockResolvedValue({ id: "invite-1", email: "x@example.edu", role: "STUDENT", claimedAt: null });
    models.allowedEmail.deleteMany.mockResolvedValue({ count: 1 });
    await deleteAllowed(req("/api/allowed-emails/invite-1", "DELETE"), ctx);
    expect(models.allowedEmail.deleteMany.mock.calls[0]![0].where).toEqual({ id: "invite-1", claimedAt: null });
  });

  it("tells the profile update to hide hire invites for non-admins (applied inside its transaction)", async () => {
    vi.mocked(requireAuth).mockResolvedValue(user("STAFF") as never);
    models.allowedEmail.findFirst.mockResolvedValue(null);
    vi.mocked(updatePendingAllowedEmailProfile).mockResolvedValue({ entry: { id: "invite-1" } } as never);
    await patchAllowed(req("/api/allowed-emails/invite-1", "PATCH", { preloadedName: "X", preloadedPrimaryArea: null, preloadedAreas: [], preloadedSportCodes: [] }), ctx);
    expect(vi.mocked(updatePendingAllowedEmailProfile).mock.calls[0]![0]).toMatchObject({ hideHiringInvites: true });

    vi.mocked(requireAuth).mockResolvedValue(user("ADMIN") as never);
    await patchAllowed(req("/api/allowed-emails/invite-1", "PATCH", { preloadedName: "X", preloadedPrimaryArea: null, preloadedAreas: [], preloadedSportCodes: [] }), ctx);
    expect(vi.mocked(updatePendingAllowedEmailProfile).mock.calls[1]![0]).toMatchObject({ hideHiringInvites: false });
  });

  it("lets staff manage ordinary invites that are not linked to an application", async () => {
    vi.mocked(requireAuth).mockResolvedValue(user("STAFF") as never);
    models.allowedEmail.findFirst.mockResolvedValue(null);
    models.allowedEmail.findUnique.mockResolvedValue({ id: "invite-1", email: "student@example.edu", role: "STUDENT", claimedAt: null });
    models.allowedEmail.deleteMany.mockResolvedValue({ count: 1 });
    const res = await deleteAllowed(req("/api/allowed-emails/invite-1", "DELETE"), ctx);
    expect(res.status).toBe(200);
  });

  it("does not even query for admins", async () => {
    await assertNotHiringInvite("ADMIN", "invite-1");
    expect(models.allowedEmail.findFirst).not.toHaveBeenCalled();
  });
});
