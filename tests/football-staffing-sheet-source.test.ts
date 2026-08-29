import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getAllowedRoles } from "@/lib/permissions";

describe("Football staffing-sheet preview boundaries", () => {
  const previewRoute = readFileSync("src/app/api/schedule/football-staffing-sheet/preview/route.ts", "utf8");
  const previewService = readFileSync("src/lib/services/football-staffing-sheet-preview.ts", "utf8");
  const applyRoute = readFileSync("src/app/api/schedule/football-staffing-sheet/apply/route.ts", "utf8");
  const applyService = readFileSync("src/lib/services/football-staffing-sheet-apply.ts", "utf8");
  const page = readFileSync("src/app/(app)/schedule/page.tsx", "utf8");
  const dialog = readFileSync("src/components/schedule/FootballStaffingSheetPreviewDialog.tsx", "utf8");

  it("is Admin-only and rate limited at the authenticated route", () => {
    expect(getAllowedRoles("shift_assignment", "manage_roles")).toEqual(["ADMIN"]);
    expect(previewRoute).toContain('requirePermission(user.role, "shift_assignment", "manage_roles")');
    expect(previewRoute).toContain("schedule:football-sheet-preview:");
    expect(previewRoute).toContain("enforceRateLimit");
    expect(applyRoute).toContain('requirePermission(user.role, "shift_assignment", "manage_roles")');
    expect(applyRoute).toContain('requirePermission(user.role, "shift", "manage")');
    expect(applyRoute).toContain("schedule:football-sheet-apply:");
    expect(applyRoute).toContain("enforceRateLimit");
  });

  it("keeps preview read-only and gives apply only the working-copy authority", () => {
    for (const forbidden of [".create(", ".update(", ".delete(", ".upsert(", "$transaction", "createAuditEntry"]) {
      expect(previewService).not.toContain(forbidden);
      expect(previewRoute).not.toContain(forbidden);
    }
    expect(previewRoute).not.toContain("apply");
    expect(applyService).toContain("previewFootballStaffingSheet");
    expect(applyService).toContain("sourceFingerprint");
    expect(applyService).toContain("reviewFingerprint");
    expect(applyService).toContain("mutateWorkingSchedule");
    expect(applyService).not.toContain("db.");
    expect(dialog).toContain("/api/schedule/football-staffing-sheet/apply");
    expect(dialog).toContain("Choose the exact Schedule slot");
    expect(dialog).not.toContain("Student opportunities can be applied");
  });

  it("exposes the UI only from the Admin Schedule branch", () => {
    expect(page).toContain("{canReviewClaims && (");
    expect(page).toContain("Preview Football staffing sheet");
    expect(page).toContain("FootballStaffingSheetPreviewDialog");
    expect(dialog).toContain("Sheet1!A1:M14");
    expect(dialog).toContain("Nothing is guessed.");
    expect(dialog).toContain("This never writes to Google Sheets.");
  });
});
