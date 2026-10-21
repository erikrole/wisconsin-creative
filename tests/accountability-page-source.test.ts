import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("Accountability dashboard source contract", () => {
  it("uses plain wording with no joke labels or podium", () => {
    const page = source("src/app/(app)/accountability/page.tsx");
    const client = source("src/app/(app)/accountability/AccountabilityClient.tsx");
    const route = source("src/app/api/accountability/route.ts");

    expect(page).toContain("Who returned gear late, and how often");
    expect(client).not.toContain("AccountabilitySpotlight");
    expect(client).not.toContain("spotlightJeers");
    expect(route).not.toContain("Jeers");
    expect(client).not.toMatch(/nobody wants|escape route|receipts|Fine print/);
  });

  it("keeps the leaderboard summary readable before revealing incident history", () => {
    const client = source("src/app/(app)/accountability/AccountabilityClient.tsx");

    expect(client).toContain('className="hidden xl:block"');
    expect(client).toContain('className="xl:hidden"');
    expect(client).toContain("Time late");
    expect(client).toContain("On time");
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
    expect(client).toContain("Find a person");
    expect(client).toContain("You’re #");
    expect(client).toContain("syncUrl(");
    expect(client).toContain("currently overdue checkouts");
    expect(client).toContain('label: "Times late"');
    expect(client).not.toContain("<BarChart");
  });
});
