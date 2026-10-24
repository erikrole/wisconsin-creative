import { readFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";

const axeSource = readFileSync(path.join(process.cwd(), "node_modules/axe-core/axe.min.js"), "utf8");

type Violation = { id: string; impact: string | null; help: string; nodes: { target: string[] }[] };

/**
 * Runs axe-core (WCAG 2.1 A and AA rules) on the page and returns the serious
 * and critical violations as short readable lines, so a failing assertion names
 * the rule and the element. Moderate findings are left to design review.
 * `known` lists substrings of findings that are filed and awaiting a design fix;
 * remove an entry when its fix lands.
 */
export async function seriousAxeViolations(page: Page, known: string[] = []): Promise<string[]> {
  // A step that is still fading in reads as low contrast, so let animations settle.
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
  await page.addScriptTag({ content: axeSource });
  const violations = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (ctx: Document, opts: unknown) => Promise<{ violations: Violation[] }> } }).axe;
    const result = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
    return result.violations;
  });
  return violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map((violation) => `${violation.id}: ${violation.help} (${violation.nodes.map((node) => node.target.join(" ")).slice(0, 3).join(", ")})`)
    .filter((line) => !known.some((entry) => line.includes(entry)));
}
