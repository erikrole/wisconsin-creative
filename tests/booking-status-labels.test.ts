import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { statusBadgeVariant, statusLabel } from "@/components/booking-details/helpers";
import { getStatusVisual } from "@/components/booking-list/types";
import {
  bookingStatusDisplay,
  bookingStatusLabel,
  bookingStatusVisual,
  operationalBookingStatus,
} from "@/lib/booking-status-display";

describe("booking status labels", () => {
  it("renders pending pickup as a first-class checkout state", () => {
    expect(bookingStatusLabel("PENDING_PICKUP", "CHECKOUT")).toBe("Pending pickup");
    expect(statusLabel("PENDING_PICKUP", "CHECKOUT")).toBe("Pending pickup");
    expect(statusBadgeVariant("PENDING_PICKUP", "CHECKOUT")).toBe("orange");
    expect(getStatusVisual("PENDING_PICKUP", false, "CHECKOUT")).toMatchObject({
      dot: "var(--orange)",
      label: "Pending pickup",
    });
  });

  it("derives Pending Pickup when a booked reservation reaches startsAt", () => {
    const now = new Date("2026-07-23T20:31:00.000Z");
    expect(operationalBookingStatus({
      kind: "RESERVATION",
      status: "BOOKED",
      startsAt: "2026-07-23T19:30:00.000Z",
    }, now)).toBe("PENDING_PICKUP");
    expect(operationalBookingStatus({
      kind: "RESERVATION",
      status: "BOOKED",
      startsAt: "2026-07-23T21:30:00.000Z",
    }, now)).toBe("BOOKED");
  });

  it("keeps terminal and overdue labels separate", () => {
    expect(statusLabel("CANCELLED", "CHECKOUT")).toBe("Cancelled");
    expect(statusLabel("COMPLETED", "RESERVATION")).toBe("Completed");
    expect(bookingStatusDisplay("BOOKED", "RESERVATION")).toEqual({
      label: "Reserved",
      variant: "purple",
    });
    expect(bookingStatusDisplay("OPEN", "CHECKOUT")).toEqual({
      label: "Checked out",
      variant: "blue",
    });
    expect(getStatusVisual("OPEN", true, "CHECKOUT")).toMatchObject({
      dot: "var(--red)",
      label: "Overdue",
    });
  });

  it("keeps booking detail and list visuals on the shared display helper", () => {
    expect(statusLabel("OPEN", "CHECKOUT")).toBe(bookingStatusLabel("OPEN", "CHECKOUT"));
    expect(statusBadgeVariant("BOOKED", "RESERVATION")).toBe(bookingStatusDisplay("BOOKED", "RESERVATION").variant);
    expect(getStatusVisual("OPEN", false, "CHECKOUT")).toMatchObject(bookingStatusVisual("OPEN", { kind: "CHECKOUT" }));
  });

  it("keeps item booking history from reintroducing local booking status labels", () => {
    const source = readFileSync(join(process.cwd(), "src/app/(app)/items/[id]/ItemBookingsTab.tsx"), "utf8");

    expect(source).toContain("bookingStatusDisplay");
    expect(source).not.toContain("function bookingStatusLabel");
    expect(source).not.toMatch(/case\s+"(?:CHECKED_OUT|RETURNED|CONVERTED|CLOSED)"/);
  });

  it("keeps global search status copy aligned with booking labels", () => {
    const source = readFileSync(join(process.cwd(), "src/app/(app)/search/page.tsx"), "utf8");

    expect(source).toContain('case "OPEN": return "Checked out"');
    expect(source).toContain('case "BOOKED": return "Reserved"');
    expect(source).not.toContain('case "OPEN": return "Checked Out"');
    expect(source).not.toContain('case "BOOKED": return "Booked"');
  });
});
