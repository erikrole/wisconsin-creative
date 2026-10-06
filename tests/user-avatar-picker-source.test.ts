import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("assignment picker", () => {
  const picker = readFileSync("src/components/shift-detail/UserAvatarPicker.tsx", "utf8");

  it("shows load errors before the ranking spinner and sorts alphabetically without scores", () => {
    expect(picker.indexOf("loadError ? (")).toBeLessThan(picker.indexOf("Ranking candidates..."));
    expect(picker).toContain("a.name.localeCompare(b.name)");
  });

  it("surfaces conflict and fit reasons as visible, accessible text", () => {
    expect(picker).toContain("conflict ?? topReason ?? roleSlotNote");
    expect(picker).toContain("aria-label={[");
    expect(picker).toContain('aria-label="Search people by name"');
  });

  it("ignores whitespace-only searches in picker callers", () => {
    for (const file of ["src/components/ShiftDetailPanel.tsx", "src/app/(app)/schedule/_components/WorkingCrewEditor.tsx"]) {
      expect(readFileSync(file, "utf8")).toContain("userSearch.trim()");
    }
  });

  it("tells iOS users when ranking is unavailable", () => {
    const sheet = readFileSync("ios/Wisconsin/Views/Schedule/AssignStudentSheet.swift", "utf8");
    expect(sheet).toContain("scoresUnavailable");
    expect(sheet).toContain("Ranking unavailable");
  });

  it("blocks unavailable people and confirms advisory conflicts like iOS", () => {
    expect(picker).toContain("score.blockingConflict");
    expect(picker).toContain("disabled={disabled || blocked}");
    expect(picker).toContain("Assign {pendingUser.name} anyway?");
  });
});
