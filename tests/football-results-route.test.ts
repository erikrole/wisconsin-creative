import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";

const mocks = vi.hoisted(() => ({ role: "ADMIN" as Role, refresh: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/api", () => ({
  withAuth: (handler: (request: Request, context: { user: { id: string; role: Role } }) => Promise<Response>) =>
    async (request: Request) => {
      try { return await handler(request, { user: { id: "operator", role: mocks.role } }); }
      catch (error) { return Response.json({ error: "Request failed" }, { status: (error as { status?: number }).status ?? 500 }); }
    },
}));
vi.mock("@/lib/services/football-results", () => ({ refreshFootballResults: mocks.refresh }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: mocks.limit }));
import { POST } from "@/app/api/scoreboard/results/refresh/route";
const run = POST as unknown as (request: Request) => Promise<Response>;
beforeEach(() => { vi.resetAllMocks(); mocks.refresh.mockResolvedValue({ ok: true, updated: 2 }); });
describe("manual football results refresh", () => {
  it.each(["ADMIN", "STAFF"] as Role[])("allows %s using the real calendar-sync permission", async (role) => {
    mocks.role = role;
    const response = await run(new Request("https://example.com/api/scoreboard/results/refresh", { method: "POST" }));
    expect(response.status).toBe(200);
    expect(mocks.refresh).toHaveBeenCalledWith({ id: "operator", role });
    expect(mocks.limit).toHaveBeenCalledWith("football-results:operator", { max: 2, windowMs: 60_000 });
  });
  it.each(["STUDENT", "COLLABORATOR"] as Role[])("denies %s before any external fetch or mutation", async (role) => {
    mocks.role = role;
    expect((await run(new Request("https://example.com/api/scoreboard/results/refresh", { method: "POST" }))).status).toBe(403);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
