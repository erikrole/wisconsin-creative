import { describe, expect, it } from "vitest";
import { BookingKind, BookingStatus, Role } from "@prisma/client";
import { canPerformBookingAction } from "@/lib/services/booking-rules";

const booking = (over: Partial<{ kind: BookingKind; status: BookingStatus; requesterUserId: string; createdBy: string }> = {}) => ({
  kind: BookingKind.CHECKOUT,
  status: BookingStatus.OPEN,
  requesterUserId: "owner-1",
  createdBy: "owner-1",
  ...over,
});

const admin = { id: "a", role: Role.ADMIN };
const staff = { id: "s", role: Role.STAFF };
const owner = { id: "owner-1", role: Role.STUDENT };
const otherStudent = { id: "x", role: Role.STUDENT };

describe('canPerformBookingAction("view")', () => {
  it("allows staff and admin to view any booking", () => {
    expect(canPerformBookingAction(admin, booking(), "view").allowed).toBe(true);
    expect(canPerformBookingAction(staff, booking(), "view").allowed).toBe(true);
  });

  it("allows the owner to view their own booking", () => {
    expect(canPerformBookingAction(owner, booking(), "view").allowed).toBe(true);
  });

  it("denies a non-owner student", () => {
    expect(canPerformBookingAction(otherStudent, booking(), "view").allowed).toBe(false);
  });

  it("allows viewing COMPLETED and CANCELLED bookings (empty action sets)", () => {
    for (const status of [BookingStatus.COMPLETED, BookingStatus.CANCELLED]) {
      expect(canPerformBookingAction(admin, booking({ status }), "view").allowed).toBe(true);
      expect(canPerformBookingAction(owner, booking({ status }), "view").allowed).toBe(true);
      expect(canPerformBookingAction(otherStudent, booking({ status }), "view").allowed).toBe(false);
    }
  });

  it("allows viewing reservations regardless of state", () => {
    expect(
      canPerformBookingAction(admin, booking({ kind: BookingKind.RESERVATION, status: BookingStatus.CANCELLED }), "view").allowed,
    ).toBe(true);
  });

  it("still gates real state-machine actions (view fix did not loosen them)", () => {
    // force-complete is ADMIN-only and only in OPEN state
    expect(canPerformBookingAction(admin, booking({ status: BookingStatus.OPEN }), "force-complete").allowed).toBe(true);
    expect(canPerformBookingAction(staff, booking({ status: BookingStatus.OPEN }), "force-complete").allowed).toBe(false);
    expect(canPerformBookingAction(admin, booking({ kind: BookingKind.RESERVATION, status: BookingStatus.BOOKED }), "force-checkout").allowed).toBe(true);
    expect(canPerformBookingAction(staff, booking({ kind: BookingKind.RESERVATION, status: BookingStatus.BOOKED }), "force-checkout").allowed).toBe(false);
    expect(canPerformBookingAction(admin, booking({ kind: BookingKind.RESERVATION, status: BookingStatus.COMPLETED }), "force-checkout").allowed).toBe(false);
    expect(canPerformBookingAction(owner, booking({ status: BookingStatus.COMPLETED }), "edit").allowed).toBe(false);
  });
});
