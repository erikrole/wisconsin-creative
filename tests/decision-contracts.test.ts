import { describe, expect, it } from "vitest";
import { bookingStatusDisplay, bookingStatusVisual } from "@/lib/booking-status-display";
import {
  isValidVenueMappingPattern,
  sortVenueMappings,
  venueMappingMatches,
} from "@/lib/venue-mapping-contract";
import { getAllowedBookingActions } from "@/lib/booking-action-policy";
import { source } from "./_helpers/source";

describe("documented decision contracts", () => {
  it("D-025 keeps booking status labels display-only and kind-aware", () => {
    expect(bookingStatusDisplay("BOOKED", "RESERVATION")).toEqual({
      label: "Reserved",
      variant: "purple",
    });
    expect(bookingStatusDisplay("BOOKED", "CHECKOUT")).toEqual({
      label: "Reserved",
      variant: "purple",
    });
    expect(bookingStatusDisplay("OPEN", "CHECKOUT")).toMatchObject({
      label: "Checked out",
      variant: "blue",
    });
    expect(bookingStatusVisual("OPEN", { overdue: true, kind: "CHECKOUT" })).toMatchObject({
      label: "Overdue",
      variant: "red",
    });
  });

  it("D-027 keeps venue mappings admin-owned, regex-validated, and deterministic", () => {
    expect(isValidVenueMappingPattern("Camp Randall")).toBe(true);
    expect(isValidVenueMappingPattern("Camp (Randall")).toBe(false);
    expect(venueMappingMatches("Camp (Randall", "Camp Randall Stadium")).toBe(false);

    expect(sortVenueMappings([
      { id: "short", pattern: "Camp", priority: 5, createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "long", pattern: "Camp Randall", priority: 5, createdAt: "2026-01-02T00:00:00.000Z" },
      { id: "low", pattern: "Field House", priority: 1, createdAt: "2026-01-03T00:00:00.000Z" },
    ]).map((mapping) => mapping.id)).toEqual(["long", "short", "low"]);

    const routeSource = source("src/app/api/location-mappings/route.ts");
    const permissionsSource = source("src/lib/permissions.ts");
    expect(routeSource).toContain('requirePermission(user.role, "location_mapping", "view")');
    expect(routeSource).toContain("isValidVenueMappingPattern");
    expect(routeSource).toContain("sortVenueMappings");
    expect(permissionsSource).toMatch(/location_mapping:\s*{[\s\S]*view:\s*\["ADMIN"\][\s\S]*create:\s*\["ADMIN"\][\s\S]*delete:\s*\["ADMIN"\]/);
  });

  it("D-040 keeps app and web reservation-first while custody actions stay kiosk-only", () => {
    const staff = { id: "staff-1", role: "STAFF" };
    const owner = { id: "student-1", role: "STUDENT" };
    const openCheckout = {
      kind: "CHECKOUT" as const,
      status: "OPEN",
      requesterUserId: "student-1",
      createdBy: "staff-1",
    };
    const bookedReservation = {
      kind: "RESERVATION" as const,
      status: "BOOKED",
      requesterUserId: "student-1",
      createdBy: "staff-1",
    };

    expect(getAllowedBookingActions(staff, openCheckout, "CHECKOUT")).not.toContain("checkin");
    expect(getAllowedBookingActions(owner, openCheckout, "CHECKOUT")).not.toContain("checkin");
    expect(getAllowedBookingActions(staff, bookedReservation, "RESERVATION")).not.toContain("convert");
    expect(getAllowedBookingActions(owner, bookedReservation, "RESERVATION")).not.toContain("convert");
    expect(getAllowedBookingActions(staff, bookedReservation, "RESERVATION")).toContain("transfer-owner");
    expect(getAllowedBookingActions(owner, bookedReservation, "RESERVATION")).toContain("transfer-owner");

    const checkoutRouteSource = source("src/app/api/checkouts/route.ts");
    const convertRouteSource = source("src/app/api/reservations/[id]/convert/route.ts");
    const bookingRulesSource = source("src/lib/services/booking-rules.ts");
    expect(checkoutRouteSource).toContain("Direct checkout is only available at a kiosk");
    expect(convertRouteSource).toContain("Reservation pickup now happens at the kiosk custody boundary");
    expect(convertRouteSource).toContain("App/web cannot create checkout custody");
    expect(bookingRulesSource).toContain("checkin  |");
    expect(bookingRulesSource).toContain("kiosk only");
    expect(bookingRulesSource).toContain("convert  |");
  });
});
