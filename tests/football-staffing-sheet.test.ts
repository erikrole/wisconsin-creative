import { describe, expect, it } from "vitest";
import {
  FOOTBALL_STAFFING_SHEET_SOURCE,
  footballStaffingSheetPreviewRequestSchema,
  normalizeFootballStaffingRoleLabel,
  parseFootballStaffingSheet,
  resolveFootballSheetEvents,
  resolveFootballSheetPeople,
  type FootballSheetEventCandidate,
} from "@/lib/football-staffing-sheet";

const roleRows = [
  "Role",
  "SLOW1",
  "SLOW2",
  "BENCH",
  "ROAM1 (Action)",
  "ROAM2 (Color)",
  "ROAM3",
  "ROAM4",
  "PHOTO1",
  "PHOTO2",
  "PHOTO3",
  "PHOTO4",
  "SOCIAL",
];

const headers = [
  "8/30 Miami",
  "9/6 at Oregon",
  "9/13/2026 vs Alabama",
  "9/20 Purdue",
  "9/27 Iowa",
  "10/4 at Michigan",
  "10/11 USC",
  "10/18 at UCLA",
  "10/25 Minnesota",
  "11/1 at Nebraska",
  "11/8 Penn State",
  "11/15 at Northwestern",
];

function source() {
  return {
    sheetId: FOOTBALL_STAFFING_SHEET_SOURCE.sheetId,
    tabName: FOOTBALL_STAFFING_SHEET_SOURCE.tabName,
    range: FOOTBALL_STAFFING_SHEET_SOURCE.range,
  };
}

function snapshot(overrides: Record<string, string> = {}) {
  const rows = [["", ...headers]];
  for (let index = 0; index < roleRows.length; index += 1) {
    const rowNumber = index + 2;
    const row = [roleRows[index]!, ...headers.map((_, headerIndex) => {
      const column = String.fromCharCode(66 + headerIndex);
      return overrides[`${column}${rowNumber}`] ?? "-";
    })];
    rows.push(row);
  }
  return rows.map((row) => row.join("\t")).join("\n");
}

function request(tsv = snapshot()) {
  return { sportCode: "FB" as const, source: source(), tsv };
}

describe("Football staffing-sheet parser", () => {
  it("requires the pinned Football source and exact dimensions", () => {
    expect(footballStaffingSheetPreviewRequestSchema.safeParse(request()).success).toBe(true);
    expect(footballStaffingSheetPreviewRequestSchema.safeParse({ ...request(), sportCode: "VB" }).success).toBe(false);
    expect(footballStaffingSheetPreviewRequestSchema.safeParse({
      ...request(),
      source: { ...source(), range: "A1:M15" },
    }).success).toBe(false);
    expect(() => parseFootballStaffingSheet(request(snapshot().split("\n").slice(0, 13).join("\n"))))
      .toThrow("Expected 14 rows");
  });

  it("normalizes only the exact first-release role labels", () => {
    expect(normalizeFootballStaffingRoleLabel("ROAM1 (Action)")).toBe("ROAM1");
    expect(normalizeFootballStaffingRoleLabel("ROAM2 (Color)")).toBe("ROAM2");
    expect(normalizeFootballStaffingRoleLabel("PHOTO4")).toBe("PHOTO4");
    expect(normalizeFootballStaffingRoleLabel("ROAM5")).toBeNull();
  });

  it("preserves A1 provenance and the unresolved literal Role row", () => {
    const parsed = parseFootballStaffingSheet(request(snapshot({ B3: "Alice Example" })));
    expect(parsed.source).toEqual(FOOTBALL_STAFFING_SHEET_SOURCE);
    expect(parsed.headers[0]?.source).toMatchObject({ a1: "B1", row: 1, column: 2, range: "A1:M14" });
    expect(parsed.rowIssues).toEqual([expect.objectContaining({
      kind: "UNRESOLVED_ROLE_ROW",
      raw: "Role",
      source: expect.objectContaining({ a1: "A2" }),
    })]);
    expect(parsed.cells.find((cell) => cell.source.a1 === "B3")).toMatchObject({
      role: "SLOW1",
      raw: "Alice Example",
      sourceKind: "DIRECT_ASSIGNMENT_CANDIDATE",
    });
  });

  it("keeps every special source state distinct without guessing", () => {
    const parsed = parseFootballStaffingSheet(request(snapshot({
      B3: "Student",
      B4: "-",
      B5: "",
      B6: "Alex / Sam",
      B7: "Role",
      B8: "Jerry on backup",
    })));
    const kinds = new Map(parsed.cells.map((cell) => [cell.source.a1, cell.sourceKind]));
    expect(kinds.get("B3")).toBe("STUDENT_OPPORTUNITY");
    expect(kinds.get("B4")).toBe("INTENTIONALLY_UNSTAFFED");
    expect(kinds.get("B5")).toBe("BLANK");
    expect(kinds.get("B6")).toBe("AMBIGUOUS_ALTERNATIVES");
    expect(kinds.get("B7")).toBe("UNRESOLVED_ROLE");
    expect(kinds.get("B8")).toBe("NOTE_OR_INSTRUCTION");
  });
});

describe("Football staffing-sheet exact identity resolution", () => {
  it("matches one exact normalized visible user and leaves duplicates or unknowns for review", () => {
    const parsed = parseFootballStaffingSheet(request(snapshot({
      B3: "  Alice   Example ",
      B4: "Chris Same",
      B5: "Unknown Person",
      B6: "Jerry on backup",
    })));
    const reviews = resolveFootballSheetPeople(parsed.cells, [
      { id: "alice", name: "Alice Example", email: "alice@example.com", role: "STAFF", staffingType: "FT" },
      { id: "chris-1", name: "Chris Same", email: "one@example.com", role: "STUDENT", staffingType: "ST" },
      { id: "chris-2", name: "Chris Same", email: "two@example.com", role: "STUDENT", staffingType: "ST" },
    ]);
    const byCell = new Map(reviews.map((review) => [review.source.a1, review]));
    expect(byCell.get("B3")).toMatchObject({ resolution: "DIRECT_ASSIGNMENT_MATCHED", blocking: false });
    expect(byCell.get("B4")).toMatchObject({ resolution: "DIRECT_ASSIGNMENT_AMBIGUOUS", blocking: true });
    expect(byCell.get("B5")).toMatchObject({ resolution: "DIRECT_ASSIGNMENT_UNKNOWN", blocking: true });
    expect(byCell.get("B6")).toMatchObject({ resolution: "NOTE_OR_INSTRUCTION", blocking: true });
  });

  it("never resolves slash-separated alternatives even when each name exists", () => {
    const parsed = parseFootballStaffingSheet(request(snapshot({ B3: "Alice Example / Chris Same" })));
    const [review] = resolveFootballSheetPeople(parsed.cells, [
      { id: "alice", name: "Alice Example", email: "alice@example.com", role: "STAFF", staffingType: "FT" },
      { id: "chris", name: "Chris Same", email: "chris@example.com", role: "STUDENT", staffingType: "ST" },
    ]);
    expect(review).toMatchObject({
      resolution: "AMBIGUOUS_ALTERNATIVES",
      alternatives: ["Alice Example", "Chris Same"],
      personCandidates: [],
      blocking: true,
    });
  });
});

describe("Football staffing-sheet event resolution", () => {
  function event(overrides: Partial<FootballSheetEventCandidate> = {}): FootballSheetEventCandidate {
    return {
      id: "event-1",
      summary: "FB vs Miami",
      startsAt: new Date("2026-08-30T17:00:00.000Z"),
      sportCode: "FB",
      opponent: "Miami",
      isHome: true,
      ...overrides,
    };
  }

  it("resolves a missing-year header only when one visible exact event exists", () => {
    const [header] = parseFootballStaffingSheet(request()).headers;
    expect(resolveFootballSheetEvents([header!], [event()])[0]).toMatchObject({ status: "MATCHED" });
    expect(resolveFootballSheetEvents([header!], [
      event(),
      event({ id: "event-2", startsAt: new Date("2027-08-30T17:00:00.000Z") }),
    ])[0]).toMatchObject({ status: "AMBIGUOUS" });
  });

  it("requires exact Football, opponent, local date, and home/away evidence", () => {
    const parsed = parseFootballStaffingSheet(request());
    const awayHeader = parsed.headers[1]!;
    expect(resolveFootballSheetEvents([awayHeader], [event({
      id: "oregon-away",
      summary: "FB at Oregon",
      startsAt: new Date("2026-09-06T19:00:00.000Z"),
      opponent: "Oregon",
      isHome: false,
    })])[0]).toMatchObject({ status: "MATCHED" });
    expect(resolveFootballSheetEvents([awayHeader], [event({
      id: "oregon-home",
      summary: "FB vs Oregon",
      startsAt: new Date("2026-09-06T19:00:00.000Z"),
      opponent: "Oregon",
      isHome: true,
    })])[0]).toMatchObject({ status: "NOT_FOUND" });
    expect(resolveFootballSheetEvents([awayHeader], [event({
      id: "volleyball",
      summary: "VB at Oregon",
      startsAt: new Date("2026-09-06T19:00:00.000Z"),
      sportCode: "VB",
      opponent: "Oregon",
      isHome: false,
    })])[0]).toMatchObject({ status: "NOT_FOUND" });
    expect(resolveFootballSheetEvents([awayHeader], [event({
      id: "unknown-site",
      summary: "FB Oregon",
      startsAt: new Date("2026-09-06T19:00:00.000Z"),
      opponent: "Oregon",
      isHome: null,
    })])[0]).toMatchObject({ status: "NOT_FOUND" });
  });

  it("uses an explicit source year and leaves malformed headers invalid", () => {
    const parsed = parseFootballStaffingSheet(request());
    const explicitYear = parsed.headers[2]!;
    expect(resolveFootballSheetEvents([explicitYear], [
      event({ id: "wrong-year", startsAt: new Date("2027-09-13T17:00:00.000Z"), opponent: "Alabama" }),
    ])[0]).toMatchObject({ status: "NOT_FOUND" });

    const malformed = parseFootballStaffingSheet(request(snapshot().replace("8/30 Miami", "Miami"))).headers[0]!;
    expect(resolveFootballSheetEvents([malformed], [event()])[0]).toMatchObject({ status: "INVALID_HEADER" });
  });
});
