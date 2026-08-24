import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentUser: { id: "viewer-1", role: "ADMIN" },
  requirePermission: vi.fn(),
  getScoreboardScope: vi.fn(),
  getTeamScoreboard: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  withAuth: (handler: (req: Request, ctx: { user: typeof mocks.currentUser }) => Promise<Response>) =>
    async (req: Request) => {
      try {
        return await handler(req, { user: mocks.currentUser });
      } catch (error) {
        const status = (error as { status?: number; name?: string }).status
          ?? ((error as { name?: string }).name === "ZodError" ? 400 : 500);
        const message = error instanceof Error ? error.message : "Internal server error";
        return new Response(JSON.stringify({ error: message }), { status });
      }
    },
}));

vi.mock("@/lib/rbac", () => ({ requirePermission: mocks.requirePermission }));
vi.mock("@/lib/services/scoreboard", () => ({ getScoreboardScope: mocks.getScoreboardScope }));
vi.mock("@/lib/services/team-scoreboard", () => ({ getTeamScoreboard: mocks.getTeamScoreboard }));
vi.mock("@/lib/http", () => ({
  HttpError: class HttpError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  ok: (data: unknown) => new Response(JSON.stringify(data), { status: 200 }),
}));

import { GET } from "@/app/api/scoreboard/route";

const run = GET as unknown as (req: Request, context: { params: Promise<Record<string, never>> }) => Promise<Response>;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentUser.role = "ADMIN";
  mocks.getScoreboardScope.mockReturnValue({ key: "2026-27" });
  mocks.getTeamScoreboard.mockResolvedValue({ summary: { contributors: 4 } });
});

function request(query = "") {
  return new Request(`https://app.example.com/api/scoreboard${query}`);
}

describe("GET /api/scoreboard", () => {
  it.each(["ADMIN", "STAFF", "STUDENT", "COLLABORATOR"])(
    "shares the aggregate Scoreboard with %s",
    async (role) => {
      mocks.currentUser.role = role;

      const response = await run(request(), { params: Promise.resolve({}) });

      expect(response.status).toBe(200);
      expect(mocks.requirePermission).toHaveBeenCalledWith(role, "scoreboard", "view");
      expect(mocks.getTeamScoreboard).toHaveBeenCalledWith({
        filters: {
          sportCode: undefined,
          venue: undefined,
          opponent: undefined,
          site: undefined,
        },
      });
      await expect(response.json()).resolves.toEqual({ data: { summary: { contributors: 4 } } });
    },
  );

  it("normalizes and forwards stackable sport, venue, opponent, and site filters", async () => {
    const response = await run(request(
      "?sportCode=vb&venue=Madison%2C%20WI%2C%20UW%20Field%20House&opponent=No.%201%20Minnesota&site=HOME",
    ), { params: Promise.resolve({}) });

    expect(response.status).toBe(200);
    expect(mocks.getTeamScoreboard).toHaveBeenCalledWith({
      filters: {
        sportCode: "VB",
        venue: "UW Field House",
        opponent: "Minnesota",
        site: "HOME",
      },
    });
  });

  it.each([
    ["sport", "?sportCode=not-a-sport"],
    ["site", "?site=ROAD"],
  ])("rejects an invalid %s filter before the service runs", async (_label, query) => {
    const response = await run(request(query), { params: Promise.resolve({}) });

    expect(response.status).toBe(400);
    expect(mocks.getTeamScoreboard).not.toHaveBeenCalled();
  });

  it("keeps the current season scope server-owned", async () => {
    const response = await run(request("?season=2026-27"), { params: Promise.resolve({}) });

    expect(response.status).toBe(200);
    expect(mocks.getScoreboardScope).toHaveBeenCalledWith("2026-27");

    mocks.getScoreboardScope.mockReturnValueOnce(null);
    const badSeason = await run(request("?season=2099-00"), { params: Promise.resolve({}) });

    expect(badSeason.status).toBe(400);
    expect(mocks.getTeamScoreboard).toHaveBeenCalledTimes(1);
  });
});
