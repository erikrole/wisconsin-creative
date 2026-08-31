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

  it("keeps the page internal and preserves admin-only awarding", () => {
    const page = source("src/app/(app)/badges/page.tsx");
    const client = source("src/app/(app)/badges/BadgesClient.tsx");

    expect(page).toContain("Role.ADMIN");
    expect(page).toContain("Role.STAFF");
    expect(page).toContain("badgesEnabled()");
    expect(client).toContain('"/api/badges?manualOnly=true"');
    expect(client).toContain("UserFilters");
    expect(client).toContain('`/api/users?${params}`');
    expect(client).toContain("showInactiveFilter={false}");
    expect(client).toContain("BulkBadgeAwardDialog");
    expect(client).toContain("isAdmin &&");
    expect(client).toContain("MAX_BULK_BADGE_TARGETS");
  });

  it("reads the audience count from the users response envelope", () => {
    const client = source("src/app/(app)/badges/BadgesClient.tsx");

    // useFetch defaults to json.data, which is the paginated user rows. The
    // directory totals live beside that array in json.stats.
    expect(client).toContain('stats: json.stats as DirectoryResponse["stats"] | undefined');
    expect(client).toContain("const targetCount = audience?.stats?.active ?? 0");
  });
});
