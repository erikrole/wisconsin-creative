import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("Settings sweeping UI contracts", () => {
  it("uses one content rail and grouped mobile page discovery", () => {
    const layout = source("src/app/(app)/settings/SettingsShell.tsx");
    const shell = source("src/app/(app)/settings/SettingsPageShell.tsx");

    expect(layout).toContain("<SettingsMobilePicker");
    expect(layout).toContain('aria-label="Choose Settings page"');
    expect(shell).toContain('className="flex min-w-0 flex-col gap-4"');
    expect(shell).not.toContain("grid-cols-[220px_minmax(0,1fr)]");
  });

  it("uses intent-first Settings labels without changing route URLs", () => {
    const nav = source("src/lib/nav-sections.ts");

    expect(nav).toContain('href: "/settings/allowed-emails"');
    expect(nav).toContain('label: "Registration access"');
    expect(nav).toContain('href: "/settings/collaborator-access"');
    expect(nav).toContain('label: "Collaborator access"');
    expect(nav).not.toContain('href: "/settings/bookings"');
    expect(nav).toContain('label: "Overdue escalation"');
    expect(nav).toContain('label: "Database diagnostics"');
    expect(nav).toContain('group: "Booking"');
    expect(nav).toContain('group: "Schedule"');
    expect(nav).toContain('href: "/settings/sports"');
    expect(nav).toContain('group: "Schedule"');
    expect(nav).toContain("relatedHrefs");
    expect(nav).toContain("export function getRelatedSettingsSections");
  });

  it("keeps Settings Related links role-useful without changing URLs", () => {
    const nav = source("src/lib/nav-sections.ts");
    const area = source("docs/AREA_SETTINGS.md");

    expect(nav).toMatch(
      /href: "\/settings\/calendar-sources"[\s\S]*?relatedHrefs: \["\/settings\/sports", "\/settings\/locations"\]/
    );
    expect(nav).toMatch(
      /href: "\/settings\/sports"[\s\S]*?relatedHrefs: \["\/settings\/calendar-sources"\]/
    );
    expect(nav).toMatch(
      /href: "\/settings\/escalation"[\s\S]*?relatedHrefs: \["\/settings\/checkout-policies", "\/settings\/reservation-rules"\]/
    );
    expect(nav).toMatch(
      /href: "\/settings\/reservation-rules"[\s\S]*?relatedHrefs: \["\/settings\/checkout-policies", "\/settings\/escalation"\]/
    );
    // The audit log lives in Reports; Settings keeps no duplicate page.
    expect(nav).not.toContain('href: "/settings/audit"');
    expect(nav).toMatch(
      /href: "\/settings\/data-export"[\s\S]*?relatedHrefs: \["\/settings\/database"\]/
    );
    expect(nav).toMatch(
      /href: "\/settings\/database"[\s\S]*?ownerOnly: true[\s\S]*?relatedHrefs: \["\/settings\/data-export"\]/
    );
    expect(nav).toMatch(
      /href: "\/settings\/app-activity"[\s\S]*?keywords: \[[\s\S]*?\]\s*,?\s*\n\s*\}/
    );
    const appActivity = nav.match(/href: "\/settings\/app-activity"[\s\S]*?\n  \}/)?.[0] ?? "";
    expect(appActivity).not.toContain("relatedHrefs:");

    expect(area).toContain("### Registration access (`/settings/allowed-emails`)");
    expect(area).toContain("### Collaborator access (`/settings/collaborator-access`)");
    expect(area).toContain("Extend presets (`/settings/checkout-policies#extend-presets`)");
    expect(area).toContain("### Overdue escalation (`/settings/escalation`)");
    expect(area).toContain("### Kiosks (`/settings/kiosk-devices`)");
    expect(area).toContain("### Data exports (`/settings/data-export`)");
    expect(area).toContain("### Database diagnostics (`/settings/database`)");
  });

  it("does not render failed extension loads as an empty configuration", () => {
    const bookings = source("src/app/(app)/settings/checkout-policies/ExtendPresets.tsx");

    expect(bookings).toContain("error && !settingsData");
    expect(bookings).toContain("Could not load booking extensions");
    expect(bookings).not.toContain("GripVerticalIcon");
  });

  it("only confirms notification pause and resume after persistence", () => {
    const notifications = source("src/app/(app)/settings/notifications/page.tsx");

    expect(notifications).toContain("const saved = await save");
    expect(notifications).toContain("if (saved)");
    expect(notifications).toContain("return false");
  });

  it("does not present the bounded database diagnostic as complete schema health", () => {
    const database = source("src/app/(app)/settings/database/page.tsx");

    expect(database).toContain("Baseline checks passed");
    expect(database).toContain("bounded baseline check");
    expect(database).not.toContain("Schema is healthy");
  });
});
