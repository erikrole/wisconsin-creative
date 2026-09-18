import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(path, "utf8");
}

describe("kiosk-only web affordance contract", () => {
  it("routes remote booking creation to reservations instead of checkout creation", () => {
    const dashboard = source("src/app/(app)/page.tsx");
    const list = source("src/components/BookingListPage.tsx");
    const newCheckout = source("src/app/(app)/checkouts/new/page.tsx");
    const eventDetail = source("src/app/(app)/events/[id]/page.tsx");
    const eventHeader = source("src/app/(app)/events/[id]/_components/EventHeader.tsx");
    const wizard = source("src/components/booking-wizard/BookingWizard.tsx");

    expect(dashboard).not.toContain("New checkout");
    expect(dashboard).not.toContain('"/checkouts/new"');
    expect(list).not.toContain('const base = config.kind === "CHECKOUT"');
    expect(newCheckout).toContain('redirect(qs ? `/reservations/new?${qs}` : "/reservations/new")');
    expect(eventHeader).toContain("Reserve gear for this event");
    expect(eventDetail).not.toContain("Checkout to this event");
    expect(eventDetail).not.toContain("/checkouts?title=");
    expect(eventDetail).not.toContain("/checkouts?create=true");
    expect(eventDetail).toContain("/reservations?title=");
    expect(eventHeader).not.toContain("/checkouts?create=true");
    expect(wizard).not.toContain("/api/checkouts");
    expect(wizard).not.toContain("CHECKOUT_CONFIG");
  });

  it("keeps reservation conversion and web return controls out of active UI surfaces", () => {
    const dashboardColumn = source("src/app/(app)/dashboard/my-gear-column.tsx");
    const bookingsPage = source("src/app/(app)/bookings/page.tsx");
    const detail = source("src/app/(app)/bookings/BookingDetailPage.tsx");
    const sheet = source("src/components/BookingDetailsSheet.tsx");

    for (const text of [dashboardColumn, bookingsPage, detail, sheet]) {
      expect(text).not.toContain("/api/reservations/${bookingId}/convert");
      expect(text).not.toContain("/api/reservations/${booking.id}/convert");
      expect(text).not.toContain("Start checkout");
      expect(text).not.toContain("Convert to checkout");
      expect(text).not.toContain("Check in all");
    }
  });
});
