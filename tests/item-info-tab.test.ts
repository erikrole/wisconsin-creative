import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import ItemInfoCard from "@/app/(app)/items/[id]/ItemInfoTab";
import {
  firmwareBadgeStatus,
  firmwareBadgeVariant,
  formatFirmwareDate,
  formatUsdDraft,
  getNormalizedExternalUrl,
  normalizeFirmwareVersion,
  normalizeUsdForDirty,
  parseUsdDraft,
} from "@/app/(app)/items/[id]/item-info-format";
import type { AssetDetail } from "@/app/(app)/items/[id]/types";
import { externalUrlHost, normalizeExternalUrl } from "@/lib/external-url";

function asset(overrides: Partial<AssetDetail> = {}): AssetDetail {
  return {
    id: "asset-1",
    updatedAt: "2026-10-01T12:00:00.000Z",
    assetTag: "CAM-001",
    name: "A7 IV body",
    type: "Camera",
    brand: "Sony",
    model: "ILCE-7M4",
    serialNumber: null,
    qrCodeValue: "QR-CAM-001",
    purchaseDate: null,
    purchasePrice: 2499.5,
    warrantyDate: null,
    residualValue: null,
    status: "AVAILABLE",
    computedStatus: "AVAILABLE",
    isFavorited: false,
    notes: null,
    linkUrl: "www.sony.com/a7iv",
    imageUrl: null,
    location: { id: "loc-1", name: "Camp Randall" },
    department: null,
    category: null,
    availableForReservation: true,
    availableForCheckout: true,
    availableForCustody: false,
    collaboratorVisible: false,
    metadata: { installedFirmwareVersion: "5.00" },
    activeBooking: null,
    hasBookingHistory: false,
    parentAsset: null,
    firmwareWatch: {
      id: "fw-1",
      productName: "Alpha 7 IV",
      brand: "Sony",
      model: "ILCE-7M4",
      sourceUrl: "https://www.sony.com/electronics/support/firmware",
      supportMode: "ACTIVE",
      supportNote: null,
      latestVersion: "6.00",
      latestReleaseDate: "2026-09-30",
      lastCheckedAt: "2026-10-20T15:00:00.000Z",
      lastError: null,
    },
    accessories: [],
    upcomingReservations: [],
    history: [],
    ...overrides,
  };
}

function render(item: AssetDetail, canEdit = true) {
  const client = new QueryClient();
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(
        TooltipProvider,
        null,
        createElement(ItemInfoCard, {
          asset: item,
          canEdit,
          currentUserRole: "ADMIN",
          categories: [],
          departments: [],
          locations: [{ id: "loc-1", name: "Camp Randall" }],
          onFieldSaved: () => undefined,
          onRefresh: () => undefined,
          onCategoriesChanged: () => undefined,
        }),
      ),
    ),
  );
}

describe("item info currency drafts", () => {
  it("accepts dollars with an optional sign, commas and up to two decimals", () => {
    expect(parseUsdDraft("$1,234.50")).toBe("1234.50");
    expect(parseUsdDraft(" 12 ")).toBe("12.00");
    expect(parseUsdDraft("")).toBe("");
  });

  it("rejects anything that is not a USD amount instead of guessing", () => {
    expect(() => parseUsdDraft("12.345")).toThrow("Enter a valid USD amount");
    expect(() => parseUsdDraft("abc")).toThrow("Enter a valid USD amount");
    expect(() => parseUsdDraft("-5")).toThrow("Enter a valid USD amount");
  });

  it("formats stored prices for editing and compares drafts by value", () => {
    expect(formatUsdDraft(2499.5)).toBe("2,499.50");
    expect(formatUsdDraft(null)).toBe("");
    expect(normalizeUsdForDirty("$2,499.50")).toBe(normalizeUsdForDirty("2499.5"));
  });
});

describe("item info product links", () => {
  it("normalizes bare hosts to https and refuses other schemes", () => {
    expect(normalizeExternalUrl("www.sony.com/a7iv")).toBe("https://www.sony.com/a7iv");
    expect(() => normalizeExternalUrl("ftp://files.sony.com")).toThrow("Enter a valid http or https URL");
    expect(externalUrlHost("https://www.sony.com/a7iv")).toBe("sony.com");
    expect(getNormalizedExternalUrl("www.sony.com/a7iv")).toBe("https://www.sony.com/a7iv");
    expect(getNormalizedExternalUrl("ftp://files.sony.com")).toBe("");
  });
});

describe("item info firmware status", () => {
  it("compares versions without leading v or padding noise", () => {
    expect(normalizeFirmwareVersion(" v5.00 ")).toBe(normalizeFirmwareVersion("5.00"));
    expect(firmwareBadgeVariant("5.00", "6.00")).toBe("orange");
    expect(firmwareBadgeVariant("6.00", "6.00")).toBe("green");
    expect(firmwareBadgeVariant("", "6.00")).toBe("gray");
    expect(firmwareBadgeStatus("5.00", "6.00")).toBe("Outdated");
    expect(firmwareBadgeStatus("6.00", "6.00")).toBe("Updated");
    expect(firmwareBadgeStatus("", "6.00")).toBe("Not recorded");
    expect(firmwareBadgeStatus("5.00", null)).toBe("Unknown");
  });

  it("shows a release date as the calendar day it was published, not shifted to Central", () => {
    expect(formatFirmwareDate("2026-09-30")).toBe("Sep 30, 2026");
    expect(formatFirmwareDate(null)).toBeNull();
    expect(formatFirmwareDate("not a date")).toBeNull();
  });
});

describe("item info card", () => {
  it("groups the sidebar into Product, Organization and Procurement with identity first", () => {
    const html = render(asset());

    expect(html).toContain("Identity");
    for (const label of ["Product", "Organization", "Procurement"]) expect(html).toContain(label);
    expect(html.indexOf("Identity")).toBeLessThan(html.indexOf("Procurement"));
  });

  it("edits the purchase price as a decimal USD field", () => {
    const html = render(asset());

    expect(html).toContain("Purchase price");
    expect(html).toContain('inputMode="decimal"');
    expect(html).toContain('value="2,499.50"');
  });

  it("shows the product link's host so the source is visible", () => {
    expect(render(asset())).toContain("sony.com");
  });

  it("shows the installed firmware and the newer release that is available", () => {
    const html = render(asset());

    expect(html).toContain("Firmware");
    expect(html).toContain("Edit installed firmware version, currently 5.00");
    expect(html).toContain("6.00 available");
  });

  it("asks for a firmware version when none is recorded and says nothing about updates", () => {
    const html = render(asset({ metadata: null }));

    expect(html).toContain("Set firmware");
    expect(html).not.toContain("available");
  });

  it("renders a missing serial number without crashing", () => {
    expect(() => render(asset({ serialNumber: null, firmwareWatch: null, metadata: null }))).not.toThrow();
  });
});
