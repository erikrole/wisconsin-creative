import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("shared page chrome", () => {
  it("keeps page titles on Gotham without a decorative brand rail", () => {
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

  it("hides top-level breadcrumbs and sets the current crumb in Gotham", () => {
    const crumb = source("src/components/PageBreadcrumb.tsx");
    expect(crumb).toContain("shouldShowBreadcrumbs");
    expect(crumb).toContain("brand-identity relative inline-flex min-h-10");
    expect(crumb).not.toContain("backdrop-blur");
    expect(crumb).not.toContain("after:bg-primary/55");
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
