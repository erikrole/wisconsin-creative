import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("Settings sweeping UI contracts", () => {
  it("uses one content rail and grouped mobile page discovery", () => {
    const layout = source("src/app/(app)/settings/layout.tsx");
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
    expect(nav).toContain('label: "Booking extensions"');
    expect(nav).toContain('label: "Overdue escalation"');
    expect(nav).toContain('label: "Database diagnostics"');
    expect(nav).toContain('group: "Booking"');
    expect(nav).toContain('group: "Schedule"');
    expect(nav).toContain('href: "/settings/sports"');
    expect(nav).toContain('group: "Schedule"');
    expect(nav).toContain("relatedHrefs");
    expect(nav).toContain("export function getRelatedSettingsSections");
  });

  it("does not render failed extension loads as an empty configuration", () => {
    const bookings = source("src/app/(app)/settings/bookings/page.tsx");

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
