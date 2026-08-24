import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(path, "utf8");

describe("Brand identity typography contracts", () => {
  it("keeps the semantic treatment family-only", () => {
    const css = source("src/app/globals.css");
    const rule = css.match(/\.brand-identity\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(rule).toContain("font-family: var(--font-heading)");
    expect(rule).not.toMatch(/font-(?:size|weight|style)|letter-spacing|color/);
    expect(css).toMatch(/body\s*\{[^}]*font-family:\s*var\(--font-body\)/);
  });

  it("brands shared primary row and report-link identity", () => {
    expect(source("src/components/ui/item.tsx"))
      .toContain('"brand-identity flex w-fit items-center');
    expect(source("src/app/(app)/reports/report-ui.tsx"))
      .toContain('"brand-identity font-medium text-foreground');
  });

  it("brands equipment and booking identity without promoting supporting metadata", () => {
    const shelf = source("src/components/equipment-picker/SelectedEquipmentShelf.tsx");
    expect(shelf).toContain('className="brand-identity max-w-[11rem] truncate text-sm font-medium">{asset.assetTag}');
    expect(shelf).toContain('className="brand-identity max-w-[11rem] truncate text-sm font-medium">{sku.name}');
    expect(shelf).toContain('className="text-xs font-semibold text-muted-foreground">Selected');

    const review = source("src/components/booking-wizard/WizardStep3.tsx");
    expect(review).toContain('className="brand-identity">{eventSummaryLabel(ev)}');
    expect(review).toContain('className="brand-identity text-sm font-semibold">{asset.assetTag}');
    expect(review).toContain('className="text-xs text-muted-foreground truncate"');

    const bookings = source("src/app/(app)/items/[id]/ItemBookingsTab.tsx");
    expect(bookings.match(/brand-identity/g)?.length).toBeGreaterThanOrEqual(7);
    expect(bookings).toContain("{booking.requester.name}");
  });

  it("brands person identity in organization, reporting, and activity rows", () => {
    const cases: Array<[string, string]> = [
      ["src/app/(app)/users/org-chart/page.tsx", 'className="brand-identity truncate font-medium group-hover:underline"'],
      ["src/app/(app)/reports/overdue/page.tsx", 'className="brand-identity font-semibold">{entry.name}'],
      ["src/app/(app)/settings/app-activity/page.tsx", 'className="brand-identity font-medium text-foreground">{user.name}'],
    ];

    for (const [path, expected] of cases) {
      expect(source(path), path).toContain(expected);
    }
  });
});
