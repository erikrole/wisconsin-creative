import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseCsv } from "@/lib/hiring/csv";
import { mapArea, mapStage, parseApplicantCsv, planImport } from "@/lib/hiring/import";
import { parseRosterCsv, planRosterImport } from "@/lib/workforce/roster-import";

// All data below is fictional.
const PAGEUP = [
  "Reviewed,Interview,Applicant,Decision / Stage,Year,Graduation,Primary Area,Email,Resume File,Verified Areas,Location,Application ID,Portfolio Link",
  'TRUE,FALSE,Alex Sample,,Senior,Spring 2027,Comms,alex@example.edu,Resume,"Comms; Marketing",Testville,900001,',
  'TRUE,TRUE,Jordan Fictional,Round 1,Freshman,Spring 2030,"Video, Photography",jordan@example.com,Resume,Video,Sampleton,900002,https://example.com/p',
  "FALSE,FALSE,Casey Marketing,,Junior,Spring 2028,Marketing,casey@example.edu,Resume,,Exampleburg,900003,not a link",
  "FALSE,FALSE,,,Junior,Spring 2028,Video,nobody@example.edu,,,,900004,",
  "FALSE,FALSE,Bad Email,,Junior,Spring 2028,Video,not-an-email,,,,900005,",
].join("\n");

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, embedded newlines, CRLF, and a BOM", () => {
    const rows = parseCsv('﻿a,b\r\n"x, y","say ""hi""\nnext"\r\n');
    expect(rows).toEqual([["a", "b"], ["x, y", 'say "hi"\nnext']]);
  });

  it("drops blank lines", () => {
    expect(parseCsv("a,b\n\n,\n1,2\n")).toEqual([["a", "b"], ["1", "2"]]);
  });
});

describe("parseApplicantCsv (PageUp shape)", () => {
  const { records, invalid, unmappedHeaders } = parseApplicantCsv(PAGEUP);

  it("maps rows and reports invalid ones with their line numbers", () => {
    expect(records.map((r) => r.name)).toEqual(["Alex Sample", "Jordan Fictional", "Casey Marketing"]);
    expect(invalid).toEqual([
      { line: 5, name: "", reason: "Missing name" },
      { line: 6, name: "Bad Email", reason: "Missing or invalid email" },
    ]);
    expect(unmappedHeaders).toEqual(["Resume File"]);
  });

  it("parses standing, graduation, stage, interview state, and PageUp ID", () => {
    const jordan = records[1]!;
    expect(jordan).toMatchObject({
      standing: "FRESHMAN",
      gradTerm: "SPRING",
      gradYear: 2030,
      stage: "ROUND_1",
      interviewed: true,
      reviewed: true,
      externalApplicationId: "900002",
      portfolioUrl: "https://example.com/p",
      primaryArea: "VIDEO",
      rawAreas: ["Video", "Photography"],
    });
  });

  it("keeps Marketing as a label only and warns", () => {
    const casey = records[2]!;
    expect(casey.primaryArea).toBeNull();
    expect(casey.rawAreas).toEqual(["Marketing"]);
    expect(casey.warnings.join(" ")).toContain("label only");
    expect(casey.portfolioUrl).toBeNull();
    expect(casey.warnings.join(" ")).toContain("Portfolio");
  });

  it("preserves the original row and normalizes the email", () => {
    expect(records[0]!.email).toBe("alex@example.edu");
    expect(records[0]!.source["Applicant"]).toBe("Alex Sample");
  });
});

describe("unrecognized decisions", () => {
  it("rejects the row instead of silently putting a decided applicant back in the pipeline", () => {
    const csv = ["Name,Email,Decision", "Pat Placeholder,pat@example.edu,Passsed", "Sam Sample,sam@example.edu,Hire"].join("\n");
    const { records, invalid } = parseApplicantCsv(csv);
    expect(records.map((r) => r.name)).toEqual(["Sam Sample"]);
    expect(invalid).toEqual([{ line: 2, name: "Pat Placeholder", reason: expect.stringContaining('Unrecognized decision "Passsed"') }]);
  });
});

describe("slash-delimited lists", () => {
  it("splits areas and experience on slashes as well as commas and semicolons", () => {
    const csv = ["Name,Email,Primary Area,Fields you have experience in", 'Pat Placeholder,pat@example.edu,Video / Photography,"Design / Social Strategy, Marketing"'].join("\n");
    const [record] = parseApplicantCsv(csv).records;
    expect(record!.rawAreas).toEqual(["Video", "Photography"]);
    expect(record!.primaryArea).toBe("VIDEO");
    expect(record!.fieldsExperience).toEqual(["Design", "Social Strategy", "Marketing"]);
  });
});

describe("Google Form shape", () => {
  it("maps form columns and phone numbers with directional marks", () => {
    const csv = [
      "Timestamp,Full Name,Email (wisc.edu),Phone Number,Graduation Year,Fields you have experience in,Are you available to work this summer?,Link to your portfolio and/or website (if applicable)",
      '2/19/2026 15:47:21,Pat Placeholder,pat@example.edu,"‭(555) 010-0101‬",Spring 2027,"Graphic Design, Social Strategy",Yes,https://example.com/pat',
    ].join("\n");
    const { records } = parseApplicantCsv(csv);
    expect(records[0]).toMatchObject({
      phone: "5550100101",
      summerAvailable: true,
      fieldsExperience: ["Graphic Design", "Social Strategy"],
      portfolioUrl: "https://example.com/pat",
      stage: "APPLIED",
    });
  });
});

describe("stage and area mapping", () => {
  it("maps decisions, with blank handling", () => {
    expect(mapStage("Hire", false, false)).toBe("HIRE");
    expect(mapStage("Round 1", false, false)).toBe("ROUND_1");
    expect(mapStage("", false, true)).toBe("ROUND_1");
    // In a finished cycle a blank decision means passed over, even for someone who interviewed.
    expect(mapStage("", true, true)).toBe("PASSED");
    expect(mapStage("", false, false)).toBe("APPLIED");
    expect(mapStage("", true, false)).toBe("PASSED");
  });

  it("returns null for decision text it does not recognize, instead of defaulting to Applied", () => {
    expect(mapStage("Passsed", false, false)).toBeNull();
    expect(mapStage("Interview 2", true, true)).toBeNull();
    expect(mapStage("Applied", false, false)).toBe("APPLIED");
  });

  it("maps design to graphics and leaves marketing unmapped", () => {
    expect(mapArea("Design")).toBe("GRAPHICS");
    expect(mapArea("Photography")).toBe("PHOTO");
    expect(mapArea("Marketing")).toBeNull();
  });
});

describe("planImport", () => {
  const { records } = parseApplicantCsv(PAGEUP);
  const none = { applicantIds: new Set<string>(), externalIds: new Set<string>() };

  it("creates new people when nothing matches", () => {
    expect(planImport(records, [], none).map((p) => p.action)).toEqual(["create", "create", "create"]);
  });

  it("attaches to a known person by email and skips when already in the cycle", () => {
    const existing = [{ id: "p1", name: "Alex Sample", gradTerm: "SPRING" as const, gradYear: 2027, emails: ["alex@example.edu"] }];
    expect(planImport(records, existing, none)[0]).toMatchObject({ action: "attach", applicantId: "p1" });
    expect(planImport(records, existing, { applicantIds: new Set(["p1"]), externalIds: new Set() })[0]).toMatchObject({ action: "skip_existing" });
  });

  it("flags a same-name same-graduation person with a new email for review, never merging", () => {
    const existing = [{ id: "p2", name: "Alex Sample", gradTerm: "SPRING" as const, gradYear: 2027, emails: ["alex.old@example.com"] }];
    expect(planImport(records, existing, none)[0]).toMatchObject({ action: "needs_review", applicantId: "p2" });
  });

  it("skips rows whose PageUp ID was already imported", () => {
    const plan = planImport(records, [], { applicantIds: new Set(), externalIds: new Set(["900002"]) });
    expect(plan[1]).toMatchObject({ action: "skip_existing" });
  });

  it("reports a second row for the same applicant matched through a different known email", () => {
    const existing = [{ id: "p1", name: "Alex Sample", gradTerm: "SPRING" as const, gradYear: 2027, emails: ["alex@example.edu", "alex.old@example.com"] }];
    const csv = ["Name,Email", "Alex Sample,alex@example.edu", "Alex Sample,alex.old@example.com"].join("\n");
    const plan = planImport(parseApplicantCsv(csv).records, existing, none);
    expect(plan.map((p) => p.action)).toEqual(["attach", "duplicate_in_file"]);
    expect(plan[1]!.reason).toContain("different email");
  });

  it("reports repeated emails and likely same-person rows within one file", () => {
    const csv = [
      "Name,Email,Graduation",
      "Sam Dupe,sam@example.edu,Spring 2028",
      "Sam Dupe,sam@example.edu,Fall 2028",
      "Sam Dupe,sam.other@example.com,Spring 2028",
    ].join("\n");
    const plan = planImport(parseApplicantCsv(csv).records, [], none);
    expect(plan.map((p) => p.action)).toEqual(["create", "duplicate_in_file", "needs_review"]);
  });
});

const ROSTER = [
  "Area,Name,Year,Athletics Email,Campus Email,Phone,Start Date,Assignments,Fall,Winter,Spring,Notes",
  "Video,Riley Roster,Senior,,riley@example.edu,,Fall 2024,,MSOC,WHKY,SB,",
  "Area,Name,Year,Athletics Email,Campus Email,Phone,Start Date,Assignments,Fall,Winter,Spring,Notes",
  "Video,Morgan Missing,Junior,,nobody@example.edu,,June 29 2026,,WAT,,,",
  "Photo,Quinn Existing,Junior,quinn@athletics.example.edu,,,Spring 2026,,,,SB,",
].join("\n");

describe("roster import", () => {
  const csv = ROSTER;

  const users = [
    { id: "u1", name: "Riley Roster", email: "riley@example.edu", athleticsEmail: null, startTerm: null, staffingType: "ST" as const },
    { id: "u3", name: "Quinn Existing", email: "quinn@example.edu", athleticsEmail: "quinn@athletics.example.edu", startTerm: "FALL" as const, staffingType: "ST" as const },
  ];

  it("parses placements into the academic year, skipping repeated headers", () => {
    const { records, skipped } = parseRosterCsv(csv, 2025);
    expect(skipped).toBe(1);
    const riley = records.find((r) => r.name === "Riley Roster")!;
    expect(riley.startTerm).toEqual({ term: "FALL", year: 2024 });
    expect(riley.area).toBe("VIDEO");
    expect(riley.placements).toEqual([
      { term: "FALL", year: 2025, sportCodes: ["MSOC"] },
      { term: "WINTER", year: 2026, sportCodes: ["WHKY"] },
      { term: "SPRING", year: 2026, sportCodes: ["SB"] },
    ]);
  });

  it("warns on non-term start dates and unknown sports", () => {
    const morgan = parseRosterCsv(csv, 2025).records.find((r) => r.name === "Morgan Missing")!;
    expect(morgan.startTerm).toBeNull();
    expect(morgan.warnings.join(" ")).toContain("not a term");
    expect(morgan.warnings.join(" ")).toContain("unknown sport");
    expect(morgan.placements).toEqual([]);
  });

  it("skips full-time staff accounts", () => {
    const { records } = parseRosterCsv(csv, 2025);
    const staff = [{ id: "u9", name: "Riley Roster", email: "riley@example.edu", athleticsEmail: null, startTerm: null, staffingType: "FT" as const }];
    const [riley] = planRosterImport(records.filter((r) => r.name === "Riley Roster"), staff, new Set());
    expect(riley).toMatchObject({ action: "unmatched", setStartTerm: false, newPlacements: [] });
    expect(riley!.reason).toContain("Not a student");
  });

  it("plans a student repeated in a combined export once: first start term wins, no duplicate placements", () => {
    const csv = [
      "Area,Name,Campus Email,Start Date,Fall,Winter,Spring",
      "Video,Riley Roster,riley@example.edu,Fall 2024,MSOC,,",
      "Video,Riley Roster,riley@example.edu,Spring 2025,MSOC,WHKY,",
    ].join("\n");
    const { records } = parseRosterCsv(csv, 2025);
    const plan = planRosterImport(records, users, new Set());
    expect(plan[0]).toMatchObject({ action: "update", setStartTerm: true });
    expect(plan[0]!.newPlacements).toHaveLength(1);
    // The second row may only add what is not already planned (Winter), and never a second start term.
    expect(plan[1]!.setStartTerm).toBe(false);
    expect(plan[1]!.newPlacements.map((p) => p.term)).toEqual(["WINTER"]);
    expect(plan[1]!.reason).toContain("earlier in the file");
    const keys = plan.flatMap((p) => p.newPlacements.map((x) => `${p.userId}:${x.term}:${x.year}`));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("matches only by email and never overwrites existing values", () => {
    const { records } = parseRosterCsv(csv, 2025);
    const plan = planRosterImport(records, users, new Set(["u3:SPRING:2026"]));
    const byName = Object.fromEntries(plan.map((p) => [p.record.name, p]));
    expect(byName["Riley Roster"]).toMatchObject({ action: "update", userId: "u1", setStartTerm: true });
    expect(byName["Riley Roster"]!.newPlacements).toHaveLength(3);
    expect(byName["Morgan Missing"]).toMatchObject({ action: "unmatched" });
    // Matched by athletics email; start term already set, placement already exists.
    expect(byName["Quinn Existing"]).toMatchObject({ action: "no_change", userId: "u3", setStartTerm: false });
  });
});

// ─── Route behavior ────────────────────────────────────────────────────────
vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/audit", () => ({ createAuditEntry: vi.fn(), createAuditEntryTx: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: vi.fn(), SETTINGS_MUTATION_LIMIT: { limit: 100, windowMs: 60_000 } }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

const tx = {
  applicant: { createMany: vi.fn() },
  applicantEmail: { createMany: vi.fn() },
  application: { createMany: vi.fn() },
  applicationNote: { createMany: vi.fn() },
  user: { updateMany: vi.fn() },
  studentTermPlacement: { createMany: vi.fn() },
};
const models = {
  hiringCycle: { findUnique: vi.fn() },
  applicant: { findMany: vi.fn() },
  application: { findMany: vi.fn() },
  user: { findMany: vi.fn() },
  studentTermPlacement: { findMany: vi.fn() },
  $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
};
vi.mock("@/lib/db", () => ({ get db() { return models; } }));

import { requireAuth } from "@/lib/auth";
import { createAuditEntry, createAuditEntryTx } from "@/lib/audit";
import { POST as importApplicants } from "@/app/api/hiring/import/route";
import { POST as importRoster } from "@/app/api/workforce/import/route";

const admin = { id: "admin-1", email: "a@example.test", name: "Admin", role: "ADMIN" as const, avatarUrl: null, forcePasswordChange: false };
const post = (url: string, body: unknown) =>
  new Request(`https://app.example.com${url}`, {
    method: "POST",
    headers: { host: "app.example.com", origin: "https://app.example.com", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const ctx = { params: Promise.resolve({}) };
const CYCLE = "clh0000000000000000000001";

describe("import routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue(admin as never);
    models.hiringCycle.findUnique.mockResolvedValue({ id: CYCLE, label: "Fall 2026" });
    models.applicant.findMany.mockResolvedValue([]);
    models.application.findMany.mockResolvedValue([]);
    models.user.findMany.mockResolvedValue([]);
    models.studentTermPlacement.findMany.mockResolvedValue([]);
  });

  it.each(["STAFF", "STUDENT", "COLLABORATOR"] as const)("%s gets 403 on both imports", async (role) => {
    vi.mocked(requireAuth).mockResolvedValue({ ...admin, role } as never);
    expect((await importApplicants(post("/api/hiring/import", { cycleId: CYCLE, csv: PAGEUP }), ctx)).status).toBe(403);
    expect((await importRoster(post("/api/workforce/import", { academicYearStart: 2025, csv: "Name,Email\nA,a@example.edu" }), ctx)).status).toBe(403);
    expect(models.$transaction).not.toHaveBeenCalled();
  });

  it("dry-run writes nothing and returns a report without emails", async () => {
    const res = await importApplicants(post("/api/hiring/import", { cycleId: CYCLE, csv: PAGEUP }), ctx);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.applied).toBe(false);
    expect(data.counts).toMatchObject({ create: 3, invalid: 2 });
    expect(models.$transaction).not.toHaveBeenCalled();
    expect(JSON.stringify(data)).not.toContain("alex@example.edu");
    expect(createAuditEntry).not.toHaveBeenCalled();
  });

  it("apply creates people and applications, and audits counts only", async () => {
    const res = await importApplicants(post("/api/hiring/import", { cycleId: CYCLE, csv: PAGEUP, apply: true }), ctx);
    expect(res.status).toBe(200);
    // Batched: one insert per table, not one round trip per row.
    expect(tx.applicant.createMany).toHaveBeenCalledTimes(1);
    expect(tx.applicantEmail.createMany).toHaveBeenCalledTimes(1);
    expect(tx.application.createMany).toHaveBeenCalledTimes(1);
    const people = tx.applicant.createMany.mock.calls[0]![0].data;
    expect(people).toHaveLength(3);
    expect(people[0].nameKey).toBe("alex sample");
    const apps = tx.application.createMany.mock.calls[0]![0].data;
    expect(apps).toHaveLength(3);
    expect(apps[0].cycleId).toBe(CYCLE);
    expect(apps[0].applicantId).toBe(people[0].id);
    expect(apps[0].sourcePayload).toMatchObject({ Applicant: "Alex Sample" });
    expect(tx.applicantEmail.createMany.mock.calls[0]![0].data[0]).toMatchObject({ applicantId: people[0].id, isPrimary: true });
    // Written inside the same transaction as the inserts, counts only.
    expect(createAuditEntry).not.toHaveBeenCalled();
    const audit = JSON.stringify(vi.mocked(createAuditEntryTx).mock.calls[0]![1]);
    expect(audit).toContain("import");
    expect(audit).not.toContain("example.edu");
  });

  it("apply skips rows that need review", async () => {
    models.applicant.findMany.mockResolvedValue([
      { id: "p2", name: "Alex Sample", gradTerm: "SPRING", gradYear: 2027, emails: [{ email: "alex.old@example.com" }] },
    ]);
    await importApplicants(post("/api/hiring/import", { cycleId: CYCLE, csv: PAGEUP, apply: true }), ctx);
    expect(tx.applicant.createMany.mock.calls[0]![0].data).toHaveLength(2);
  });

  it("finds possible duplicates by normalized name key, so accents and punctuation do not hide them", async () => {
    await importApplicants(post("/api/hiring/import", { cycleId: CYCLE, csv: "Name,Email\nRen\u00e9e O'Brien,renee@example.edu\n" }), ctx);
    const where = models.applicant.findMany.mock.calls[0]![0].where;
    expect(JSON.stringify(where)).toContain('"nameKey":{"in":["renee o brien"]}');
  });

  it("rejects 'a blank decision means passed over' for an open or planned cycle", async () => {
    for (const status of ["OPEN", "PLANNING"]) {
      models.hiringCycle.findUnique.mockResolvedValue({ id: CYCLE, label: "Fall 2026", status });
      const res = await importApplicants(post("/api/hiring/import", { cycleId: CYCLE, csv: PAGEUP, blankDecisionMeansPassed: true, apply: true }), ctx);
      expect(res.status).toBe(400);
    }
    expect(models.$transaction).not.toHaveBeenCalled();
  });

  it("allows the option for a closed or archived cycle, and previews the stages applicants will take", async () => {
    models.hiringCycle.findUnique.mockResolvedValue({ id: CYCLE, label: "Spring 2026", status: "CLOSED" });
    const res = await importApplicants(post("/api/hiring/import", { cycleId: CYCLE, csv: PAGEUP, blankDecisionMeansPassed: true }), ctx);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    // Blank decisions become Passed; the explicit "Round 1" row stays Round 1.
    expect(data.stages).toEqual({ PASSED: 2, ROUND_1: 1 });
  });

  it("flags rows whose email already belongs to an account so the preview can show them", async () => {
    models.user.findMany.mockResolvedValue([{ email: "alex@example.edu" }]);
    const res = await importApplicants(post("/api/hiring/import", { cycleId: CYCLE, csv: PAGEUP }), ctx);
    const { data } = await res.json();
    expect(data.rows.find((r: { name: string }) => r.name === "Alex Sample").hasAccount).toBe(true);
    expect(data.rows.find((r: { name: string }) => r.name === "Jordan Fictional").hasAccount).toBe(false);
  });

  it("rejects an empty file", async () => {
    const res = await importApplicants(post("/api/hiring/import", { cycleId: CYCLE, csv: "Name,Email\n" }), ctx);
    expect(res.status).toBe(400);
  });

  it("roster apply sets a start term and placements without overwriting", async () => {
    models.user.findMany.mockResolvedValue([{ id: "u1", name: "Riley Roster", email: "riley@example.edu", athleticsEmail: null, startTerm: null, staffingType: "ST" }]);
    const res = await importRoster(post("/api/workforce/import", { academicYearStart: 2025, csv: ROSTER, apply: true }), ctx);
    expect(res.status).toBe(200);
    // One guarded updateMany per distinct start term (never overwrites an existing one).
    expect(tx.user.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["u1"] }, startTerm: null }, data: { startTerm: "FALL", startTermYear: 2024 } });
    // Counts-only audit, in the same transaction.
    expect(vi.mocked(createAuditEntryTx).mock.calls[0]![1]).toMatchObject({ entityType: "workforce_import", action: "import" });
    // One batched insert for every placement.
    expect(tx.studentTermPlacement.createMany).toHaveBeenCalledTimes(1);
    expect(tx.studentTermPlacement.createMany.mock.calls[0]![0].data).toHaveLength(3);
  });

  it("writes a 500-row roster in a handful of statements, not one per person and term", async () => {
    const header = "Area,Name,Campus Email,Start Date,Fall,Winter,Spring";
    const rows = Array.from({ length: 500 }, (_, i) => `Video,Person ${i},p${i}@example.edu,Fall 2024,MSOC,WHKY,SB`);
    models.user.findMany.mockResolvedValue(
      Array.from({ length: 500 }, (_, i) => ({ id: `u${i}`, name: `Person ${i}`, email: `p${i}@example.edu`, athleticsEmail: null, startTerm: null, staffingType: "ST" })),
    );
    const res = await importRoster(post("/api/workforce/import", { academicYearStart: 2025, csv: [header, ...rows].join("\n"), apply: true }), ctx);
    expect(res.status).toBe(200);
    expect(tx.user.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.user.updateMany.mock.calls[0]![0].where.id.in).toHaveLength(500);
    expect(tx.studentTermPlacement.createMany.mock.calls[0]![0].data).toHaveLength(1500);
  });

  it("roster import skips full-time accounts", async () => {
    models.user.findMany.mockResolvedValue([{ id: "u1", name: "Riley Roster", email: "riley@example.edu", athleticsEmail: null, startTerm: null, staffingType: "FT" }]);
    const res = await importRoster(post("/api/workforce/import", { academicYearStart: 2025, csv: ROSTER, apply: true }), ctx);
    expect(res.status).toBe(200);
    expect(tx.user.updateMany).not.toHaveBeenCalled();
    expect(tx.studentTermPlacement.createMany).not.toHaveBeenCalled();
  });
});
