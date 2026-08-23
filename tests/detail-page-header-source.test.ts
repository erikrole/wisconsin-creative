import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(path, "utf8");

const DETAIL_HEADER_CONSUMERS = [
  "src/app/(app)/users/[id]/page.tsx",
  "src/app/(app)/items/[id]/_components/ItemHeader.tsx",
  "src/app/(app)/bulk-inventory/[id]/_components/BulkSkuHeader.tsx",
  "src/components/booking-details/BookingHeader.tsx",
];

describe("Detail page header contracts", () => {
  it("keeps every detail route on the shared primitive", () => {
    for (const path of DETAIL_HEADER_CONSUMERS) {
      const file = source(path);
      expect(file, path).toContain('from "@/components/DetailPageHeader"');
      expect(file, path).toContain("<DetailPageHeader");
    }
  });

  it("does not let a detail route re-fork the header shell", () => {
    // The exact shell string these four had each reimplemented by hand.
    const shell = "rounded-lg border border-border/50 bg-card px-4 py-4 shadow-xs sm:px-5";
    expect(source("src/components/DetailPageHeader.tsx")).toContain(shell);

    // The primitive owns the header element. A consumer may still echo the
    // shell classes on a loading skeleton so the card does not jump on load,
    // but it must not render a competing <header> of its own.
    for (const path of DETAIL_HEADER_CONSUMERS) {
      expect(source(path), path).not.toMatch(/<header[\s>]/);
    }
  });

  it("renders detail titles as a real h1 rather than a styled span", () => {
    const primitive = source("src/components/DetailPageHeader.tsx");
    expect(primitive).toContain('<h1 className="min-w-0 break-words">{title}</h1>');

    // The base h1 rule in globals.css wins over Tailwind size/weight utilities,
    // so restating the scale on a heading is dead code.
    expect(primitive).not.toMatch(/<h1[^>]*text-\[\d+px\]/);
    expect(primitive).not.toMatch(/<h1[^>]*font-(?:black|bold|extrabold)/);
  });

  it("keeps the global h1 rule that detail titles depend on", () => {
    const css = source("src/app/globals.css");
    expect(css).toMatch(/h1\s*\{[^}]*font-family:\s*var\(--font-heading\)/);
    expect(css).toMatch(/h1\s*\{[^}]*font-size:\s*var\(--text-3xl\)/);
  });

  it("keeps detail header action triggers at the 40px operational baseline", () => {
    // size="sm" resolves to h-8 (32px), which is below the documented minimum.
    const users = source("src/app/(app)/users/[id]/page.tsx");
    expect(users).toContain('className="h-10 gap-1.5 active:scale-[0.96]"');

    const booking = source("src/components/booking-details/BookingHeader.tsx");
    expect(booking).toContain('<Button variant="outline" className="h-10" onClick={onEdit}>');
    expect(booking).toContain('<Button variant="outline" className="h-10" onClick={onToggleExtend}>');

    const item = source("src/app/(app)/items/[id]/_components/ItemHeader.tsx");
    expect(item).not.toContain('<Button size="sm" variant="default" asChild>');
  });

  it("keeps the profile header free of decorative brand tint", () => {
    const users = source("src/app/(app)/users/[id]/page.tsx");
    expect(users).not.toContain("radial-gradient(ellipse at 0% 0%");
    expect(users).not.toContain("rgba(160,0,0,0.045)");
  });

  it("lets a route choose the breakpoint its action column needs", () => {
    const primitive = source("src/components/DetailPageHeader.tsx");
    expect(primitive).toContain("sideBySideAt");
    expect(primitive).toContain("sm:flex-row");
    expect(primitive).toContain("lg:flex-row");

    // Bulk SKU has two compact buttons and stayed on sm; moving it to the lg
    // default cost 56px of vertical space at tablet width.
    expect(source("src/app/(app)/bulk-inventory/[id]/_components/BulkSkuHeader.tsx"))
      .toContain('sideBySideAt="sm"');
  });

  it("keeps the booking summary facts inside the header footer slot", () => {
    const primitive = source("src/components/DetailPageHeader.tsx");
    expect(primitive).toContain("footer");
    expect(primitive).toContain('<div className="mt-4 border-t border-border/50 pt-4">{footer}</div>');

    const booking = source("src/components/booking-details/BookingHeader.tsx");
    expect(booking).toContain('aria-label="Booking summary"');
    expect(booking).toContain("footer={");
  });
});
