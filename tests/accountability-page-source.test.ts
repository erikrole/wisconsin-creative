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

  it("leads with goals: overdue now, your record, then repeat late returns", () => {
    const client = source("src/app/(app)/accountability/AccountabilityClient.tsx");

    expect(client).toContain('title="Overdue now"');
    expect(client).toContain("Your record");
    expect(client).toContain("Repeat late returns");
    expect(client).toContain("lateEventCount >= 2");
    expect(client).toContain("More filters");
    expect(client).toContain("function IncidentHistory");
    expect(client).toContain("colSpan={4}");
    expect(client).toContain("aria-controls={historyId}");
    expect(client).not.toContain("returnRateBarColor");
    expect(client).not.toContain("ReportMetricGrid");
    expect(client).not.toContain('role="button"');
    expect(client).not.toContain("tabIndex={0}");
  });

  it("keeps export and data-quality controls behind server-owned capabilities", () => {
    const client = source("src/app/(app)/accountability/AccountabilityClient.tsx");

    expect(client).toContain("data.capabilities.canExport ?");
    expect(client).toContain("data.capabilities.canManageExclusions");
    expect(client).toContain("canManageExclusions ? setExcludeTarget : undefined");
    expect(client).toContain("Find a person");
    expect(client).toContain("syncUrl(");
    expect(client).toContain("currently overdue checkouts");
    expect(client).not.toContain("<BarChart");
  });
});
