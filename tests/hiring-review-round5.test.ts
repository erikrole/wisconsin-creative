import { beforeEach, describe, expect, it, vi } from "vitest";
import { source } from "./_helpers/source";

const models = {
  allowedEmail: { findMany: vi.fn() },
  user: { findMany: vi.fn() },
};
vi.mock("@/lib/db", () => ({ get db() { return models; } }));
vi.mock("@/lib/audit", () => ({ createAuditEntry: vi.fn(), createAuditEntries: vi.fn(), createAuditEntryTx: vi.fn() }));

import { previewAllowedEmailInvitesBulk } from "@/lib/services/onboarding-lifecycle";

describe("bulk onboarding preview and hire invites", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    models.allowedEmail.findMany.mockResolvedValue([]);
    models.user.findMany.mockResolvedValue([]);
  });

  it("does not let staff discover a pending hire invite by previewing an applicant's address", async () => {
    await previewAllowedEmailInvitesBulk({
      actor: { id: "staff-1", role: "STAFF" },
      emails: [{ email: "applicant@example.edu", role: "STUDENT" }],
    });
    expect(models.allowedEmail.findMany.mock.calls[0]![0].where).toEqual({
      email: { in: ["applicant@example.edu"] },
      applications: { none: {} },
    });
  });

  it("lets admins see every invitation, including hire invites", async () => {
    await previewAllowedEmailInvitesBulk({
      actor: { id: "admin-1", role: "ADMIN" },
      emails: [{ email: "applicant@example.edu", role: "STUDENT" }],
    });
    expect(models.allowedEmail.findMany.mock.calls[0]![0].where).toEqual({ email: { in: ["applicant@example.edu"] } });
  });
});

describe("deactivation date (starts the hired-student retention clock)", () => {
  it("is recorded on every deactivation path, including the erase path", () => {
    const service = source("src/lib/services/user-deactivation.ts");
    expect(service).toContain(": { active: false, deactivatedAt: new Date(), icsToken: null },");
    expect(service).toMatch(/active: false,\s+deactivatedAt: new Date\(\),\s+startTerm: null,\s+startTermYear: null,\s+name: "Deleted User"/);
  });

  it("is cleared when an account is reactivated", () => {
    const route = source("src/app/api/users/[id]/route.ts");
    expect(route).toContain("if (body.active) updateData.deactivatedAt = null;");
  });

  it("is backfilled for accounts that were already inactive, without ever being earlier than the truth", () => {
    const sql = source("prisma/migrations/0161_user_deactivated_at/migration.sql");
    expect(sql).toContain('ADD COLUMN     "deactivated_at" TIMESTAMP(3)');
    expect(sql).toContain('SET "deactivated_at" = "updated_at" WHERE "active" = false');
  });
});

describe("hiring UI", () => {
  const bulk = source("src/app/(app)/workforce/hiring/BulkResumeDialog.tsx");
  const csv = source("src/app/(app)/workforce/CsvImportDialog.tsx");
  const sheet = source("src/app/(app)/workforce/hiring/ApplicationSheet.tsx");
  const dialogs = source("src/app/(app)/workforce/hiring/HiringDialogs.tsx");
  const board = source("src/app/(app)/workforce/hiring/HiringClient.tsx");

  it("tells same-name applicants apart in the resume assignment menu", () => {
    expect(bulk).toContain("a.email ?");
    expect(bulk).toContain("a.externalApplicationId ?");
  });

  it("shows existing accounts and the stages rows will take in the import preview", () => {
    expect(csv).toContain("hasAccount?: boolean");
    expect(csv).toContain("r.hasAccount");
    expect(csv).toContain("An account already exists for this email");
    expect(csv).toContain("report.stages");
    expect(csv).toContain("They will be added as");
  });

  it("shows the experience, interest, and software answers an applicant gave", () => {
    for (const label of ["Experience in", "Interested in", "Software"]) expect(sheet).toContain(label);
    for (const field of ["detail.fieldsExperience", "detail.fieldsInterested", "detail.softwareExperience"]) expect(sheet).toContain(field);
  });

  it("drops stale duplicate choices as soon as any applicant field changes", () => {
    expect(dialogs).toContain("setMatches(null);\n    setForm((f) => ({ ...f, [key]: e.target.value }));");
  });

  it("lets the admin choose among every same-name account, with email and status", () => {
    expect(dialogs).toContain("export function PickAccountDialog");
    expect(dialogs).toContain("c.email");
    expect(dialogs).toContain('c.active ? "Active" : "Deactivated"');
    expect(sheet).toContain("setAccountChoices(json.data.users)");
    expect(sheet).toContain("PickAccountDialog");
    // The old flow silently used only the first candidate.
    expect(sheet).not.toContain("json.data.users[0]");
  });

  it("clears the close date whenever the dialog opens, closes, or targets another cycle", () => {
    expect(dialogs).toContain('setClosedOn("");');
    expect(dialogs).toContain("}, [open, label]);");
  });

  // Graduation formatting is covered behaviorally by workforce-team.test.ts.

  it("only offers 'a blank decision means passed over' for a finished cycle", () => {
    expect(board).toContain('disabled={cycle.status === "OPEN" || cycle.status === "PLANNING"}');
    expect(board).toContain('blankDecisionMeansPassed: blankPassed && (cycle.status === "CLOSED" || cycle.status === "ARCHIVED")');
  });
});
