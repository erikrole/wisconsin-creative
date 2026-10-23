import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("Badges gallery surface", () => {
  it("lists Badges in the People sidebar group for everyone, not in a staff-only group", () => {
    const sidebar = source("src/components/Sidebar.tsx");
    const peopleIndex = sidebar.indexOf('label: "People"');
    const staffToolsIndex = sidebar.indexOf('label: "Staff tools"');
    const badgesEntry = '{ label: "Badges", href: "/badges", icon: MedalIcon }';
    const badgesIndex = sidebar.indexOf(badgesEntry);

    expect(badgesIndex).toBeGreaterThan(peopleIndex);
    expect(badgesIndex).toBeLessThan(staffToolsIndex);
    expect(sidebar.split(badgesEntry).length).toBe(2);
  });

  it("opens the page to everyone who can earn badges and keeps awarding with staff", () => {
    const page = source("src/app/(app)/badges/page.tsx");
    const client = source("src/app/(app)/badges/BadgesClient.tsx");

    expect(page).toContain("Role.COLLABORATOR");
    expect(page).not.toContain("user.role !== Role.ADMIN && user.role !== Role.STAFF");
    expect(page).toContain("badgesEnabled()");
    expect(client).toContain('"/api/badges/gallery"');
    expect(client).toContain('{isStaff ? <TabsTrigger value="award">Award</TabsTrigger> : null}');
    expect(client).toContain("<BadgeAwardPanel");
  });

  it("keeps direct user selection in the staff award panel", () => {
    const panel = source("src/app/(app)/badges/BadgeAwardPanel.tsx");

    expect(panel).toContain('"/api/badges?manualOnly=true"');
    expect(panel).toContain('"/api/users?limit=200&sort=name"');
    expect(panel).toContain("Checkbox");
    expect(panel).toContain("selectedUserIds");
    expect(panel).toContain("Select all visible");
    expect(panel).toContain("BulkBadgeAwardDialog");
    expect(panel).toContain("userIds={selectedUserIds}");
    expect(panel).toContain("isAdmin &&");
    expect(panel).toContain("MAX_BULK_BADGE_TARGETS");
    expect(panel).not.toContain("UserFilters");
    expect(panel).not.toContain("useUrlState");
  });

  it("deep links badges and comparisons, and links in from the profile tab", () => {
    const page = source("src/app/(app)/badges/page.tsx");
    const client = source("src/app/(app)/badges/BadgesClient.tsx");
    const profileTab = source("src/app/(app)/staff/[id]/UserBadgesTab.tsx");
    const profilePage = source("src/app/(app)/staff/[id]/page.tsx");

    expect(page).toContain("initialBadgeKey=");
    expect(page).toContain("initialCompareId=");
    // A mystery tile's key is never written into a shareable URL.
    expect(client).toContain('replaceSearchParam("badge", badge && !badge.mystery ? badge.key : null)');
    expect(client).toContain("data.canCompare && data.people.some");
    expect(client).toContain("<UpNext badges={data.badges}");
    // Surprises and bloopers have no holder list to link to.
    expect(profileTab).toContain("!isHiddenUntilEarnedBadge(badge.key) && !isPrivateHolderBadge(badge.key)");
    expect(profileTab).toContain("/badges?tab=team&compare=");
    expect(profilePage).toContain('profile.role !== "COLLABORATOR" ? { isSelf } : null');
  });
});
