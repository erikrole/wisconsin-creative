import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(path, "utf8");

describe("Items design-language contracts", () => {
  it("keeps item-type and advanced-filter targets at the 40px baseline", () => {
    const page = source("src/app/(app)/items/page.tsx");
    const toolbar = source("src/app/(app)/items/components/items-toolbar.tsx");
    const facetedFilter = source("src/app/(app)/items/faceted-filter.tsx");
    const columns = source("src/app/(app)/items/columns.tsx");

    expect(toolbar.match(/<ToggleGroupItem[^>]+className="h-10 px-3 text-xs"/g)).toHaveLength(4);
    expect(toolbar).not.toContain('className="h-9 px-3 text-xs"');
    expect(toolbar).toContain('<Label htmlFor="show-accessories" className="flex h-10 cursor-pointer');
    expect(facetedFilter).toContain('className="h-10 border-dashed"');
    expect(facetedFilter).not.toContain('className="h-9 border-dashed"');
    expect(facetedFilter).toContain('<PlusCircleIcon className="size-4" />');
    expect(page).toContain('className="hidden size-10 sm:flex"');
    expect(page.match(/className="h-10" onClick=\{options\.retry\}/g)).toHaveLength(3);
    expect(columns).toContain('className="-m-3 flex size-10 items-center justify-center"');
    expect(columns).toContain('className="size-10"');
  });

  it("uses Add item for both creation entry points", () => {
    const page = source("src/app/(app)/items/page.tsx");

    expect(page).toContain(">Add item</Button>");
    expect(page).toContain('actionLabel={canOfferCreateItem ? "Add item" : undefined}');
    expect(page).not.toContain(">New item</Button>");
    expect(page).not.toContain('"New item"');
    expect(page.match(/setShowCreate\(true\)/g)).toHaveLength(2);
  });

  it("renders authored Items table labels without an uppercase transform", () => {
    const table = source("src/app/(app)/items/data-table.tsx");
    const columns = source("src/app/(app)/items/columns.tsx");

    expect(table).toContain('"h-10 select-none text-[11px] text-muted-foreground group/th"');
    expect(table).not.toContain("uppercase tracking-wide");
    for (const label of ["Name", "Status", "Category", "Department", "Location"]) {
      expect(columns).toContain(`header: "${label}"`);
    }
  });

  it("uses semantic animated sort controls without replaying state icons on mount", () => {
    const table = source("src/app/(app)/items/data-table.tsx");

    expect(table).toContain('aria-sort={canSort ? (sorted === "asc" ? "ascending"');
    expect(table).toContain('<AnimatePresence initial={false} mode="popLayout">');
    expect(table).toContain('initial={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}');
    expect(table).toContain('transition={{ type: "spring", duration: 0.3, bounce: 0 }}');
    expect(table).not.toContain('onClick={canSort ? header.column.getToggleSortingHandler() : undefined}');
  });

  it("defaults the items list to most popular sort", () => {
    const filters = source("src/app/(app)/items/hooks/use-url-filters.ts");
    const toolbar = source("src/app/(app)/items/components/items-toolbar.tsx");
    const query = source("src/app/(app)/items/hooks/use-items-query.ts");

    expect(filters).toContain('export const DEFAULT_ITEMS_SORT_ID = "popular"');
    expect(filters).toContain("return defaultItemsSorting()");
    expect(filters).toContain("if (sorting.length > 0 && !isDefaultItemsSorting(sorting))");
    expect(toolbar.indexOf('{ value: "popular", label: "Most popular" }')).toBeLessThan(
      toolbar.indexOf('{ value: "assetTag", label: "Asset tag" }'),
    );
    expect(toolbar).toContain("sorting[0]?.id ?? DEFAULT_ITEMS_SORT_ID");
    expect(toolbar).toContain("onSortingChange([{ id: value, desc: false }])");
    expect(toolbar).not.toContain('onSortingChange(value === "assetTag" ? []');
    expect(query).toContain("normalizeItemsSorting(deps.sorting)");
    expect(query).toContain('params.set("sort", sorting[0]!.id)');

    const route = source("src/app/api/assets/route.ts");
    const itemsView = source("ios/Wisconsin/Views/ItemsView.swift");
    expect(route).toContain('sortParam || "popular"');
    expect(itemsView).toContain("var sortOption: SortOption = .popular");
    expect(itemsView).toContain("private var isDefault: Bool { selected == .popular }");
  });

  it("snaps empty sort to most popular and sends item kind on select-all matching", () => {
    const filters = source("src/app/(app)/items/hooks/use-url-filters.ts");
    const page = source("src/app/(app)/items/page.tsx");
    const table = source("src/app/(app)/items/data-table.tsx");

    expect(filters).toContain("export function normalizeItemsSorting");
    expect(filters).toContain("return sorting.length === 0 ? defaultItemsSorting() : sorting");
    expect(page).toContain("normalizeItemsSorting(next)");
    expect(page).toContain('params.set("item_type", filters.itemType)');
    expect(page).toContain("Object.keys(rowSelection).filter((k) => rowSelection[k])");
    expect(table).toContain("enableRowSelection: true");
    expect(table).not.toContain("enableRowSelection: (row) => !isBulkRowId(row.original.id)");
  });

  it("gives mobile rows and favorite state precise tactile and contextual feedback", () => {
    const table = source("src/app/(app)/items/data-table.tsx");
    const columns = source("src/app/(app)/items/columns.tsx");

    expect(table).toContain("transition-[background-color,scale] active:scale-[0.96]");
    expect(columns).toContain('key={asset.isFavorited ? "favorited" : "not-favorited"}');
    expect(columns).toContain("outline-black/10 dark:outline-white/10");
  });
});
