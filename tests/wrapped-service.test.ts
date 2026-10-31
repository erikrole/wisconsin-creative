import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), findMany: vi.fn() },
  gameSnapshot: { findMany: vi.fn() },
  calendarEvent: { findMany: vi.fn() },
  shiftAssignment: { findMany: vi.fn() },
  eventTravelMember: { count: vi.fn() },
  booking: { findMany: vi.fn(), count: vi.fn() },
  shiftTrade: { count: vi.fn() },
  studentBadge: { findMany: vi.fn(), count: vi.fn() },
  wrappedRecap: { findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));

import { getWrappedRecap, loadWrappedGames } from "@/lib/services/wrapped";
import { WRAPPED_RECAP_VERSION } from "@/lib/wrapped/recap";

const BEFORE = new Date("2026-11-20T12:00:00Z");
const AFTER = new Date("2026-12-02T12:00:00Z");

function crewMember(userId: string, extra: Record<string, unknown> = {}) {
  return { userId, name: userId, source: "assignment", area: null, crewLabel: null, attended: null, leftAt: null, ...extra };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.user.findUnique.mockResolvedValue({ id: "me", name: "Bucky Badger", avatarUrl: null, primaryArea: null, role: "STUDENT" });
  db.user.findMany.mockResolvedValue([]);
  db.gameSnapshot.findMany.mockResolvedValue([{
    eventId: "e1",
    title: "Football vs Rival",
    startsAt: new Date("2026-09-05T18:00:00Z"),
    sportCode: "FB",
    opponent: "Rival",
    site: "HOME",
    venue: "Camp Randall Stadium",
    result: "WIN",
    official: true,
    crew: [crewMember("me"), crewMember("absent", { attended: false }), crewMember("removed", { leftAt: "2026-09-06T00:00:00Z" })],
  }]);
  db.calendarEvent.findMany.mockResolvedValue([]);
  db.shiftAssignment.findMany.mockResolvedValue([]);
  db.eventTravelMember.count.mockResolvedValue(0);
  db.booking.findMany.mockResolvedValue([]);
  db.booking.count.mockResolvedValue(0);
  db.shiftTrade.count.mockResolvedValue(0);
  db.studentBadge.findMany.mockResolvedValue([]);
  db.studentBadge.count.mockResolvedValue(0);
  db.wrappedRecap.findUnique.mockResolvedValue(null);
});

describe("loadWrappedGames", () => {
  it("counts only crew who are still on it and weren't marked absent", async () => {
    const [snapshotGame] = await loadWrappedGames(AFTER);
    expect(snapshotGame!.crew.map((member) => member.userId)).toEqual(["me"]);
  });
});

describe("buildWrappedRecap queries", () => {
  it("counts shift hours for unlogged attendance and keeps collaborators out of team totals", async () => {
    await getWrappedRecap("me", { now: BEFORE, preview: true });
    const where = db.shiftAssignment.findMany.mock.calls[0]![0].where;
    expect(where.OR).toEqual([{ attended: null }, { attended: true }]);
    expect(where.attended).toBeUndefined();
    expect(db.booking.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ requester: { role: { not: "COLLABORATOR" } } }),
    });
    expect(db.studentBadge.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ user: { role: { not: "COLLABORATOR" } } }),
    });
  });
});

describe("getWrappedRecap", () => {
  it("keeps historical event totals while omitting hidden crew identities", async () => {
    const snapshot = (await db.gameSnapshot.findMany())[0];
    db.gameSnapshot.findMany.mockResolvedValue([1, 2].map((n) => ({
      ...snapshot, eventId: `e${n}`, crew: [crewMember("me"), crewMember("hidden"), crewMember("visible")],
    })));
    db.user.findMany.mockResolvedValue([{ id: "visible", avatarUrl: null }]);

    const result = await getWrappedRecap("me", { now: BEFORE, preview: true });
    expect(result?.status).toBe("ready");
    if (result?.status !== "ready") throw new Error("Expected a preview");
    expect(result.recap.cards.find((card) => card.id === "crew")?.items?.map((item) => item.userId)).toEqual(["visible"]);
    expect(result.recap.cards.find((card) => card.id === "summary")?.items?.find((item) => item.label === "Top crewmate")?.userId).toBe("visible");
    expect(JSON.stringify(result.recap)).not.toContain("hidden");
    expect(db.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ active: true, hiddenFromRoster: false }),
    }));
  });

  it("redacts identities that became hidden after a recap was frozen", async () => {
    const payload = {
      person: { userId: "me" },
      cards: [
        { id: "events", value: "12", sentence: "12 events worked" },
        { id: "crew", value: "Hidden", sentence: "You and Hidden worked 2 events together.", items: [{ userId: "hidden", label: "Hidden Account", avatarUrl: "https://example.test/hidden.jpg", value: "2 together" }] },
        { id: "summary", layout: "summary", items: [{ label: "Events", value: "12" }, { label: "Top crewmate", value: "Hidden", userId: "hidden" }, { label: "Top crewmate", value: "Legacy Hidden" }] },
      ],
      team: [],
    };
    db.wrappedRecap.findUnique.mockResolvedValue({ version: WRAPPED_RECAP_VERSION, payload });
    db.user.findMany.mockResolvedValue([]);

    const result = await getWrappedRecap("me", { now: AFTER });
    expect(result?.status).toBe("ready");
    if (result?.status !== "ready") throw new Error("Expected a frozen recap");
    expect(result.recap.cards).toEqual([payload.cards[0], { ...payload.cards[2], items: [{ label: "Events", value: "12" }] }]);
    expect(JSON.stringify(result.recap)).not.toContain("Hidden");
    expect(db.wrappedRecap.upsert).not.toHaveBeenCalled();
  });

  it("removes an uncheckable legacy summary name even without any identity cards", async () => {
    const payload = { person: { userId: "me" }, cards: [{ id: "summary", layout: "summary", items: [{ label: "Events", value: "12" }, { label: "Top crewmate", value: "Hidden Legacy" }] }], team: [] };
    db.wrappedRecap.findUnique.mockResolvedValue({ version: WRAPPED_RECAP_VERSION, payload });
    const result = await getWrappedRecap("me", { now: AFTER });
    if (result?.status !== "ready") throw new Error("Expected a frozen recap");
    expect(result.recap.cards[0]?.items).toEqual([{ label: "Events", value: "12" }]);
    expect(JSON.stringify(result.recap)).not.toContain("Hidden");
    expect(db.wrappedRecap.upsert).not.toHaveBeenCalled();
  });

  it("stays locked before Dec 1 without touching any data", async () => {
    await expect(getWrappedRecap("me", { now: BEFORE })).resolves.toEqual({
      status: "locked",
      unlockAt: "2026-12-01T06:00:00.000Z",
    });
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it("lets a preview build live numbers before unlock without freezing them", async () => {
    const result = await getWrappedRecap("me", { now: BEFORE, preview: true });
    expect(result).toMatchObject({ status: "ready", preview: true, frozen: false });
    expect(db.wrappedRecap.upsert).not.toHaveBeenCalled();
  });

  it("freezes the recap on the first open after unlock", async () => {
    const result = await getWrappedRecap("me", { now: AFTER });
    expect(result).toMatchObject({ status: "ready", frozen: true });
    expect(db.wrappedRecap.upsert).toHaveBeenCalledOnce();
  });

  it("reads a frozen recap back instead of rebuilding it", async () => {
    const payload = { person: { userId: "me" }, cards: [], team: [] };
    db.wrappedRecap.findUnique.mockResolvedValue({ version: WRAPPED_RECAP_VERSION, payload });
    const result = await getWrappedRecap("me", { now: AFTER });
    expect(result).toEqual({ status: "ready", preview: false, frozen: true, recap: payload });
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it("never freezes someone else's recap when an admin looks at it", async () => {
    await getWrappedRecap("me", { now: AFTER, preview: true, readOnly: true });
    expect(db.wrappedRecap.upsert).not.toHaveBeenCalled();
  });

  it("opens a new student on a welcome cover before the team's cards", async () => {
    db.gameSnapshot.findMany.mockResolvedValue([{
      eventId: "e1",
      title: "Football vs Rival",
      startsAt: new Date("2026-09-05T18:00:00Z"),
      sportCode: "FB",
      opponent: "Rival",
      site: "HOME",
      venue: "Camp Randall Stadium",
      result: "WIN",
      official: true,
      crew: [crewMember("jo")],
    }]);
    const result = await getWrappedRecap("me", { now: AFTER });
    expect(result?.status === "ready" && result.recap.cards.map((card) => card.id)).toEqual(["welcome"]);
    expect(result?.status === "ready" && result.recap.team.length).toBeGreaterThan(0);
  });

  it("gives collaborators the team recap only", async () => {
    db.user.findUnique.mockResolvedValue({ id: "me", name: "Pat", avatarUrl: null, primaryArea: null, role: "COLLABORATOR" });
    const result = await getWrappedRecap("me", { now: AFTER });
    expect(result?.status === "ready" && result.recap.cards).toEqual([]);
    expect(result?.status === "ready" && result.recap.team.length).toBeGreaterThan(0);
  });
});
