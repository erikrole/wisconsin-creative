import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(path, "utf8");
}

describe("Battery Ops experience source contract", () => {
  it("keeps numbered counts unit-derived and exposes explicit operational actions", () => {
    const page = source("src/app/(app)/bulk-inventory/batteries/page.tsx");

    expect(page).toContain("Numbered availability comes from unit status.");
    expect(page).toContain("Add units");
    expect(page).toContain("Adjust live count");
    expect(page).toContain("Edit metadata");
    expect(page).toContain("Show ${sku.counts.total} units");
    expect(page).not.toContain("Adjust numbered count");
  });

  it("lets receiving assign existing product metadata to the new unit range", () => {
    const page = source("src/app/(app)/bulk-inventory/batteries/page.tsx");
    const route = source("src/app/api/bulk-skus/batteries/route.ts");

    expect(page).toContain("Product metadata");
    expect(page).toContain("productId: addProductId || null");
    expect(route).toContain("assignedUnitCount: product._count.units");
    expect(route).toContain("productId: unit.productId");
  });
});
