import { expect, it } from "vitest";
import { hiringView, hiringSort, inHiringView, sortHiringApplications } from "@/app/(app)/workforce/hiring/board-view";
import type { BoardApplication } from "@/app/(app)/workforce/hiring/types";
const applicant = (id: string, stage: BoardApplication["stage"], reviewed = false) => ({ id, name: id, stage, reviewed } as BoardApplication);
it("review queue excludes final decisions even when their review flag is blank", () => {
  const rows = [applicant("applied", "APPLIED"), applicant("round", "ROUND_1"), applicant("done", "APPLIED", true), applicant("pass", "PASSED"), applicant("withdrawn", "WITHDRAWN"), applicant("hire", "HIRE")];
  expect(rows.filter(row => inHiringView(row, "review")).map(row => row.id)).toEqual(["applied", "round"]);
  expect(rows.filter(row => inHiringView(row, "round1")).map(row => row.id)).toEqual(["round"]);
  expect(rows.filter(row => inHiringView(row, "all"))).toHaveLength(6);
});
it("sorts without mutating API order and keeps newest first within review groups", () => {
  const rows = [applicant("old", "APPLIED"), applicant("reviewed", "APPLIED", true), applicant("new", "APPLIED")];
  expect(sortHiringApplications(rows, "unreviewed").map(row => row.id)).toEqual(["new", "old", "reviewed"]);
  expect(sortHiringApplications(rows, "name").map(row => row.id)).toEqual(["new", "old", "reviewed"]);
  expect(sortHiringApplications(rows, "newest").map(row => row.id)).toEqual(["new", "reviewed", "old"]);
  expect(rows.map(row => row.id)).toEqual(["old", "reviewed", "new"]);
  expect(hiringView("unexpected")).toBe("active");
  expect(hiringSort(null)).toBe("newest");
});
