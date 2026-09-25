import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("checkout merge UI source contracts", () => {
  it("exposes the explicit staff repair surface without changing kiosk creation", () => {
    const list = source("src/components/BookingListPage.tsx");
    const dialog = source("src/components/CheckoutMergeDialog.tsx");
    expect(list).toContain('config.kind === "CHECKOUT" ? "Merge matching checkouts"');
    expect(list).toContain('"/api/checkouts/merge/preview"');
    expect(list).toContain("CheckoutMergeDialog");
    expect(list).toContain('item.status === mergeableStatus');
    expect(dialog).toContain('type="datetime-local"');
    expect(dialog).toContain("Return time");
    expect(dialog).toContain("Keep reservation link from");
    expect(dialog).toContain("allowContextOverrides: true");
  });
});
