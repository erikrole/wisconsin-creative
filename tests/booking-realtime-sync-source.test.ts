import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(path, "utf8");
}

describe("booking real-time sync source contract", () => {
  it("forces the persisted dashboard payload to refetch on mount", () => {
    const hook = source("src/hooks/use-dashboard-data.ts");

    expect(hook).toMatch(/queryKey:\s*dashboardKey,[\s\S]*?refetchOnMount:\s*"always"/);
    expect(hook).toContain("enabled: Boolean(userId)");
  });

  it("forces the dashboard stats overlay to refetch on mount", () => {
    const hook = source("src/hooks/use-dashboard-data.ts");

    expect(hook).toMatch(/queryKey:\s*statsKey,[\s\S]*?refetchOnMount:\s*"always"/);
  });

  it("forces booking detail cache to verify server truth on mount", () => {
    const hook = source("src/hooks/useBookingDetail.ts");

    expect(hook).toMatch(/queryKey,[\s\S]*?refetchOnMount:\s*"always"/);
  });

  it("forces shared booking lists to verify server truth on mount", () => {
    const list = source("src/components/BookingListPage.tsx");

    expect(list).toMatch(/queryKey:\s*\["bookingList", config\.kind, listUrl\],[\s\S]*?refetchOnMount:\s*"always"/);
  });

  it("polls the lightweight booking change signal instead of the heavy dashboard route", () => {
    const hook = source("src/hooks/use-booking-change-sync.ts");

    expect(hook).toContain('"/api/bookings/changes"');
    expect(hook).not.toContain('"/api/dashboard"');
    expect(hook).toContain("BOOKING_CHANGE_SYNC_INTERVAL_MS = 30_000");
    expect(hook).toContain("useOperationalPollingActivity(enabled && Boolean(userId))");
    expect(hook).toContain('pollingState !== "active"');
    expect(hook).toContain('pollingState === "idle"');
  });

  it("invalidates dashboard, stats, booking lists, and changed booking details", () => {
    const hook = source("src/hooks/use-booking-change-sync.ts");

    expect(hook).toContain("queryKey: dashboardQueryKey(userId)");
    expect(hook).toContain("queryKey: dashboardStatsQueryKey(userId)");
    expect(hook).toContain('queryKey: ["bookingList"]');
    expect(hook).toContain('queryKey: ["booking", bookingId]');
    expect(hook).toContain("BOOKING_CHANGE_SYNC_EVENT");
    expect(hook).toContain("window.dispatchEvent");
  });

  it("wires booking change sync into dashboard and the shared booking list", () => {
    const dashboard = source("src/app/(app)/page.tsx");
    const bookings = source("src/app/(app)/bookings/page.tsx");
    const list = source("src/components/BookingListPage.tsx");

    expect(dashboard).toContain('import { useBookingChangeSync } from "@/hooks/use-booking-change-sync"');
    expect(dashboard).toContain("const bookingSync = useBookingChangeSync();");
    expect(dashboard).toContain('import StatusIndicator from "@/components/ui/status-indicator"');
    expect(bookings).toContain('import { useBookingChangeSync } from "@/hooks/use-booking-change-sync"');
    expect(bookings).toContain("const bookingSync = useBookingChangeSync(Boolean(currentUser) && !currentUser?.preview?.readOnly);");
    expect(bookings).toContain("!currentUser?.preview?.readOnly");
    expect(bookings).toContain('import StatusIndicator from "@/components/ui/status-indicator"');
    expect(list).toContain('import { useBookingChangeSync } from "@/hooks/use-booking-change-sync"');
    expect(list).toContain("useBookingChangeSync(enableBookingChangeSync);");
    expect(bookings).toContain("enableBookingChangeSync={false}");
  });

  it("exposes booking sync health for visible status indicators", () => {
    const hook = source("src/hooks/use-booking-change-sync.ts");
    const detail = source("src/app/(app)/bookings/BookingDetailPage.tsx");
    const header = source("src/components/booking-details/BookingHeader.tsx");

    expect(hook).toContain("export type BookingChangeSyncStatus");
    expect(hook).toContain('"Live sync"');
    expect(hook).toContain('label: "Sync retrying"');
    expect(hook).toContain('"Offline"');
    expect(detail).toContain("const bookingSync = useBookingChangeSync();");
    expect(detail).toContain("syncStatus={bookingSync}");
    expect(header).toContain('import StatusIndicator from "@/components/ui/status-indicator"');
    expect(header).toContain("syncStatus?: BookingChangeSyncStatus");
  });

  it("refreshes an open booking detail sheet when its booking id changes", () => {
    const sheet = source("src/components/BookingDetailsSheet.tsx");

    expect(sheet).toContain('BOOKING_CHANGE_SYNC_EVENT');
    expect(sheet).toContain("window.addEventListener(BOOKING_CHANGE_SYNC_EVENT");
    expect(sheet).toContain("changedBookingIds.includes(bookingId)");
    expect(sheet).toContain("fetchBooking({ silent: true })");
  });
});
