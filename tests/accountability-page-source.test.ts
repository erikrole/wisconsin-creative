import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

describe("Accountability dashboard source contract", () => {
  it("frames the page as the leaderboard people should avoid", () => {
    const page = source("src/app/(app)/accountability/page.tsx");
    const spotlight = source("src/app/(app)/accountability/AccountabilitySpotlight.tsx");

    expect(page).toContain("The leaderboard nobody wants to join");
    expect(spotlight).toContain("The leaderboard nobody wants to lead");
    expect(spotlight).toContain("Wrong leaderboard");
    expect(spotlight).toContain("No one made the board. Beautifully boring.");
  });

  it("uses people-first podium cards and reduced-motion-safe state changes", () => {
    const spotlight = source("src/app/(app)/accountability/AccountabilitySpotlight.tsx");
    const client = source("src/app/(app)/accountability/AccountabilityClient.tsx");

    expect(spotlight).toContain("<UserAvatar");
    expect(spotlight).toContain("<AnimatePresence");
    expect(spotlight).toContain("useReducedMotion()");
    expect(spotlight).toContain('aria-live="polite"');
    expect(spotlight).toContain("reduceMotion ? false");
    expect(spotlight).toContain("data-accountability-jeer");
    expect(spotlight).not.toContain("podiumCopy");
    expect(client).toContain("jeers={data.spotlightJeers}");
  });

  it("serves one shared jeer draw from stable leaderboard state", () => {
    const route = source("src/app/api/accountability/route.ts");

    expect(route).toContain("selectAccountabilityJeers(report.leaderboard)");
    expect(route).toContain("spotlightJeers,");
  });

  it("keeps the leaderboard summary readable before revealing incident history", () => {
    const client = source("src/app/(app)/accountability/AccountabilityClient.tsx");

    expect(client).toContain('className="hidden xl:block"');
    expect(client).toContain('className="xl:hidden"');
    expect(client).toContain("Late-time pattern");
    expect(client).toContain("Return record");
    expect(client).toContain("The return record is the escape route");
    expect(client).toContain('"text-lg font-semibold tabular-nums"');
    expect(client).toContain("function returnRateBarColor(rate: number)");
    expect(client).toContain("Math.min(100, Math.max(50, rate))");
    expect(client).toContain("color-mix(in oklab, var(--red)");
    expect(client).toContain("backgroundColor: returnRateBarColor(person.onTimeRate)");
    expect(client).toContain("function IncidentHistory");
    expect(client).toContain("colSpan={5}");
    expect(client).toContain("aria-controls={historyId}");
    expect(client).not.toMatch(/<TableHead[^>]*>\s*Overdue now/);
    expect(client).not.toMatch(/<TableHead[^>]*>\s*Worst/);
    expect(client).not.toContain('role="button"');
    expect(client).not.toContain("tabIndex={0}");
  });

  it("keeps export and data-quality controls behind server-owned capabilities", () => {
    const client = source("src/app/(app)/accountability/AccountabilityClient.tsx");

    expect(client).toContain("data.capabilities.canExport ?");
    expect(client).toContain("data.capabilities.canManageExclusions");
    expect(client).toContain("canManageExclusions ? setExcludeTarget : undefined");
    expect(client).toContain("Admin-reviewed data-quality exclusions");
    expect(client).not.toContain("<BarChart");
  });
});
