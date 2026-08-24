import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

describe("Users sweeping ownership contracts", () => {
  it("shows canonical roles and accessible sort state in the roster", () => {
    const page = source("src/app/(app)/users/page.tsx");
    const row = source("src/app/(app)/users/UserRow.tsx");
    const badge = source("src/app/(app)/users/RoleBadge.tsx");

    expect(row).toContain("<RoleBadge role={user.role} affiliationLabel={rosterAffiliationLabel(user)} />");
    expect(row).toContain("affiliation?.badgeLabel");
    expect(row).not.toContain("listRoleLabel");
    expect(badge).toContain("affiliationLabel");
    expect(badge).toContain('affiliation || "Collaborator"');
    expect(badge).toContain('role === "ADMIN" ? "STAFF"');
    expect(badge).toContain("publicDirectoryRole");
    expect(page).toContain('aria-sort={isAsc ? "ascending" : isDesc ? "descending" : "none"}');
    expect(page).toContain('<AnimatePresence initial={false} mode="popLayout">');
    expect(page).toContain('<ArrowUp className="size-4 text-foreground"');
    expect(page).toContain('opacity-20 transition-opacity group-hover:opacity-50');
  });

  it("keeps the desktop roster compact and removes repetitive columns", () => {
    const page = source("src/app/(app)/users/page.tsx");
    const row = source("src/app/(app)/users/UserRow.tsx");
    const rail = source("src/components/OperationalStatusRail.tsx");

    expect(page).toContain('className="mb-5"');
    expect(page).toContain('detailsLabel="Roster breakdown"');
    expect(page).toContain("Title / area");
    expect(page).toContain('label="Last active" sortKey="lastActive"');
    expect(page).not.toContain('>Location</TableHead>');
    expect(page).not.toContain('aria-label="Refresh users list"');
    expect(page).not.toContain("<RefreshCw");
    expect(row).toContain("<TitleAreaValue user={user} />");
    expect(row).not.toContain("{user.location || \"\\u2014\"}");
    expect(row).toContain("focus-visible:ring-[3px]");
    expect(row).toContain('bg-muted-foreground/40');
    expect(row).toContain('border border-muted-foreground/50');
    expect(row).toContain('<time dateTime={lastActiveAt} className="tabular-nums">');
    expect(rail).toContain('detailsLabel = "Details"');
    expect(rail).toContain('`Hide ${detailsLabel.toLowerCase()}`');
  });

  it("derives student roster titles from primary area and keeps roster cleanup staff-only", () => {
    const page = source("src/app/(app)/users/page.tsx");
    const row = source("src/app/(app)/users/UserRow.tsx");
    const types = source("src/app/(app)/users/types.ts");

    expect(row).toContain('user.role === "STUDENT"');
    expect(row).toContain('`${area} Student`');
    expect(row).toContain('AREA_LABELS[area]');
    expect(page).toContain('canEdit && stats.missingPhotos > 0');
    expect(types).toContain('LIVE_PRODUCTION: "Live Production"');
    expect(types).toContain('SOCIAL: "Social"');
  });

  it("uses the concise Add users command and omits the roster subtitle", () => {
    const page = source("src/app/(app)/users/page.tsx");
    const dialog = source("src/components/onboarding/OnboardingDialog.tsx");

    expect(page).toContain('<PageHeader title={isCollaboratorDirectory ? "People" : "Users"} className="mb-5">');
    expect(page).not.toContain("Find people, manage access, and review roster health.");
    expect(page).toContain("Add users");
    expect(dialog).toContain("Grant app access to one person or paste a roster.");
    expect(dialog).toContain("Invite-only access");
  });

  it("keeps onboarding direct and viewport-safe", () => {
    const users = source("src/app/(app)/users/page.tsx");
    const status = source("src/app/(app)/users/onboarding-status/page.tsx");
    const dialog = source("src/components/onboarding/OnboardingDialog.tsx");

    expect(status).toContain('href="/users?onboard=1"');
    expect(users).toContain('"onboard"');
    expect(dialog).toContain("max-h-[calc(100dvh-2rem)]");
    expect(dialog).toContain("min-h-0 overflow-y-auto");
  });

  it("confirms availability deletion before the destructive request", () => {
    const availability = source("src/app/(app)/users/[id]/UserAvailabilityTab.tsx");

    expect(availability).toContain("const confirm = useConfirm()");
    expect(availability).toContain('title: "Remove availability?"');
    expect(availability.indexOf("await confirm(")).toBeLessThan(availability.indexOf('method: "DELETE"'));
  });

  it("keeps cyclic legacy org-chart users visible", () => {
    const orgChart = source("src/app/(app)/users/org-chart/page.tsx");

    expect(orgChart).toContain("Corrupt legacy cycles have no natural root");
    expect(orgChart).toContain("if (!included.has(user.id))");
    expect(orgChart).toContain("<RoleBadge role={user.role} />");
  });

  it("makes avatar replacement and removal database-first", () => {
    const avatar = source("src/app/api/users/[id]/avatar/route.ts");
    const firstUpdate = avatar.indexOf("updated = await db.user.update");
    const firstDelete = avatar.indexOf("await deleteImage(target.avatarUrl)");
    const removeUpdate = avatar.lastIndexOf("await db.user.update");
    const removeDelete = avatar.lastIndexOf("await deleteImage(target.avatarUrl)");

    expect(firstUpdate).toBeGreaterThan(-1);
    expect(firstUpdate).toBeLessThan(firstDelete);
    expect(removeUpdate).toBeLessThan(removeDelete);
  });
});
