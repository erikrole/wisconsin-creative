import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("full search page source", () => {
  it("does not render blank item result titles when item identity fields are sparse", () => {
    const source = readFileSync("src/app/(app)/search/page.tsx", "utf8");

    expect(source).toContain('import { assetSearchTitle } from "@/lib/search-result-title";');
    expect(source).toContain("title: assetSearchTitle(item)");
  });

  it("uses shared named partial-results visibility for degraded search sources", () => {
    const source = readFileSync("src/app/(app)/search/page.tsx", "utf8");

    expect(source).toContain('import { OperationalPartialResultsAlert } from "@/components/OperationalFeedback";');
    expect(source).toContain("const [partialFailures, setPartialFailures] = useState<string[]>([]);");
    expect(source).toContain("failures.push(SEARCH_RESULT_SOURCES.items)");
    expect(source).toContain("failures.push(SEARCH_RESULT_SOURCES.checkouts)");
    expect(source).toContain("failures.push(SEARCH_RESULT_SOURCES.reservations)");
    expect(source).toContain("failures.push(SEARCH_RESULT_SOURCES.users)");
    expect(source).toContain("<OperationalPartialResultsAlert");
    expect(source).toContain('failureLabel="Unavailable result types"');
    expect(source).toContain('actionLabel="Retry"');
    expect(source).toContain("onAction={() => { void runSearch(query); }}");
    expect(source).not.toContain("Some result types could not load. Showing available matches.");
  });

  it("retries complete failures and preserves trustworthy same-query results", () => {
    const source = readFileSync("src/app/(app)/search/page.tsx", "utf8");

    expect(source).toContain('const resultsQueryRef = useRef("")');
    expect(source).toContain("resultsQueryRef.current === trimmed && resultsRef.current.length > 0");
    expect(source).toContain("setPartialFailures(Object.values(SEARCH_RESULT_SOURCES))");
    expect(source).toContain('failedResultTypes.add("item")');
    expect(source).toContain("for (const previous of resultsRef.current)");
    expect(source).toContain('title={searchError === "network" ? "Can\\u2019t connect" : "Search did not load"}');
    expect(source).toContain('actionLabel="Retry"');
  });
});
