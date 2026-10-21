import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("shared page chrome", () => {
  it("keeps page titles plain without a decorative brand rail", () => {
    const header = source("src/components/PageHeader.tsx");
    expect(header).toContain("<header");
    expect(header).toContain('<h1 className="min-w-0 break-words text-wrap-balance">{title}</h1>');
    expect(header).not.toContain("border-l-[var(--wi-red)]");
    expect(header).toContain("mb-5 flex flex-col gap-3");
  });

  it("keeps detail identity as a rule, not a card", () => {
    const header = source("src/components/DetailPageHeader.tsx");
    expect(header).toContain("mb-5 border-b border-border/50 pb-5");
    expect(header).not.toContain("rounded-lg border border-border/50 bg-card");
    expect(header).not.toContain("shadow-xs");
  });

  it("shows the trail in the top bar without the Home root, in the chrome typeface", () => {
    const crumb = source("src/components/PageBreadcrumb.tsx");
    expect(crumb).toContain("allItems.slice(1)");
    expect(crumb).toContain("chromeFont.className");
    expect(crumb).not.toContain("brand-identity");
    expect(crumb).not.toContain("backdrop-blur");
    expect(crumb).not.toContain("after:bg-primary/55");
  });

  it("sets page titles in the chrome typeface on every shared header", () => {
    for (const file of [
      "src/components/PageHeader.tsx",
      "src/components/DetailPageHeader.tsx",
      "src/app/(app)/settings/SettingsPageShell.tsx",
    ]) {
      const header = source(file);
      expect(header).toContain("data-page-header");
      expect(header).toContain("chromeFont.variable");
    }
    const css = source("src/app/globals.css");
    expect(css).toContain("[data-page-header] h1");
    expect(css).toContain("font-family: var(--font-chrome)");
  });

  it("lets toolbar and section nav stay unfilled so controls carry the chrome", () => {
    const toolbar = source("src/components/OperationalToolbar.tsx");
    const nav = source("src/components/SectionNav.tsx");
    expect(toolbar).toContain("flex w-full min-w-0 flex-col gap-2");
    expect(toolbar).not.toContain("backdrop-blur");
    expect(toolbar).not.toContain("bg-background/45");
    expect(nav).not.toContain("backdrop-blur");
    expect(nav).not.toContain("bg-background/45");
    expect(nav).toContain("brand-identity text-foreground");
  });
});
