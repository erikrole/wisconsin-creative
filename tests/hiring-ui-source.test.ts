import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

// Source-contract checks for race and safety behavior in the Workforce client code.
const board = source("src/app/(app)/workforce/hiring/HiringClient.tsx");
const sheet = source("src/app/(app)/workforce/hiring/ApplicationSheet.tsx");
const dialogs = source("src/app/(app)/workforce/hiring/HiringDialogs.tsx");
const bulk = source("src/app/(app)/workforce/hiring/BulkResumeDialog.tsx");
const csvDialog = source("src/app/(app)/workforce/CsvImportDialog.tsx");
const personCard = source("src/app/(app)/workforce/PersonCard.tsx");

describe("hiring board", () => {
  it("drops applicant-list responses from superseded requests", () => {
    expect(board).toContain("appsRequest");
    expect(board).toContain("ticket !== appsRequest.current");
  });

  it("builds the review queue only from stages visible on the board", () => {
    expect(board).toMatch(/queueIds = useMemo\(\(\) => filtered\.filter\(\(a\) => columns\.includes\(a\.stage\)\)/);
  });

  it("gives admins an in-app way to close and reopen a cycle (starts the retention clock)", () => {
    expect(board).toContain("setCycleStatus");
    expect(board).toContain('method: "PATCH"');
    expect(board).toContain("Close cycle");
    expect(board).toContain("Reopen cycle");
    expect(board).toContain("CloseCycleDialog");
    expect(dialogs).toContain("36-month retention clock");
  });

  it("lets the admin give the real end date of a cycle (closing, or creating one that already ended)", () => {
    expect(board).toContain("closedOn");
    expect(dialogs).toContain('type="date"');
    expect(dialogs).toContain("This cycle already ended");
  });
});

describe("applicant panel", () => {
  it("ignores detail responses for an applicant that is no longer showing", () => {
    expect(sheet).toContain("currentId.current !== id");
  });

  it("advances after R only when Reviewed was actually saved", () => {
    expect(sheet).toContain("async function patch(body: Record<string, unknown>): Promise<boolean>");
    expect(sheet).toContain("if (saved) go(1);");
  });

  it("handles the possible-account decision before sending a second invite", () => {
    expect(sheet).toContain("possible_account");
    expect(sheet).toContain("confirmNewAccount");
    expect(sheet).toContain("linkUserId");
  });
});

describe("CSV import dialog", () => {
  it("invalidates the reviewed preview when an import option changes", () => {
    expect(csvDialog).toContain("previewedWith");
    expect(csvDialog).toContain("setReport(null)");
    expect(csvDialog).toContain("JSON.stringify(extraPayload)");
  });
});

describe("bulk resume upload", () => {
  it("stays under the write rate limit and can retry failed rows", () => {
    expect(bulk).toContain("MAX_FILES_PER_BATCH = 50");
    expect(bulk).toContain("allFiles.slice(0, MAX_FILES_PER_BATCH)");
    expect(bulk).toContain('row.status !== "failed"');
  });
});

describe("person panel", () => {
  it("shows start term and placement controls for students only", () => {
    expect(personCard).toContain('person.kind === "STUDENT"');
    expect(personCard).toContain("student workers only");
  });
});
