import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const APP_SCAN_ROUTES = [
  {
    route: "src/app/api/checkouts/[id]/scan/route.ts",
    message: "Checkout scanning must be done at a kiosk",
  },
  {
    route: "src/app/api/checkouts/[id]/checkin-scan/route.ts",
    message: "Check-in scanning must be done at a kiosk",
  },
] as const;

const REMOVED_WEB_SCAN_FILES = [
  "src/app/(app)/scan/page.tsx",
  "src/app/(app)/scan/loading.tsx",
  "src/app/(app)/scan/_components/ScanControls.tsx",
  "src/app/(app)/scan/_components/ItemPreviewDrawer.tsx",
  "src/app/(app)/scan/_components/types.ts",
  "src/components/QrScanner.tsx",
  "src/hooks/use-scan-submission.ts",
  "src/lib/scan-feedback.ts",
] as const;

const STALE_WEB_SCAN_LINK_SURFACES = [
  "src/app/(app)/bookings/BookingDetailPage.tsx",
  "src/app/(app)/_home/HomeView.tsx",
  "src/components/AppShell.tsx",
] as const;

function sourceFor(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

describe("app scan route gate contract", () => {
  it("keeps booking execution scans gated to kiosk routes", () => {
    const drift = APP_SCAN_ROUTES.filter(({ route, message }) => {
      const source = sourceFor(route);
      return !/\bwithAuth\s*\(/.test(source) || !source.includes(message) || !/\bthrow\s+new\s+HttpError\s*\(\s*403\s*,/.test(source);
    }).map(({ route }) => route);

    expect(drift).toEqual([]);
  });

  it("removes the standalone web scan surface and camera triggers", () => {
    const remainingFiles = REMOVED_WEB_SCAN_FILES.filter((file) => existsSync(path.join(process.cwd(), file)));
    expect(remainingFiles).toEqual([]);

    const staleLinks = STALE_WEB_SCAN_LINK_SURFACES.filter((file) => sourceFor(file).includes("/scan"));
    expect(staleLinks).toEqual([]);

    const appShell = sourceFor("src/components/AppShell.tsx");
    expect(appShell).not.toContain('label: "Lookup"');
    expect(appShell).not.toContain('href: "/scan"');
    expect(appShell).not.toContain("ScanIcon");

    const searchPages = sourceFor("src/lib/search-pages.ts");
    expect(searchPages).not.toContain('id: "lookup"');
    expect(searchPages).not.toContain('href: "/scan"');

    expect(sourceFor("src/lib/breadcrumbs.ts")).not.toContain("scan:");

    const equipmentPicker = sourceFor("src/components/EquipmentPicker.tsx");
    expect(equipmentPicker).not.toContain("QrScanner");
    expect(equipmentPicker).not.toContain("Scan to add");
    expect(equipmentPicker).not.toContain("scannerOpen");

    const serializedForm = sourceFor("src/app/(app)/items/new-item-sheet/SerializedItemForm.tsx");
    expect(serializedForm).not.toContain("QrScanner");
    expect(serializedForm).not.toContain("Scan QR code");
  });
});
