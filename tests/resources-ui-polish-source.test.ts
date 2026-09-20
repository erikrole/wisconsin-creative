import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("Resources interaction-detail contracts", () => {
  it("uses the shared tactile scale and 40px layout targets across the Guide library", () => {
    const page = source("src/app/(app)/resources/page.tsx");

    expect(page).not.toContain("scale-[0.99]");
    expect(page.match(/active:scale-\[0\.96\]/g)?.length).toBeGreaterThanOrEqual(3);
    expect(page.match(/aria-label="(?:Cards|List)" className="min-h-10 px-3"/g)).toHaveLength(2);
    expect(page).toContain("transition-[background-color,scale]");
  });

  it("keeps library cards quiet while preserving a local link affordance", () => {
    const page = source("src/app/(app)/resources/page.tsx");

    expect(page).not.toContain("group-hover:border-foreground/30");
    expect(page).not.toContain("hover:shadow-sm");
    expect(page).toContain("group-hover:translate-x-0.5 group-hover:text-foreground");
    expect(page).toContain("hover:no-underline");
    expect(page).toContain("resource-featured");
    expect(page).toContain("resource-tile");
    expect(page).toContain("resource-index-row");
    expect(page).toContain("resource-mark");
  });

  it("keeps guide surfaces title-first with a one-line purpose", () => {
    const page = source("src/app/(app)/resources/page.tsx");
    const guideSurfaces = page.slice(page.indexOf("function GuideCard"), page.indexOf("function SectionHeader"));

    expect(guideSurfaces).toContain("guide.title");
    expect(guideSurfaces).toContain("guide.summary");
    expect(guideSurfaces).toContain("resource-featured-summary");
    expect(guideSurfaces).toContain("resource-tile-summary");
    expect(guideSurfaces).toContain("resource-index-summary");
    expect(guideSurfaces).toContain("line-clamp-1");
    expect(guideSurfaces).not.toContain("audienceLabel");
    expect(guideSurfaces).not.toContain("guide.author.name");
    expect(guideSurfaces).not.toContain("formatShortDate");
    expect(guideSurfaces).not.toContain("CardContent");
    expect(guideSurfaces).not.toContain("CardFooter");
  });

  it("keeps Guide reader navigation and editor commands keyboard-visible and tactile", () => {
    const reader = source("src/app/(app)/resources/[slug]/_components/GuideReader.tsx");

    expect(reader).toContain("transition-[background-color,color,scale]");
    expect(reader).toContain("focus-visible:ring-2 focus-visible:ring-ring");
    expect(reader).toContain('className="h-10 shrink-0"');
    expect(reader).toContain("flex min-h-11 flex-col gap-1");
  });

  it("pins the reader TOC in a stretched column so it can travel with the article", () => {
    const reader = source("src/app/(app)/resources/[slug]/_components/GuideReader.tsx");
    const css = source("src/app/globals.css");

    expect(reader).toContain("guide-toc-column");
    expect(reader).toContain("self-stretch");
    expect(reader).toContain("guide-toc-indicator");
    expect(css).toContain(".guide-reader-grid {\n  align-items: stretch;");
    expect(css).toContain("position: sticky;\n  top: 5rem;");
    expect(css).not.toContain(".guide-reader-grid {\n  align-items: start;");
  });

  it("animates copy-state icons without replaying them on initial render", () => {
    for (const path of [
      "src/components/resources/ServerPathCopy.tsx",
      "src/components/resources/MarkdownReader.tsx",
    ]) {
      const component = source(path);
      expect(component).toContain('<AnimatePresence initial={false} mode="popLayout">');
      expect(component).toContain('initial={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}');
      expect(component).toContain('transition={{ type: "spring", duration: 0.3, bounce: 0 }}');
    }
  });

  it("extends heading-link hit areas without changing their visible size", () => {
    const css = source("src/app/globals.css");

    expect(css).toContain(".guide-heading-anchor::after");
    expect(css).toContain("inset: -0.5rem;");
    expect(css).toContain(".guide-heading-anchor:active");
    expect(css).toContain("scale: 0.96;");
  });

  it("wraps long inline paths without changing scrollable code blocks", () => {
    const css = source("src/app/globals.css");

    expect(css).toContain(".guide-markdown-inline-code {\n  max-width: 100%;\n  overflow-wrap: anywhere;");
    expect(css).toContain(
      ".guide-markdown-code-block .guide-markdown-inline-code {\n  display: block;\n  background: transparent;\n  border-radius: 0;\n  color: inherit;\n  max-width: none;\n  overflow-wrap: normal;",
    );
  });
});
