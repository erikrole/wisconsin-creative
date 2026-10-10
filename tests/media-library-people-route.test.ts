import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
vi.mock("@/lib/db", () => ({ db: { user: { findMany: (...args: unknown[]) => findMany(...args) } } }));

import { GET } from "@/app/api/integrations/media-library/people/route";

const original = process.env.MEDIA_LIBRARY_TOKEN;
const noParams = { params: Promise.resolve({}) };

function request(auth?: string) {
  return new Request("https://wisconsincreative.com/api/integrations/media-library/people", {
    headers: auth ? { authorization: auth } : {},
  });
}

beforeEach(() => {
  findMany.mockReset();
  findMany.mockResolvedValue([
    { id: "u1", name: "Ryan Dean", role: "STUDENT", title: null, avatarUrl: "https://x/ryan.jpg" },
  ]);
});

afterEach(() => {
  process.env.MEDIA_LIBRARY_TOKEN = original;
});

describe("GET /api/integrations/media-library/people", () => {
  it("is off (503) when no token is configured", async () => {
    delete process.env.MEDIA_LIBRARY_TOKEN;
    const res = await GET(request("Bearer anything"), noParams);
    expect(res.status).toBe(503);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("refuses a missing or wrong token", async () => {
    process.env.MEDIA_LIBRARY_TOKEN = "t-123";
    expect((await GET(request(), noParams)).status).toBe(401);
    expect((await GET(request("Bearer nope"), noParams)).status).toBe(401);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("returns visible active users with only credit fields", async () => {
    process.env.MEDIA_LIBRARY_TOKEN = "t-123";
    const res = await GET(request("Bearer t-123"), noParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([
      { id: "u1", name: "Ryan Dean", role: "STUDENT", title: null, avatarUrl: "https://x/ryan.jpg" },
    ]);
    const query = findMany.mock.calls[0]?.[0];
    expect(query.where).toMatchObject({ active: true, hiddenFromRoster: false });
    expect(Object.keys(query.select).sort()).toEqual(["avatarUrl", "id", "name", "role", "title"]);
  });
});
