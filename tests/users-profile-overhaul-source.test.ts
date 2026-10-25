import { describe, expect, it } from "vitest";
import { source, splitSource } from "./_helpers/source";

describe("User profile overhaul contracts", () => {
  it("keeps identity in the header and Scoreboard as a jump, not a duplicate hero", () => {
    const page = source("src/app/(app)/staff/[id]/page.tsx");

    expect(page).toContain("function profileHeaderSubtitle");
    expect(page).toContain("function ProfileHeaderFacts");
    expect(page).toContain('onOpenScoreboard={() => switchTab("scoreboard")}');
    expect(page).toContain('sideBySideAt="sm"');
    expect(page).not.toContain("footer={");
    expect(page).toContain('aria-label="Profile sections"');
    expect(page).toContain("<ProfileRelatedLinks");
    expect(page).not.toContain("Reports to");
    expect(page).not.toContain("data-[state=active]:shadow-[inset_0_-2px_0_0_var(--wisconsin-red)]");
  });

  it("groups Info without jump chips", () => {
    // Sections, labels and the collaborator field render in tests/user-info-tab.test.ts.
    expect(splitSource("src/app/(app)/staff/[id]/UserInfoTab.tsx")).not.toContain("ProfileJumpNav");
  });

  it("keeps activity, availability, and badge filters on the 40px baseline", () => {
    const activity = source("src/app/(app)/staff/[id]/UserActivityTab.tsx");
    const availability = source("src/app/(app)/staff/[id]/UserAvailabilityTab.tsx");
    const badges = source("src/app/(app)/staff/[id]/UserBadgesTab.tsx");

    expect(activity).toContain('aria-label="Filter activity"');
    expect(activity).toContain('className="h-10"');
    expect(activity).not.toContain('className="h-7"');
    expect(activity).not.toContain('className="h-6 text-xs px-2.5"');
    expect(availability).not.toContain('className="h-8 text-sm"');
    expect(badges).toContain('className="h-10 px-3"');
  });

  it("keeps the profile Scoreboard as a compact season strip", () => {
    const tab = source("src/app/(app)/staff/[id]/UserScoreboardTab.tsx");

    expect(tab).toContain("scoreboardHighlights(scoreboard)");
    expect(tab).toContain("text-2xl font-semibold tabular-nums");
    expect(tab).not.toContain("text-4xl");
    expect(tab).not.toContain("rounded-xl border bg-muted/25 p-4");
  });

  it("adds related jumps from roster and profile without changing route URLs", () => {
    const roster = source("src/app/(app)/staff/page.tsx");
    const related = source("src/app/(app)/staff/_components/RosterRelatedLinks.tsx");
    const profileRelated = source("src/app/(app)/staff/[id]/_components/ProfileRelatedLinks.tsx");

    expect(roster).toContain("<RosterRelatedLinks canOpenStaffTools={canEdit} />");
    expect(related).toContain('href: "/staff/org-chart"');
    expect(related).toContain('href: "/scoreboard"');
    expect(profileRelated).toContain("`/bookings?requesterUserId=${encodeURIComponent(userId)}`");
    expect(profileRelated).toContain('href: "/settings/profile"');
  });
});
