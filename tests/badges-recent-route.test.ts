import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listEarnedBadgesSince: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  withAuth: (handler: (req: Request, ctx: { user: { id: string; role: string } }) => Promise<Response>) =>
    (req: Request) => handler(req, { user: { id: "user-1", role: "STUDENT" } }),
}));

vi.mock("@/lib/rbac", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/badges/queries", () => ({
  listEarnedBadgesSince: mocks.listEarnedBadgesSince,
}));

import { GET } from "@/app/api/badges/recent/route";

const run = GET as unknown as (req: Request) => Promise<Response>;

beforeEach(() => {
  vi.clearAllMocks();
  // Noon in Chicago: the overnight quiet window must not depend on when CI runs.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-12T17:00:00.000Z"));
  process.env.BADGES_ENABLED = "true";
  mocks.listEarnedBadgesSince.mockResolvedValue([]);
});

describe("recent badge awards", () => {
  it("establishes a cursor without replaying award history", async () => {
    const response = await run(new Request("http://test/api/badges/recent"));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data.awards).toEqual([]);
    expect(Date.parse(json.data.nextCursor)).not.toBeNaN();
    expect(mocks.listEarnedBadgesSince).not.toHaveBeenCalled();
  });

  it("returns only the authenticated user's awards after the cursor", async () => {
    mocks.listEarnedBadgesSince.mockResolvedValue([{ id: "award-1", name: "Scan Ready" }]);
    const after = "2020-08-10T12:00:00.000Z";
    const response = await run(new Request(`http://test/api/badges/recent?after=${encodeURIComponent(after)}`));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data.awards).toEqual([{ id: "award-1", name: "Scan Ready" }]);
    expect(mocks.listEarnedBadgesSince).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      after: new Date(after),
    }));
  });

  it("returns an empty disabled payload without querying badge tables", async () => {
    process.env.BADGES_ENABLED = "false";
    const response = await run(new Request("http://test/api/badges/recent?after=2026-08-10T12:00:00.000Z"));
    const json = await response.json();

    expect(json.disabled).toBe(true);
    expect(json.data.awards).toEqual([]);
    expect(mocks.listEarnedBadgesSince).not.toHaveBeenCalled();
  });

  it("answers an overnight poll with an empty page before auth or the database", async () => {
    vi.setSystemTime(new Date("2026-10-12T07:00:00.000Z")); // 2 AM in Chicago
    const after = "2026-10-12T05:00:00.000Z";
    const response = await run(new Request(`http://test/api/badges/recent?after=${encodeURIComponent(after)}`));
    const json = await response.json();

    expect(json.quiet).toBe(true);
    expect(json.data).toEqual({ awards: [], nextCursor: after });
    expect(mocks.listEarnedBadgesSince).not.toHaveBeenCalled();
  });

  it("still establishes a cursor overnight when the app has none", async () => {
    vi.setSystemTime(new Date("2026-10-12T07:00:00.000Z"));
    const response = await run(new Request("http://test/api/badges/recent"));
    const json = await response.json();

    expect(json.quiet).toBeUndefined();
    expect(Date.parse(json.data.nextCursor)).not.toBeNaN();
  });
});
