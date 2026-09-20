import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("app shell quick search source", () => {
  it("uses the shared item-title fallback for quick search results", () => {
    const source = readFileSync("src/components/AppShell.tsx", "utf8");

    expect(source).toContain('import { assetSearchTitle } from "@/lib/search-result-title";');
    expect(source).toContain("name?: string | null;");
    expect(source).toContain("brand?: string | null;");
    expect(source).toContain("model?: string | null;");
    expect(source).toContain("type?: string | null;");
    expect(source).toContain("title: assetSearchTitle(item)");
    expect(source).not.toContain('title: item.assetTag ?? "Untitled item"');
  });

  it("only opens quick search from explicit shortcuts and triggers", () => {
    const source = readFileSync("src/components/AppShell.tsx", "utf8");

    expect(source).toContain('e.key === "k"');
    expect(source).toContain("setCmdOpen(true)");
    expect(source).not.toContain("keyboardOwnedTargetSelector");
    expect(source).not.toContain("function isKeyboardOwnedTarget");
    expect(source).not.toContain("e.key.length === 1");
    expect(source).not.toContain("setCmdQuery(e.key)");
  });

  it("uses shared named partial-results visibility for degraded quick search sources", () => {
    const source = readFileSync("src/components/AppShell.tsx", "utf8");

    expect(source).toContain('import { OperationalPartialResultsAlert } from "@/components/OperationalFeedback";');
    expect(source).toContain("const [cmdPartialFailures, setCmdPartialFailures] = useState<string[]>([]);");
    expect(source).toContain("failures.push(SEARCH_RESULT_SOURCES.items)");
    expect(source).toContain("failures.push(SEARCH_RESULT_SOURCES.checkouts)");
    expect(source).toContain("failures.push(SEARCH_RESULT_SOURCES.reservations)");
    expect(source).toContain("failures.push(SEARCH_RESULT_SOURCES.users)");
    expect(source).toContain("failures.push(SEARCH_RESULT_SOURCES.guides)");
    expect(source).toContain("/api/resources?q=");
    expect(source).toContain('heading="Guides"');
    expect(source).toContain("<OperationalPartialResultsAlert");
    expect(source).toContain('failureLabel="Unavailable result types"');
    expect(source).not.toContain("Some result types could not load. Showing available matches.");
  });
});
