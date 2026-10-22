import { describe, expect, it } from "vitest";
import type { GridEvent, GridShift } from "@/hooks/use-assignment-grid";
import { summarizeStudentWorkload } from "@/lib/assignment-workload";
import { source } from "./_helpers/source";

function shift(workerType: "ST" | "FT", userName: string | null, hours = 3): GridShift {
  const startsAt = "2026-10-24T16:00:00.000Z";
  const endsAt = new Date(new Date(startsAt).getTime() + hours * 3_600_000).toISOString();
  return {
    id: `s-${Math.random()}`,
    area: "VIDEO",
    workerType,
    startsAt,
    endsAt,
    assignments: userName
      ? [{ id: `a-${Math.random()}`, status: "DIRECT_ASSIGNED", hasConflict: false, conflictNote: null, user: { id: userName, name: userName, primaryArea: "VIDEO" } }]
      : [],
  };
}

function event(shifts: GridShift[], allDay = false): GridEvent {
  return { id: `e-${Math.random()}`, allDay, shifts, shiftGroupId: "g" } as unknown as GridEvent;
}

describe("student workload summary", () => {
  it("counts Student slots only, busiest first, with hours", () => {
    const summary = summarizeStudentWorkload([
      event([shift("ST", "Maya"), shift("ST", "Jonah", 2), shift("FT", "Erik"), shift("ST", null)]),
      event([shift("ST", "Maya", 4)]),
    ], null);
    expect(summary.working.map((p) => [p.name, p.shifts, p.hours])).toEqual([["Maya", 2, 7], ["Jonah", 1, 2]]);
    expect(summary.idle).toEqual([]);
  });

  it("lists rostered students with no shifts and flags a heavy month against the pool average", () => {
    const busy = Array.from({ length: 5 }, () => shift("ST", "Maya"));
    const summary = summarizeStudentWorkload([event([...busy, shift("ST", "Jonah")])], [
      { id: "Maya", name: "Maya" },
      { id: "Jonah", name: "Jonah" },
      { id: "Theo", name: "Theo" },
      { id: "Ana", name: "Ana" },
    ]);
    expect(summary.idle.map((p) => p.name)).toEqual(["Ana", "Theo"]);
    expect(summary.average).toBe(1.5);
    expect(summary.working.find((p) => p.name === "Maya")?.heavy).toBe(true);
    expect(summary.working.find((p) => p.name === "Jonah")?.heavy).toBe(false);
  });

  it("gives all-day events no hours", () => {
    const summary = summarizeStudentWorkload([event([shift("ST", "Maya")], true)], null);
    expect(summary.working[0]).toMatchObject({ shifts: 1, hours: 0 });
  });

  it("puts the panel on Assign shifts and lets it focus one person's cells", () => {
    const page = source("src/app/(app)/schedule/assign/_components/AssignPageClient.tsx");
    const cell = source("src/app/(app)/schedule/assign/_components/AssignmentCell.tsx");
    const panel = source("src/app/(app)/schedule/assign/_components/WorkloadPanel.tsx");
    expect(page).toContain("<WorkloadPanel");
    expect(page).toContain("focusUserId={focusUserId}");
    expect(cell).toContain('focusUserId && assignment.user.id !== focusUserId && "opacity-25"');
    expect(panel).toContain("/api/users?limit=200&active=true&role=STUDENT");
    expect(panel).toContain("No shifts yet");
  });
});
