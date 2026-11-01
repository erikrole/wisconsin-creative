import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";
import { jsonRequest, routeCtx, authUser } from "./_helpers/route-request";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  rateLimit: vi.fn(),
  auditTx: vi.fn(),
  user: { findMany: vi.fn(), update: vi.fn() },
  transactionCalls: [] as Array<{ options: unknown }>,
}));

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: mocks.rateLimit, SETTINGS_MUTATION_LIMIT: { max: 60, windowMs: 60_000 } }));
vi.mock("@/lib/audit", () => ({ createAuditEntriesTx: mocks.auditTx }));
vi.mock("@/lib/db", () => ({
  db: {
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>, options?: unknown) => {
      mocks.transactionCalls.push({ options });
      return fn({ user: mocks.user });
    }),
  },
}));

import { POST } from "@/app/api/onboarding-checklist/bulk/route";

const admin = authUser(Role.ADMIN);
const tick = (body: unknown) => POST(jsonRequest("/api/onboarding-checklist/bulk", "POST", body), routeCtx({}));
const ticked = { at: "2026-10-26T15:00:00.000Z", by: "admin-0", note: "Done at orientation" };

beforeEach(() => {
  mocks.transactionCalls.length = 0;
  mocks.requireAuth.mockResolvedValue(admin);
  mocks.rateLimit.mockResolvedValue(undefined);
  mocks.user.update.mockResolvedValue({});
  mocks.auditTx.mockResolvedValue(undefined);
});

describe("POST /api/onboarding-checklist/bulk", () => {
  it("ticks a step for every student in the group who does not have it yet, keeping existing ticks as they were", async () => {
    mocks.user.findMany.mockResolvedValue([
      { id: "s1", onboardingChecks: null },
      { id: "s2", onboardingChecks: { slack: ticked } },
      { id: "s3", onboardingChecks: { asana: ticked } },
    ]);

    const res = await tick({ step: "slack", done: true, userIds: ["s1", "s2", "s3"] });

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ changed: 2 });
    expect(mocks.transactionCalls[0]!.options).toEqual({ isolationLevel: "Serializable" });
    expect(mocks.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ["s1", "s2", "s3"] }, role: Role.STUDENT },
    }));
    expect(mocks.user.update).toHaveBeenCalledTimes(2);
    const s1 = mocks.user.update.mock.calls.find((c) => c[0].where.id === "s1")![0].data.onboardingChecks;
    expect(s1.slack).toMatchObject({ by: admin.id });
    expect(Date.parse(s1.slack.at)).toBeGreaterThan(Date.now() - 10_000);
    const s3 = mocks.user.update.mock.calls.find((c) => c[0].where.id === "s3")![0].data.onboardingChecks;
    expect(s3).toMatchObject({ asana: ticked, slack: { by: admin.id } });
    expect(mocks.user.update.mock.calls.some((c) => c[0].where.id === "s2")).toBe(false);
    const audits = mocks.auditTx.mock.calls[0]![1];
    expect(audits).toHaveLength(2);
    expect(audits[0]).toMatchObject({
      actorId: admin.id, entityType: "user", entityId: "s1", action: "onboarding_check_updated",
      before: { step: "slack", done: false }, after: { step: "slack", done: true },
    });
  });

  it("unticks a step only where it was ticked and drops its note", async () => {
    mocks.user.findMany.mockResolvedValue([
      { id: "s1", onboardingChecks: { slack: ticked, asana: ticked } },
      { id: "s2", onboardingChecks: {} },
    ]);

    const res = await tick({ step: "slack", done: false, userIds: ["s1", "s2"] });

    expect((await res.json()).data).toEqual({ changed: 1 });
    expect(mocks.user.update).toHaveBeenCalledWith({ where: { id: "s1" }, data: { onboardingChecks: { asana: ticked } } });
    expect(mocks.auditTx.mock.calls[0]![1]).toEqual([expect.objectContaining({ entityId: "s1", before: { step: "slack", done: true }, after: { step: "slack", done: false } })]);
  });

  it("ignores ids that are not students and reports zero changes", async () => {
    mocks.user.findMany.mockResolvedValue([]);

    const res = await tick({ step: "adobe", done: true, userIds: ["staff-9"] });

    expect((await res.json()).data).toEqual({ changed: 0 });
    expect(mocks.user.update).not.toHaveBeenCalled();
    expect(mocks.auditTx).toHaveBeenCalledWith(expect.anything(), []);
  });

  it.each([
    ["an automatic step", { step: "invite_accepted", done: true, userIds: ["s1"] }],
    ["no students", { step: "slack", done: true, userIds: [] }],
    ["more than 100 students", { step: "slack", done: true, userIds: Array.from({ length: 101 }, (_, i) => `s${i}`) }],
    ["a missing done flag", { step: "slack", userIds: ["s1"] }],
  ])("rejects %s", async (_label, body) => {
    const res = await tick(body);

    expect(res.status).toBe(400);
    expect(mocks.user.findMany).not.toHaveBeenCalled();
  });

  it("is admin only and rate-limited per admin", async () => {
    mocks.requireAuth.mockResolvedValue(authUser(Role.STAFF));
    expect((await tick({ step: "slack", done: true, userIds: ["s1"] })).status).toBe(403);
    expect(mocks.rateLimit).not.toHaveBeenCalled();

    mocks.requireAuth.mockResolvedValue(admin);
    mocks.user.findMany.mockResolvedValue([]);
    await tick({ step: "slack", done: true, userIds: ["s1"] });
    expect(mocks.rateLimit).toHaveBeenCalledWith(`onboarding-checklist:${admin.id}`, { max: 60, windowMs: 60_000 });
  });
});
