import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(path, "utf8");

describe("Staff roster role tabs and photo grid", () => {
  const page = source("src/app/(app)/staff/StaffPageClient.tsx");
  const filters = source("src/app/(app)/staff/UserFilters.tsx");
  const tabs = source("src/app/(app)/staff/RoleTabs.tsx");

  it("makes the role breakdown a one-tap control with live counts", () => {
    expect(page).toContain("<RoleTabs value={roleFilter} stats={stats} onChange={setRoleFilter} />");
    expect(tabs).toContain("byRole.STUDENT");
    expect(tabs).toContain('aria-label="Filter by role"');
  });

  it("removes the duplicate role dropdown and metric cards", () => {
    expect(filters).not.toContain("All roles");
    expect(page).not.toContain("OperationalMetricCard");
  });

  it("offers a URL-backed table and photo grid layout on desktop", () => {
    expect(page).toContain('"view"');
    expect(page).toContain("<UserGridCard");
    expect(page).toContain('aria-label="Roster layout"');
  });

  it("groups the loaded page by area, shows a hover quick view, and hides student-only filters for other roles", () => {
    expect(page).toContain('"group"');
    expect(page).toContain("<GroupHeading");
    expect(source("src/app/(app)/staff/UserRow.tsx")).toContain("<UserQuickView");
    expect(filters).toContain("studentFiltersApply");
  });
});
