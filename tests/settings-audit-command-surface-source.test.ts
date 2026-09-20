import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("Settings Audit command surface", () => {
  it("uses the shared operational toolbar and active filter chips", () => {
    const page = source("src/app/(app)/settings/audit/page.tsx");

    expect(page).toContain('OperationalToolbar');
    expect(page).toContain('OperationalActiveFilterChips');
    expect(page).toContain('type OperationalActiveFilter');
    expect(page).toContain('const activeFilters: OperationalActiveFilter[]');
    expect(page).toContain('label: `Entity: ${filters.entityType}`');
    expect(page).toContain('label: `Action: ${filters.action}`');
    expect(page).toContain('<OperationalActiveFilterChips filters={activeFilters} />');
    expect(page).not.toContain('rounded-md border border-border bg-muted/30 p-3 space-y-3');
  });

  it("uses shared shadcn table and empty-state composition", () => {
    const page = source("src/app/(app)/settings/audit/page.tsx");

    expect(page).toContain('import EmptyState from "@/components/EmptyState"');
    expect(page).toContain('TableHeader');
    expect(page).toContain('TableBody');
    expect(page).toContain('TableCell');
    expect(page).toContain('title={hasActiveFilters ? "No audit entries match" : "No audit entries yet"}');
    expect(page).not.toContain('<table className="w-full text-sm">');
  });
});
