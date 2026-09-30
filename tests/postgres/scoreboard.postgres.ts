import { afterAll, beforeAll, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const value = process.env.WC_CUSTODY_TEST_DATABASE_URL;
  if (!value) throw new Error("Run scripts/test-custody-postgres.mjs; no external database is accepted");
  const url = new URL(value);
  if (url.protocol !== "postgresql:" || url.hostname !== "localhost" || url.port !== "5432"
    || url.username !== "custody_test" || url.password || url.pathname !== "/custody_test"
    || [...url.searchParams.keys()].join() !== "host"
    || !/^\/(private\/)?tmp\/wc-custody-pg-[a-zA-Z0-9]+$/.test(url.searchParams.get("host") ?? "")) {
    throw new Error("Refusing a database outside the disposable custody-test cluster");
  }
  // Use Prisma's native PostgreSQL transport; no query/transaction is mocked.
  return { db: new PrismaClient({ datasources: { db: { url: `${value}&connection_limit=5` } } }) };
});
import { db } from "@/lib/db";
import { getScoreboardForUser } from "@/lib/services/scoreboard";
import { getGameRecordForUser } from "@/lib/services/game-record";
import { getTeamScoreboard } from "@/lib/services/team-scoreboard";
import type { Prisma } from "@prisma/client";

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-12-01T18:00:00Z"));
  await db.$executeRawUnsafe('TRUNCATE TABLE "users", "calendar_events" CASCADE');
  await db.user.createMany({ data: ["score-person", "score-hidden"].map(id => ({
    id, name: id, email: `${id}@example.test`, passwordHash: "unused", role: "STUDENT" as const,
    hiddenFromRoster: id === "score-hidden",
  })) });
  const cases: Array<{ id: string; fields?: Partial<Prisma.CalendarEventCreateInput> }> = [
    { id: "manual-official" },
    { id: "imported-official", fields: { rawSummary: "Wisconsin vs Iowa", result: "TIE" } },
    { id: "ceremony", fields: { summary: "Awards ceremony", result: null, sportCode: null } },
    { id: "manual-exhibition", fields: { summary: "Volleyball EXHIBITION" } },
    { id: "imported-scrimmage", fields: { rawSummary: "Football scrimmage" } },
    { id: "archived", fields: { archivedAt: new Date("2026-11-02T18:00:00Z") } },
    { id: "hidden", fields: { isHidden: true } },
    { id: "cancelled", fields: { status: "CANCELLED" } },
    { id: "future", fields: { startsAt: new Date("2026-12-15T18:00:00Z"), endsAt: new Date("2026-12-15T21:00:00Z") } },
    { id: "next-season", fields: { startsAt: new Date("2027-07-03T18:00:00Z"), endsAt: new Date("2027-07-03T21:00:00Z") } },
  ];
  for (const item of cases) {
    await db.calendarEvent.create({ data: {
      id: item.id, externalId: item.id, summary: "Wisconsin vs Iowa", rawSummary: null,
      startsAt: new Date("2026-11-01T18:00:00Z"), endsAt: new Date("2026-11-01T21:00:00Z"),
      result: "WIN", sportCode: "FB", opponent: " Iowa ", rawLocationText: "Camp Randall Stadium", site: "HOME",
      ...item.fields,
      workers: { create: [{ userId: "score-person", note: "Private note must never leave service" }, { userId: "score-hidden" }] },
    } });
  }
});
afterAll(async () => { vi.useRealTimers(); await db.$disconnect(); });

it("includes nullable-title official games while keeping completed unofficial work out of W/L/T", async () => {
  const result = await getScoreboardForUser("score-person");
  expect(result.summary).toMatchObject({ eventsWorked: 6, wins: 1, losses: 0, ties: 1, games: 2, winRate: 75 });
  expect(result.events.filter(row => row.result !== null).map(row => row.id).sort())
    .toEqual(["imported-official", "manual-official"]);
  expect(result.events.find(row => row.id === "manual-exhibition")?.result).toBeNull();
  expect(result.events.map(row => row.id)).not.toContain("future");
  expect(JSON.stringify(result)).not.toContain("Private note");
  expect(JSON.stringify(result)).not.toContain("score-hidden");
  expect(await getGameRecordForUser("score-person")).toMatchObject({ eventsWorked: 6, wins: 1, losses: 0, ties: 1 });
});

it("applies canonical dimensions before offset paging and retains complete season choices", async () => {
  const filtered = await getScoreboardForUser("score-person", { sportCode: "FB", venue: "Camp Randall Stadium", opponent: "Iowa", site: "HOME" }, { limit: 2, offset: 0 });
  expect(filtered.eventCount).toBe(5);
  expect(filtered.events).toHaveLength(2);
  expect(filtered.nextCursor).toBe("2");
  const page = await getScoreboardForUser("score-person", { sportCode: "FB", venue: "Camp Randall Stadium", opponent: "Iowa", site: "HOME" }, { limit: 2, offset: 2 });
  expect(new Set([...filtered.events, ...page.events].map(row => row.id)).size).toBe(4);
  expect(filtered.recentResults).toHaveLength(2);
  const empty = await getScoreboardForUser("score-person", { opponent: "Missing" });
  expect(empty.events).toEqual([]);
  expect(empty.summary.eventsWorked).toBe(6);
  expect(empty.facets?.opponents).toEqual([{ key: "Iowa", label: "Iowa" }]);
});

it("keeps team totals aligned with profile and personal records while excluding hidden identities", async () => {
  const team = await getTeamScoreboard({ filters: { opponent: "Iowa" } });
  expect(team.summary).toMatchObject({ contributors: 1, eventsCovered: 6, eventCredits: 6, wins: 1, ties: 1, games: 2, winRate: 75 });
  expect(team.leaderboard.map(row => row.userId)).toEqual(["score-person"]);
  expect(team.facets.opponents).toEqual([{ key: "Iowa", label: "Iowa" }]);
});
