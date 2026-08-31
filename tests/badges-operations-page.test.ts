import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

describe("Badges Operations surface", () => {
  it("places Badges inside the staff Operations sidebar group", () => {
    const sidebar = source("src/components/Sidebar.tsx");
    const operationsIndex = sidebar.indexOf('label: "Operations"');
    const badgesEntry = '{ label: "Badges", href: "/badges", icon: AwardIcon }';

    expect(sidebar).toContain(badgesEntry);
    expect(sidebar.indexOf(badgesEntry)).toBeGreaterThan(operationsIndex);
  });

  it("keeps the page internal and exposes direct user selection", () => {
    const page = source("src/app/(app)/badges/page.tsx");
    const client = source("src/app/(app)/badges/BadgesClient.tsx");

    expect(page).toContain("Role.ADMIN");
    expect(page).toContain("Role.STAFF");
    expect(page).toContain("badgesEnabled()");
    expect(client).toContain('"/api/badges?manualOnly=true"');
    expect(client).toContain('"/api/users?limit=200&sort=name"');
    expect(client).toContain("Checkbox");
    expect(client).toContain("selectedUserIds");
    expect(client).toContain("Select all visible");
    expect(client).toContain("BulkBadgeAwardDialog");
    expect(client).toContain("userIds={selectedUserIds}");
    expect(client).toContain("isAdmin &&");
    expect(client).toContain("MAX_BULK_BADGE_TARGETS");
    expect(client).not.toContain("UserFilters");
    expect(client).not.toContain("useUrlState");
  });
});
