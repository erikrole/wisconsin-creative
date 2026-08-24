import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentUser: { id: "viewer-1", role: "ADMIN" },
  target: { id: "target-1", active: true, hiddenFromRoster: false },
  findUnique: vi.fn(),
  canReadSharedScoreboard: vi.fn(),
  requirePermission: vi.fn(),
  normalizeSportCode: vi.fn(),
  parsePagination: vi.fn(),
  getScoreboardScope: vi.fn(),
  getScoreboardForUser: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  withAuth: (handler: (req: Request, ctx: { user: typeof mocks.currentUser; params: { id: string } }) => Promise<Response>) =>
    async (req: Request, context: { params: Promise<{ id: string }> }) => {
      try {
        return await handler(req, { user: mocks.currentUser, params: await context.params });
      } catch (error) {
        const status = (error as { status?: number }).status ?? 500;
        const message = error instanceof Error ? error.message : "Internal server error";
        return new Response(JSON.stringify({ error: message }), { status });
      }
    },
}));

vi.mock("@/lib/db", () => ({ db: { user: { findUnique: mocks.findUnique } } }));
vi.mock("@/lib/user-visibility", () => ({ canReadSharedScoreboard: mocks.canReadSharedScoreboard }));
vi.mock("@/lib/rbac", () => ({ requirePermission: mocks.requirePermission }));
vi.mock("@/lib/sports", () => ({ normalizeSportCode: mocks.normalizeSportCode }));
vi.mock("@/lib/http", () => ({
  HttpError: class HttpError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  ok: (data: unknown) => new Response(JSON.stringify(data), { status: 200 }),
  parsePagination: mocks.parsePagination,
}));
vi.mock("@/lib/services/scoreboard", () => ({
  getScoreboardScope: mocks.getScoreboardScope,
  getScoreboardForUser: mocks.getScoreboardForUser,
}));

import { GET } from "@/app/api/users/[id]/scoreboard/route";

const run = GET as unknown as (
  req: Request,
  context: { params: Promise<{ id: string }> },
) => Promise<Response>;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentUser.id = "viewer-1";
  mocks.currentUser.role = "ADMIN";
  mocks.target.active = true;
  mocks.target.hiddenFromRoster = false;
  mocks.findUnique.mockResolvedValue(mocks.target);
  mocks.canReadSharedScoreboard.mockReturnValue(true);
  mocks.normalizeSportCode.mockImplementation((value: string) => `normalized-${value}`);
  mocks.parsePagination.mockReturnValue({ limit: 25, offset: 4 });
  mocks.getScoreboardScope.mockReturnValue({ key: "2026-27" });
  mocks.getScoreboardForUser.mockResolvedValue({ summary: { wins: 1, losses: 0 } });
});

function request(query = "") {
  return new Request(`https://app.example.com/api/users/target-1/scoreboard${query}`);
}

const context = { params: Promise.resolve({ id: "target-1" }) };

describe("GET /api/users/[id]/scoreboard", () => {
  it("applies the season, filters, and bounded pagination to the read service", async () => {
    const response = await run(
      request("?season=2026-27&sportCode=SB&result=WIN&limit=25&offset=4"),
      context,
    );

    expect(response.status).toBe(200);
    expect(mocks.requirePermission).toHaveBeenCalledWith("ADMIN", "scoreboard", "view");
    expect(mocks.getScoreboardForUser).toHaveBeenCalledWith(
      "target-1",
      { sportCode: "normalized-SB", result: "WIN" },
      { limit: 25, offset: 4 },
    );
    await expect(response.json()).resolves.toEqual({ data: { summary: { wins: 1, losses: 0 } } });
  });

  it("accepts a tie filter from the shared route", async () => {
    const response = await run(request("?result=TIE"), context);

    expect(response.status).toBe(200);
    expect(mocks.getScoreboardForUser).toHaveBeenCalledWith(
      "target-1",
      { sportCode: undefined, result: "TIE" },
      { limit: 25, offset: 4 },
    );
  });

  it("lets the server choose the current scope when season is omitted", async () => {
    const response = await run(request("?limit=25&offset=4"), context);

    expect(response.status).toBe(200);
    expect(mocks.getScoreboardScope).toHaveBeenCalledWith(undefined);
    expect(mocks.getScoreboardForUser).toHaveBeenCalledWith(
      "target-1",
      { sportCode: undefined, result: undefined },
      { limit: 25, offset: 4 },
    );
  });

  it("keeps the unsupported-season gate server-side", async () => {
    mocks.getScoreboardScope.mockReturnValueOnce(null);
    const badSeason = await run(request("?season=2099-00"), context);

    expect(badSeason.status).toBe(400);
    expect(mocks.getScoreboardForUser).not.toHaveBeenCalled();
  });

  it.each([
    { viewerRole: "ADMIN", self: false },
    { viewerRole: "STAFF", self: false },
    { viewerRole: "STUDENT", self: true },
    { viewerRole: "STUDENT", self: false },
    { viewerRole: "COLLABORATOR", self: true },
    { viewerRole: "COLLABORATOR", self: false },
  ])(
    "shares active visible Scoreboards with $viewerRole (self: $self)",
    async ({ viewerRole, self }) => {
      mocks.currentUser.role = viewerRole;
      mocks.currentUser.id = self ? "target-1" : "viewer-1";

      const response = await run(request(), context);

      expect(response.status).toBe(200);
      expect(mocks.getScoreboardForUser).toHaveBeenCalledTimes(1);
    },
  );

  it("hides a target outside the shared Scoreboard subject boundary", async () => {
    mocks.canReadSharedScoreboard.mockReturnValueOnce(false);

    const response = await run(request(), context);

    expect(response.status).toBe(404);
    expect(mocks.getScoreboardForUser).not.toHaveBeenCalled();
  });
});
