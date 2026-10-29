import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  studentAvailabilityBlock: { findFirst: vi.fn() },
  userAppInstallation: { findFirst: vi.fn() },
  deviceToken: { findFirst: vi.fn() },
  webPushSubscription: { findFirst: vi.fn() },
  booking: { findFirst: vi.fn() },
  systemConfig: { findUnique: vi.fn() },
  $transaction: vi.fn(),
}));
const auditMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/audit", () => ({ createAuditEntryTx: auditMock }));
vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(),
  SETTINGS_MUTATION_LIMIT: { limit: 30, windowMs: 60_000 },
}));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import { requireAuth } from "@/lib/auth";
import { GET, PATCH } from "@/app/api/users/[id]/onboarding-checklist/route";
import { applyOnboardingCheck, buildOnboardingChecklist, parseOnboardingChecks } from "@/lib/onboarding-checklist";

const admin = { id: "admin-1", email: "a@wisc.edu", name: "Erik Role", role: "ADMIN" as const, avatarUrl: null };
const params = { params: Promise.resolve({ id: "stu-1" }) };

const profile = {
  id: "stu-1", name: "Maya Chen", role: "STUDENT" as const, email: "maya@wisc.edu", athleticsEmail: null, phone: null,
  personalPhone: null, workPhone: null, workPhoneNotApplicable: false, wiscardCardNumber: null, wiscardIssueCode: null,
  studentYearOverride: null, gradYear: null, graduationTerm: null, topSizeFit: null, topSize: null, shoeSizeSystem: null,
  shoeSize: null, avatarUrl: null, profilePromptSnoozedUntil: null,
};

function request(method: string, body?: unknown) {
  return new Request("https://app.example.com/api/users/stu-1/onboarding-checklist", {
    method,
    headers: { "content-type": "application/json", host: "app.example.com", origin: "https://app.example.com" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(admin);
  dbMock.$transaction.mockImplementation(async (op: (tx: typeof dbMock) => Promise<unknown>) => op(dbMock));
  dbMock.user.findUnique.mockResolvedValue({ ...profile, lastActiveAt: null, onboardingChecks: null });
  dbMock.user.findMany.mockResolvedValue([]);
  dbMock.systemConfig.findUnique.mockResolvedValue({ value: { slack: { contact: "Erik", note: "" } } });
  for (const model of [dbMock.studentAvailabilityBlock, dbMock.userAppInstallation, dbMock.deviceToken, dbMock.webPushSubscription, dbMock.booking]) {
    model.findFirst.mockResolvedValue(null);
  }
});

describe("buildOnboardingChecklist", () => {
  const facts = { profile, signedIn: false, hasClassSchedule: false, hasIosApp: false, hasPush: false, hasCheckout: false, checks: {}, guide: {}, names: {} };

  it("starts empty, and Wiscard never counts toward the total", () => {
    const list = buildOnboardingChecklist(facts);
    expect(list.done).toBe(0);
    expect(list.rows.find((row) => row.key === "wiscard")?.optional).toBe(true);
    expect(list.total).toBe(list.rows.length - 1);
  });

  it("reads each row from the student's own data", () => {
    const list = buildOnboardingChecklist({
      ...facts,
      profile: { ...profile, personalPhone: "6085550142", avatarUrl: "https://x/y.png", wiscardCardNumber: "1", wiscardIssueCode: "1" },
      signedIn: true, hasClassSchedule: true, hasIosApp: true, hasPush: true, hasCheckout: true,
    });
    const done = Object.fromEntries(list.rows.map((row) => [row.key, row.done]));
    expect(done).toMatchObject({ signed_in: true, photo: true, phone: true, wiscard: true, class_schedule: true, app: true, notifications: true, checkout: true, student: false, sizes: false });
    expect(list.done).toBe(7);
  });

  it("shows who ticked a manual step and ignores unknown stored steps", () => {
    const checks = parseOnboardingChecks({ orientation: { at: "2026-10-29T15:00:00Z", by: "admin-1" }, bogus: { at: "x", by: "y" } });
    expect(Object.keys(checks)).toEqual(["orientation"]);
    const row = buildOnboardingChecklist({ ...facts, checks, names: { "admin-1": "Erik Role" } }).rows.find((r) => r.key === "orientation");
    expect(row).toMatchObject({ done: true, doneBy: "Erik Role", manual: true });
  });
});

describe("applyOnboardingCheck", () => {
  const now = new Date("2026-10-29T17:00:00Z");

  it("ticks with who and when, and keeps them when ticked again", () => {
    const ticked = applyOnboardingCheck({}, "slack", { done: true }, "admin-1", now);
    expect(ticked.slack).toEqual({ at: now.toISOString(), by: "admin-1" });
    expect(applyOnboardingCheck(ticked, "slack", { done: true }, "admin-2")).toBe(ticked);
  });

  it("adds and clears a note only on a ticked step", () => {
    const ticked = applyOnboardingCheck({}, "adobe", { done: true, note: " Needs wisc email " }, "admin-1", now);
    expect(ticked.adobe?.note).toBe("Needs wisc email");
    expect(applyOnboardingCheck(ticked, "adobe", { note: "" }, "admin-1").adobe?.note).toBeUndefined();
    expect(applyOnboardingCheck({}, "adobe", { note: "x" }, "admin-1")).toEqual({});
  });

  it("unticks and drops the note", () => {
    const ticked = applyOnboardingCheck({}, "asana", { done: true, note: "n" }, "admin-1", now);
    expect(applyOnboardingCheck(ticked, "asana", { done: false }, "admin-1")).toEqual({});
  });
});

describe("/api/users/[id]/onboarding-checklist", () => {
  it("is admin-only", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ...admin, role: "STAFF" as never });
    const res = await GET(request("GET"), params);
    expect(res.status).toBe(403);
    expect(dbMock.user.findUnique).not.toHaveBeenCalled();
  });

  it("only answers for students", async () => {
    dbMock.user.findUnique.mockResolvedValue({ ...profile, role: "STAFF", lastActiveAt: null, onboardingChecks: null });
    expect((await GET(request("GET"), params)).status).toBe(404);
  });

  it("ticks a manual step with who and when, and writes an audit entry", async () => {
    const res = await PATCH(request("PATCH", { step: "gear_training", done: true }), params);
    expect(res.status).toBe(200);
    const saved = dbMock.user.update.mock.calls[0]![0].data.onboardingChecks;
    expect(saved.gear_training).toMatchObject({ by: "admin-1" });
    expect(auditMock).toHaveBeenCalledWith(dbMock, expect.objectContaining({ action: "onboarding_check_updated", entityId: "stu-1" }));
  });

  it("does nothing when the step is already in that state", async () => {
    dbMock.user.findUnique.mockResolvedValue({ ...profile, lastActiveAt: null, onboardingChecks: { orientation: { at: "2026-10-29T15:00:00Z", by: "admin-1" } } });
    await PATCH(request("PATCH", { step: "orientation", done: true }), params);
    expect(dbMock.user.update).not.toHaveBeenCalled();
  });

  it("returns the shared contact for a step", async () => {
    const body = await (await GET(request("GET"), params)).json();
    expect(body.data.rows.find((row: { key: string }) => row.key === "slack")).toMatchObject({ contact: "Erik", hint: null });
  });

  it("rejects steps that are not manual", async () => {
    const res = await PATCH(request("PATCH", { step: "photo", done: true }), params);
    expect(res.status).toBe(400);
  });
});
