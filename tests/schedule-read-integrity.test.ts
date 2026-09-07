import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSchedule } from "@/hooks/use-schedule-data";

afterEach(() => vi.unstubAllGlobals());

describe("Schedule complete read integrity", () => {
  it("rejects an incomplete crew read instead of inventing an unconfigured crew", async () => {
    vi.stubGlobal("window", { location: { origin: "http://localhost" } });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.includes("shift-groups")
      ? new Response("Unavailable", { status: 503 })
      : Response.json({ data: [{ id: "event", startsAt: "2026-09-05T12:00:00Z", endsAt: "2026-09-05T14:00:00Z" }], total: 1 })));
    await expect(fetchSchedule("/api/calendar-events", "/api/shift-groups")).rejects.toThrow();
  });

  it("does not merge truncated crew pages into apparently complete event coverage", async () => {
    vi.stubGlobal("window", { location: { origin: "http://localhost" } });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.includes("shift-groups")
      ? Response.json({ data: Array.from({ length: 200 }, (_, i) => ({ id: `group-${new URL(url).searchParams.get("offset")}-${i}`, eventId: `e-${i}` })), total: 3001 })
      : Response.json({ data: [], total: 0 })));
    await expect(fetchSchedule("/api/calendar-events", "/api/shift-groups")).rejects.toThrow();
  });
});
