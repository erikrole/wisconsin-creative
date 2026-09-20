import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("Settings UI polish contracts", () => {
  it("lets operators filter the overview directory without leaving the page", () => {
    const page = source("src/app/(app)/settings/page.tsx");

    expect(page).toContain('aria-label="Find a setting — try allowlist, kiosk, or overdue"');
    expect(page).toContain("Resume {lastSection.label}");
    expect(page).toContain("active:scale-[0.96]");
    expect(page).toContain("transition-[background-color,scale]");
    expect(page).toContain("<SettingsGroupList group={group} sections={sections} />");
  });

  it("keeps search compact on small screens and command results touch sized", () => {
    const command = source("src/app/(app)/settings/SettingsCommand.tsx");

    expect(command).toContain('className="size-10 text-muted-foreground sm:w-auto sm:px-3"');
    expect(command).toContain('<span className="hidden sm:inline">Search settings</span>');
    expect(command).toContain('className="min-h-11 transition-[background-color,color]"');
  });

  it("gives blocked-route recovery an explicit desktop target", () => {
    const layout = source("src/app/(app)/settings/layout.tsx");

    expect(layout).toContain('<Button asChild variant="outline" className="h-10">');
    expect(layout).toContain('<Link href="/settings">Back to Settings</Link>');
  });

  it("keeps save labels stable and related links on every sub-page shell", () => {
    const saveBar = source("src/app/(app)/settings/_components/SettingsSaveBar.tsx");
    const shell = source("src/app/(app)/settings/SettingsPageShell.tsx");
    const related = source("src/app/(app)/settings/_components/SettingsRelatedLinks.tsx");

    expect(saveBar).toContain("loading={saving}");
    expect(saveBar).toContain('{dirty ? saveLabel : savedLabel}');
    expect(shell).toContain("<SettingsRelatedLinks href={href} />");
    expect(related).toContain("getRelatedSettingsSections");
  });

  it("exposes Slack handle on Profile and on-page jump nav on long tabs", () => {
    const profile = source("src/app/(app)/settings/profile/page.tsx");
    const sports = source("src/app/(app)/settings/sports/page.tsx");
    const security = source("src/app/(app)/settings/security/page.tsx");

    expect(profile).toContain("Slack handle");
    expect(profile).toContain('name="slackHandle"');
    expect(sports).toContain("<SettingsJumpNav");
    expect(security).toContain("{ href: \"#passkeys\", label: \"Passkeys\" }");
  });
});
