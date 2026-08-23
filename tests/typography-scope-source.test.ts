import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(path, "utf8");

/**
 * Two cascade traps, both measured in the browser on 2026-08-23.
 *
 * 1. `--font-mono` is declared on `:root` but resolves `--font-geist-mono`,
 *    which next/font only defines where its variable class is applied. While
 *    that class sat on `<body>`, `--font-mono` computed to nothing at `:root`
 *    and every `var(--font-mono)` in the app silently fell back to sans.
 *
 * 2. The typography block in `globals.css` is unlayered, so it outranks every
 *    Tailwind utility. A size or weight class on a heading needs the important
 *    modifier to take effect.
 */

describe("Typography scope contracts", () => {
  it("defines the font variables where :root can resolve them", () => {
    const layout = source("src/app/layout.tsx");

    // Both variable classes must be on <html>; on <body> they are out of scope
    // for the `:root` custom properties that consume them.
    expect(layout).toMatch(/<html[^>]*className=\{`\$\{GeistSans\.variable\} \$\{GeistMono\.variable\}`\}/);
    expect(layout).not.toMatch(/<body className=\{`\$\{GeistSans\.variable\}/);
  });

  it("keeps the mono token pointing at the loaded face", () => {
    const css = source("src/app/globals.css");
    expect(css).toContain("--font-mono: var(--font-geist-mono)");
  });

  it("uses the important modifier wherever a heading overrides the scale", () => {
    // These render at the base heading scale without it. Measured deltas:
    // digest 13->18px, list day group 13->16px, dashboard h2 20->18px.
    const cases: Array<[string, string]> = [
      ["src/app/(app)/schedule/_components/ScheduleAutomationDigest.tsx", 'text-sm! font-semibold!'],
      ["src/app/(app)/schedule/_components/ListView.tsx", 'text-sm! font-semibold!'],
      ["src/app/(app)/page.tsx", 'text-[20px]! font-black!'],
      ["src/app/(app)/schedule/_components/CalendarView.tsx", 'text-xl! font-bold!'],
      ["src/app/(app)/dashboard/section-header.tsx", 'text-sm! font-semibold!'],
    ];

    for (const [path, expected] of cases) {
      expect(source(path), path).toContain(expected);
    }
  });

  it("leaves no inert heading utilities on the two highest-traffic surfaces", () => {
    const files = [
      "src/app/(app)/page.tsx",
      "src/app/(app)/dashboard/section-header.tsx",
      "src/app/(app)/dashboard/collaborator-home.tsx",
      "src/app/(app)/schedule/_components/ListView.tsx",
      "src/app/(app)/schedule/_components/CalendarView.tsx",
      "src/app/(app)/schedule/_components/ScheduleAutomationDigest.tsx",
      "src/app/(app)/schedule/_components/CollaboratorSchedule.tsx",
    ];

    // A size or weight utility on a heading, without the important modifier.
    const inert = /<(?:h[1-6]|CardTitle)[^>]*className="[^"]*(?:text-(?:xs|sm|base|lg|xl|[2-9]xl)|text-\[[^\]]+\]|font-(?:normal|medium|semibold|bold|extrabold|black))(?!!)[\s"]/;

    for (const path of files) {
      expect(source(path), path).not.toMatch(inert);
    }
  });
});
