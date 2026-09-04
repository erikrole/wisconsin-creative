import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(path, "utf8");

describe("Bookings interaction-detail contracts", () => {
  it("keeps scope, view, creation, recovery, and pagination controls on the 40px baseline", () => {
    const page = source("src/app/(app)/bookings/page.tsx");
    const list = source("src/components/BookingListPage.tsx");

    expect(page.match(/className="h-10 px-3 text-xs"/g)).toHaveLength(2);
    expect(page.match(/className="size-10 p-0"/g)).toHaveLength(2);
    expect(page).toContain('<Link href="/reservations/new">New reservation</Link>');
    expect(page).toContain('<Button className="h-10" asChild>');
    expect(list).not.toContain("hideNewButton");
    expect(list).toContain('className="h-10 shrink-0"');
    expect(list.match(/className=\{page.*"h-10/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("uses semantic sortable controls with contextual state motion", () => {
    const sort = source("src/components/booking-list/SortHeader.tsx");

    expect(sort).toContain('aria-sort={isActive ? (dir === "asc" ? "ascending" : "descending") : "none"}');
    expect(sort).toContain('<AnimatePresence initial={false} mode="popLayout">');
    expect(sort).toContain('initial={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}');
    expect(sort).toContain('transition={{ type: "spring", duration: 0.3, bounce: 0 }}');
  });

  it("gives booking cards and mobile rows precise tactile feedback", () => {
    const card = source("src/components/booking-list/BookingCard.tsx");
    const row = source("src/components/booking-list/BookingRow.tsx");

    expect(card).toContain("transition-[background-color,box-shadow,scale]");
    expect(card).toContain("hover:shadow-sm active:scale-[0.96]");
    expect(row).toContain("transition-[background-color,scale] active:scale-[0.96]");
  });

  it("keeps card selection beside, not beneath, the overflow action", () => {
    const card = source("src/components/booking-list/BookingCard.tsx");

    expect(card).toContain('className="absolute right-3 top-3 z-20 flex items-center gap-1"');
    expect(card).toContain('className="flex items-center justify-between gap-2 mb-2.5 pr-20"');
    expect(card).not.toContain('className="absolute right-3 top-3 z-20" onClick');
  });

  it("uses neutral image outlines for booking requester avatars", () => {
    const card = source("src/components/booking-list/BookingCard.tsx");
    const row = source("src/components/booking-list/BookingRow.tsx");

    expect(card).toContain("outline-black/10 dark:outline-white/10");
    expect(card).not.toContain('className="border border-border shrink-0"');
    expect(row.match(/outline-black\/10 dark:outline-white\/10/g)).toHaveLength(3);
  });
});
