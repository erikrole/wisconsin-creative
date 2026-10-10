import { readFileSync } from "node:fs";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { parseEspnFootballSchedule, parseUwFootballSchedule } from "@/lib/football-results";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(), query: vi.fn(), findMany: vi.fn(), upsert: vi.fn(), update: vi.fn(), audit: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: { $transaction: mocks.transaction } }));
vi.mock("@/lib/audit", () => ({ createAuditEntriesTx: mocks.audit }));
import { refreshFootballResults } from "@/lib/services/football-results";

const html = readFileSync("tests/fixtures/football-results/uw-2026.html", "utf8");
const json = readFileSync("tests/fixtures/football-results/espn-2026.json", "utf8");
const observedAt = new Date("2026-10-01T12:00:00Z");
const current = new Date("2026-10-02T01:00:00Z");
const tx = { $queryRaw: mocks.query, calendarEvent: { findMany: mocks.findMany },
  gameResultObservation: { upsert: mocks.upsert, update: mocks.update } };
const fetcher = vi.fn();
function existing() {
  return [parseUwFootballSchedule(html, 2026).find((row) => row.externalId === "17144")!,
    parseEspnFootballSchedule(JSON.parse(json), 2026).find((row) => row.externalId === "401858466")!]
    .map((snapshot) => ({ id: snapshot.provider, eventId: "game", provider: snapshot.provider, externalId: snapshot.externalId,
      snapshot, observedAt, lastAttemptAt: observedAt, lastError: null }));
}
function game() {
  return { id: "game", sportCode: "FB", opponent: "Penn State", site: "AWAY", result: "WIN", startsAt: new Date("2026-09-26T21:00Z"),
    allDay: false, rawStartsAt: null, rawAllDay: null, source: { url: "webcal://uwbadgers.com/api/v2/Calendar/subscribe?type=ics" },
    resultObservations: existing() };
}
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(current);
  vi.stubGlobal("fetch", fetcher);
  mocks.query.mockResolvedValue([{ locked: true }]);
  mocks.findMany.mockResolvedValue([game()]);
  mocks.transaction.mockImplementation(async (callback) => callback(tx));
  fetcher.mockImplementation(async (url: string) => new Response(url.includes("uwbadgers.com") ? html : json));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("football refresh persistence", () => {
  it("refreshes both observations atomically without rewriting events or auditing unchanged facts", async () => {
    const result = await refreshFootballResults({ id: "admin", role: "ADMIN" });
    expect(result).toMatchObject({ ok: true, events: 1, updated: 2, retained: 0, issues: [] });
    expect(mocks.upsert).toHaveBeenCalledTimes(2);
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable", timeout: 15000 });
    expect(mocks.audit).toHaveBeenCalledWith(tx, []);
  });
  it("keeps a failed source's snapshot and reports partial success", async () => {
    fetcher.mockImplementation(async (url: string) => url.includes("uwbadgers.com") ? new Response(html) : new Response("Down", { status: 503 }));
    const result = await refreshFootballResults();
    expect(result).toMatchObject({ ok: false, updated: 1, retained: 1, issues: [{ eventId: "game", provider: "ESPN", reason: "fetch_failed" }] });
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "ESPN" }, data: { lastAttemptAt: current, lastError: "fetch_failed" } });
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
  });
  it("refuses two local events competing for the same provider game", async () => {
    mocks.findMany.mockResolvedValue([game(), { ...game(), id: "duplicate", resultObservations: [] }]);
    const result = await refreshFootballResults();
    expect(result.updated).toBe(0);
    expect(result.issues).toHaveLength(4);
    expect(result.issues.every((issue) => issue.reason === "ambiguous_match")).toBe(true);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("never silently rebinds a previously linked provider ID", async () => {
    const event = game(); event.resultObservations[1]!.externalId = "999";
    mocks.findMany.mockResolvedValue([event]);
    expect(await refreshFootballResults()).toMatchObject({ issues: [{ provider: "ESPN", reason: "identity_changed" }] });
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
  });
  it("audits a changed observation with the operator and both versions", async () => {
    const event = game(); event.resultObservations[0]!.snapshot.wisconsin = 23;
    mocks.findMany.mockResolvedValue([event]);
    await refreshFootballResults({ id: "staff", role: "STAFF" });
    expect(mocks.audit).toHaveBeenCalledWith(tx, [expect.objectContaining({ actorId: "staff", actorRole: "STAFF",
      before: expect.objectContaining({ snapshot: expect.objectContaining({ wisconsin: 23 }) }),
      after: expect.objectContaining({ snapshot: expect.objectContaining({ wisconsin: 24 }) }) })]);
  });
  it("does not overwrite observations saved by a refresh that started later", async () => {
    const event = game(); for (const row of event.resultObservations) row.lastAttemptAt = new Date(current.getTime() + 1000);
    mocks.findMany.mockResolvedValue([event]);
    expect(await refreshFootballResults()).toMatchObject({ updated: 0, retained: 2 });
    expect(mocks.upsert).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
  });
  it("rejects overlapping refresh transactions before writes", async () => {
    mocks.query.mockResolvedValue([{ locked: false }]);
    await expect(refreshFootballResults()).rejects.toMatchObject({ status: 409 });
    expect(mocks.findMany).not.toHaveBeenCalled(); expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
