import { describe, expect, it } from "vitest";
import { readSeed } from "@/lib/server-seed";

const json = (body: unknown, status = 200) => Promise.resolve(Response.json(body, { status }) as never);

describe("readSeed", () => {
  it("returns the handler's JSON keyed by the browser URL", async () => {
    let seen = "";
    const seed = await readSeed(async (req) => {
      seen = new URL(req.url).pathname + new URL(req.url).search;
      return json({ data: [1] });
    }, "/api/users?limit=50");
    expect(seen).toBe("/api/users?limit=50");
    expect(seed).toMatchObject({ url: "/api/users?limit=50", json: { data: [1] } });
  });

  it("falls back to null on an error response or a thrown error, so the browser asks itself", async () => {
    expect(await readSeed(() => json({ error: "no" }, 403), "/api/x")).toBeNull();
    expect(await readSeed(() => Promise.reject(new Error("db down")), "/api/x")).toBeNull();
  });
});
