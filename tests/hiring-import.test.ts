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
    expect(mapStage("", false, false)).toBe("APPLIED");
    expect(mapStage("", true, false)).toBe("PASSED");
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
    { id: "u1", name: "Riley Roster", email: "riley@example.edu", athleticsEmail: null, startTerm: null },
    { id: "u3", name: "Quinn Existing", email: "quinn@example.edu", athleticsEmail: "quinn@athletics.example.edu", startTerm: "FALL" as const },
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
vi.mock("@/lib/audit", () => ({ createAuditEntry: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: vi.fn(), SETTINGS_MUTATION_LIMIT: { limit: 100, windowMs: 60_000 } }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

const tx = {
  applicant: { create: vi.fn() },
  application: { create: vi.fn() },
  applicationNote: { create: vi.fn() },
  user: { update: vi.fn() },
  studentTermPlacement: { create: vi.fn() },
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
import { createAuditEntry } from "@/lib/audit";
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
    tx.applicant.create.mockResolvedValue({ id: "new-person" });
    tx.application.create.mockResolvedValue({ id: "new-app" });
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
    expect(tx.applicant.create).toHaveBeenCalledTimes(3);
    expect(tx.application.create).toHaveBeenCalledTimes(3);
    const first = tx.application.create.mock.calls[0]![0].data;
    expect(first.cycleId).toBe(CYCLE);
    expect(first.sourcePayload).toMatchObject({ Applicant: "Alex Sample" });
    const audit = JSON.stringify(vi.mocked(createAuditEntry).mock.calls[0]![0]);
    expect(audit).toContain("import");
    expect(audit).not.toContain("example.edu");
  });

  it("apply skips rows that need review", async () => {
    models.applicant.findMany.mockResolvedValue([
      { id: "p2", name: "Alex Sample", gradTerm: "SPRING", gradYear: 2027, emails: [{ email: "alex.old@example.com" }] },
    ]);
    await importApplicants(post("/api/hiring/import", { cycleId: CYCLE, csv: PAGEUP, apply: true }), ctx);
    expect(tx.applicant.create).toHaveBeenCalledTimes(2);
  });

  it("rejects an empty file", async () => {
    const res = await importApplicants(post("/api/hiring/import", { cycleId: CYCLE, csv: "Name,Email\n" }), ctx);
    expect(res.status).toBe(400);
  });

  it("roster apply sets a start term and placements without overwriting", async () => {
    models.user.findMany.mockResolvedValue([{ id: "u1", name: "Riley Roster", email: "riley@example.edu", athleticsEmail: null, startTerm: null }]);
    const res = await importRoster(post("/api/workforce/import", { academicYearStart: 2025, csv: ROSTER, apply: true }), ctx);
    expect(res.status).toBe(200);
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { startTerm: "FALL", startTermYear: 2024 } });
    expect(tx.studentTermPlacement.create).toHaveBeenCalledTimes(3);
  });
});
