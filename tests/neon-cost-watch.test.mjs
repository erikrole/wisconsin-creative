import { describe, expect, it } from "vitest";
import { awakeHoursByDay, evaluateProject } from "../scripts/lib/neon-cost-watch.mjs";
import { NeonPreviewApi } from "../scripts/lib/neon-preview-api.mjs";

const now = Date.parse("2026-10-12T12:00:00Z");
const op = (action, at, endpoint_id = "ep-a") => ({ action, status: "finished", endpoint_id, created_at: at });

describe("Neon preview expiry", () => {
  it("computes an ISO deletion date the given days out", () => {
    expect(NeonPreviewApi.expiry(14, Date.parse("2026-10-01T00:00:00Z"))).toBe("2026-10-15T00:00:00.000Z");
  });
  it("patches expires_at and allows null to keep a pinned branch", async () => {
    const calls = [];
    const api = new NeonPreviewApi("token", async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => ({}) }; });
    await api.setExpiry("proj", "br-1", null);
    expect(calls[0].url).toBe("https://console.neon.tech/api/v2/projects/proj/branches/br-1");
    expect(calls[0].init.method).toBe("PATCH");
    expect(JSON.parse(calls[0].init.body)).toEqual({ branch: { expires_at: null } });
  });
});

describe("Neon cost watch", () => {
  it("sums awake hours per day across a start and suspend", () => {
    const result = awakeHoursByDay([op("start_compute", "2026-10-10T20:00:00Z"), op("suspend_compute", "2026-10-11T02:00:00Z")], { now, days: 3 });
    expect(result["ep-a"]["2026-10-10"]).toBe(4);
    expect(result["ep-a"]["2026-10-11"]).toBe(2);
  });
  it("counts an always-active endpoint with no operations as awake all window", () => {
    const result = awakeHoursByDay([], { now, days: 2, activeEndpoints: ["ep-b"] });
    expect(Object.values(result["ep-b"])).toEqual([24, 24]);
  });
  it("flags too many branches and a compute that barely sleeps", () => {
    const branches = Array.from({ length: 12 }, () => ({ current_state: "ready" }));
    const findings = evaluateProject({ name: "P", branches, awakeByDay: { "ep-a": { d1: 20, d2: 22 }, "ep-b": { d1: 1, d2: 2 } } }, { maxBranches: 10, maxAwakeHoursPerDay: 14 });
    expect(findings).toHaveLength(2);
    expect(findings[0]).toContain("12 branches, 2 over");
    expect(findings[1]).toContain("ep-a");
  });
  it("is quiet when under both limits", () => {
    expect(evaluateProject({ name: "P", branches: [{ current_state: "ready" }], awakeByDay: { "ep-a": { d1: 3 } } }, { maxBranches: 10, maxAwakeHoursPerDay: 14 })).toEqual([]);
  });
});
