import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

describe("Users bulk badge award UI", () => {
  it("exposes the action from the admin Users directory and passes the active roster scope", () => {
    const page = source("src/app/(app)/users/page.tsx");
    const dialog = source("src/app/(app)/users/BulkBadgeAwardDialog.tsx");

    expect(page).toContain('currentUserRole === "ADMIN"');
    expect(page).toContain("Award badge to matching users");
    expect(page).toContain("bulkAwardFilters");
    expect(page).toContain("bulkAwardTargetCount");
    expect(dialog).toContain("/api/badges/award/bulk");
    expect(dialog).toContain("Review award");
    expect(dialog).toContain("Confirm badge award");
    expect(dialog).toContain("Inactive users are excluded");
    expect(dialog).toContain("Already had it");
  });
});
