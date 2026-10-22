import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Regression guards for the fast-typing fixes: search inputs must keep focus
// and previous results must stay visible while a changed query refetches.
// Root cause of the original bug: query-key changes flipped isLoading, which
// swapped the whole table (including the focused search input) for a skeleton.

describe("DebouncedSearchInput contract", () => {
  const source = readFileSync("src/components/DebouncedSearchInput.tsx", "utf8");

  it("keeps keystrokes local and commits on a debounce", () => {
    expect(source).toContain("const [text, setText] = useState(value);");
    expect(source).toContain("timerRef.current = setTimeout(() => commit(next), delay);");
  });

  it("commits immediately on clear so emptying the field feels instant", () => {
    expect(source).toContain('if (next === "") {');
    expect(source).toContain("commit(next);");
  });

  it("adopts external value changes (clear-all, browser nav) and cancels pending commits", () => {
    expect(source).toContain("if (value === lastCommittedRef.current) return;");
    expect(source).toContain("cancelPending();");
    expect(source).toContain("setText(value);");
  });

  it("flushes on Enter and clears on Escape before page-level handlers blur the field", () => {
    expect(source).toContain('if (e.key === "Enter")');
    expect(source).toContain('e.key === "Escape"');
    expect(source).toContain("e.stopPropagation();");
  });
});

describe("items page search stability", () => {
  it("keeps previous rows while a changed filter/search refetches", () => {
    const source = readFileSync("src/app/(app)/items/hooks/use-items-query.ts", "utf8");
    expect(source).toContain("placeholderData: keepPreviousData");
  });

  it("mounts the toolbar outside the loading/empty/error conditional", () => {
    const source = readFileSync("src/app/(app)/items/page.tsx", "utf8");
    const toolbarIndex = source.indexOf("<ItemsToolbar");
    const conditionalIndex = source.indexOf("{pageLoading ? (");
    expect(toolbarIndex).toBeGreaterThan(-1);
    expect(conditionalIndex).toBeGreaterThan(-1);
    expect(toolbarIndex).toBeLessThan(conditionalIndex);
  });

  it("uses the debounced search input instead of a raw controlled input", () => {
    const source = readFileSync("src/app/(app)/items/components/items-toolbar.tsx", "utf8");
    expect(source).toContain("<DebouncedSearchInput");
    expect(source).not.toContain("onChange={(e) => onSearchChange(e.target.value)}");
  });

  it("no longer routes the toolbar through DataTable, which unmounted with it", () => {
    const source = readFileSync("src/app/(app)/items/data-table.tsx", "utf8");
    expect(source).not.toContain("toolbar");
    expect(source).not.toContain("bulkBar");
  });
});

describe("kits page search stability", () => {
  it("keeps previous rows while a changed search refetches", () => {
    const source = readFileSync("src/app/(app)/kits/hooks/use-kits-query.ts", "utf8");
    expect(source).toContain("keepPreviousData: true");
  });

  it("uses the debounced search input", () => {
    const source = readFileSync("src/app/(app)/kits/page.tsx", "utf8");
    expect(source).toContain("<DebouncedSearchInput");
    expect(source).not.toContain("useDebounce");
  });
});

describe("labels page search stability", () => {
  it("keeps previous rows and uses the debounced search input", () => {
    const source = readFileSync("src/app/(app)/labels/LabelsHelper.tsx", "utf8");
    expect(source).toContain("keepPreviousData: true");
    expect(source).toContain("<DebouncedSearchInput");
    expect(source).not.toContain("useDebounce");
  });
});

describe("global search page stability", () => {
  const source = readFileSync("src/app/(app)/search/page.tsx", "utf8");

  it("uses the debounced search input as the single committed query source", () => {
    expect(source).toContain("<DebouncedSearchInput");
    expect(source).not.toContain("debouncedQuery");
  });

  it("keeps previous results visible while a new search is in flight", () => {
    expect(source).toContain("{loading && results.length === 0 && (");
    expect(source).toContain("{results.length > 0 && (");
    expect(source).toContain("aria-busy={loading}");
  });
});
