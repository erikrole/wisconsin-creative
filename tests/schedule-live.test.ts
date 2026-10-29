import { describe, expect, it } from "vitest";
import { isScheduleMutation } from "@/lib/schedule-live";

const ok = new Response(null, { status: 200 });
const req = (path: string, method = "POST") => new Request(`https://wisconsincreative.com${path}`, { method });

describe("schedule live signal", () => {
  it("bumps for successful schedule edits only", () => {
    expect(isScheduleMutation(req("/api/shift-assignments"), ok)).toBe(true);
    expect(isScheduleMutation(req("/api/shift-groups/g1/working-copy", "PUT"), ok)).toBe(true);
    expect(isScheduleMutation(req("/api/shift-trades/t1/accept"), ok)).toBe(true);
    expect(isScheduleMutation(req("/api/schedule/bulk-assignment/apply"), ok)).toBe(true);
    expect(isScheduleMutation(req("/api/shift-assignments", "GET"), ok)).toBe(false);
    expect(isScheduleMutation(req("/api/shift-assignments"), new Response(null, { status: 403 }))).toBe(false);
    expect(isScheduleMutation(req("/api/shifts-archive"), ok)).toBe(false);
    expect(isScheduleMutation(req("/api/bookings/1", "PATCH"), ok)).toBe(false);
  });
});
