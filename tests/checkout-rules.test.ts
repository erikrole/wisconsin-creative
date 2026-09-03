import { describe, it, expect } from "vitest";
import { BookingStatus } from "@prisma/client";
import { canPerformBookingAction, getAllowedBookingActions, type CheckoutAction } from "@/lib/services/booking-rules";

const admin = { id: "admin-1", role: "ADMIN" as const };
const staff = { id: "staff-1", role: "STAFF" as const };
const owner = { id: "student-1", role: "STUDENT" as const };
const otherStudent = { id: "student-2", role: "STUDENT" as const };

function makeCheckout(status: BookingStatus, requesterId = "student-1", createdById = "staff-1") {
  return {
    kind: "CHECKOUT" as const,
    status,
    requesterUserId: requesterId,
    createdBy: createdById,
  };
}

describe("canPerformBookingAction", () => {
  // ── Cross-kind validation ──
  it("allows edit on BOOKED reservation (unified function works for all kinds)", () => {
    const reservation = { kind: "RESERVATION" as const, status: BookingStatus.BOOKED, requesterUserId: "u1", createdBy: "u1" };
    expect(canPerformBookingAction(admin, reservation, "edit").allowed).toBe(true);
  });

  // ── Terminal states (COMPLETED, CANCELLED) ──
  describe("terminal states", () => {
    for (const status of [BookingStatus.COMPLETED, BookingStatus.CANCELLED]) {
      for (const action of ["edit", "extend", "cancel", "checkin", "open"] as CheckoutAction[]) {
        it(`rejects ${action} on ${status} checkout`, () => {
          const result = canPerformBookingAction(admin, makeCheckout(status), action);
          expect(result.allowed).toBe(false);
          expect(result.reason).toContain(status);
        });
      }
    }
  });

  // ── BOOKED state ──
  describe("BOOKED state", () => {
    const booking = makeCheckout("BOOKED");

    it("allows admin to edit", () => {
      expect(canPerformBookingAction(admin, booking, "edit").allowed).toBe(true);
    });

    it("allows staff to edit", () => {
      expect(canPerformBookingAction(staff, booking, "edit").allowed).toBe(true);
    });

    it("allows owner (requester) to edit", () => {
      expect(canPerformBookingAction(owner, booking, "edit").allowed).toBe(true);
    });

    it("denies non-owner student from editing", () => {
      expect(canPerformBookingAction(otherStudent, booking, "edit").allowed).toBe(false);
    });

    it("allows admin to cancel", () => {
      expect(canPerformBookingAction(admin, booking, "cancel").allowed).toBe(true);
    });

    it("allows owner to cancel BOOKED", () => {
      expect(canPerformBookingAction(owner, booking, "cancel").allowed).toBe(true);
    });

    it("denies checkin on BOOKED", () => {
      expect(canPerformBookingAction(admin, booking, "checkin").allowed).toBe(false);
    });

    it("allows open action", () => {
      expect(canPerformBookingAction(admin, booking, "open").allowed).toBe(true);
    });

    it("allows extend", () => {
      expect(canPerformBookingAction(staff, booking, "extend").allowed).toBe(true);
    });
  });

  // ── PENDING_PICKUP state ──
  describe("PENDING_PICKUP state", () => {
    const booking = makeCheckout("PENDING_PICKUP");

    it("allows staff or owner to edit, cancel, and transfer before kiosk pickup", () => {
      expect(canPerformBookingAction(staff, booking, "edit").allowed).toBe(true);
      expect(canPerformBookingAction(staff, booking, "cancel").allowed).toBe(true);
      expect(canPerformBookingAction(staff, booking, "transfer-owner").allowed).toBe(true);
      expect(canPerformBookingAction(owner, booking, "edit").allowed).toBe(true);
      expect(canPerformBookingAction(owner, booking, "cancel").allowed).toBe(true);
      expect(canPerformBookingAction(owner, booking, "transfer-owner").allowed).toBe(true);
    });

    it("does not expose checkout execution actions before kiosk pickup", () => {
      expect(canPerformBookingAction(staff, booking, "extend").allowed).toBe(false);
      expect(canPerformBookingAction(staff, booking, "checkin").allowed).toBe(false);
      expect(canPerformBookingAction(staff, booking, "open").allowed).toBe(false);
    });

    it("denies non-owner students", () => {
      expect(canPerformBookingAction(otherStudent, booking, "edit").allowed).toBe(false);
      expect(canPerformBookingAction(otherStudent, booking, "cancel").allowed).toBe(false);
    });
  });

  // ── OPEN state ──
  describe("OPEN state", () => {
    const booking = makeCheckout("OPEN");

    for (const actor of [admin, staff, owner]) {
      it(`denies ${actor.role.toLowerCase()} normal cancellation while custody is OPEN`, () => {
        const result = canPerformBookingAction(actor, booking, "cancel");
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain("not available in OPEN state");
      });
    }

    it("denies app/web checkin because returns are kiosk-only", () => {
      const result = canPerformBookingAction(owner, booking, "checkin");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("checkin");
    });

    it("denies staff app/web checkin because returns are kiosk-only", () => {
      expect(canPerformBookingAction(staff, booking, "checkin").allowed).toBe(false);
    });

    it("denies non-owner student from checking in", () => {
      expect(canPerformBookingAction(otherStudent, booking, "checkin").allowed).toBe(false);
    });

    it("allows owner to edit OPEN checkout", () => {
      expect(canPerformBookingAction(owner, booking, "edit").allowed).toBe(true);
    });

    it("denies open action on already-OPEN checkout", () => {
      expect(canPerformBookingAction(admin, booking, "open").allowed).toBe(false);
    });
  });

  // ── Ownership via createdBy ──
  describe("ownership via createdBy", () => {
    const booking = makeCheckout("OPEN", "other-user", "student-1");

    it("allows creator to edit even when not requester", () => {
      expect(canPerformBookingAction(owner, booking, "edit").allowed).toBe(true);
    });
  });

  describe("shared custody", () => {
    const booking = { ...makeCheckout("OPEN"), custodyScope: "SHARED" as const };

    it("lets staff manage shared custody without exposing personal-owner actions", () => {
      expect(canPerformBookingAction(staff, booking, "manage-custody").allowed).toBe(true);
      expect(canPerformBookingAction(staff, booking, "edit").allowed).toBe(true);
      expect(canPerformBookingAction(staff, booking, "transfer-owner").allowed).toBe(false);
      expect(canPerformBookingAction(staff, booking, "nudge").allowed).toBe(false);
    });

    it("does not give the retained requester or creator shared-checkout mutation rights", () => {
      expect(canPerformBookingAction(owner, booking, "edit").allowed).toBe(false);
      expect(canPerformBookingAction(owner, booking, "manage-custody").allowed).toBe(false);
    });
  });
});

describe("getAllowedActions", () => {
  it("returns correct actions for OPEN checkout as admin", () => {
    const booking = makeCheckout("OPEN");
    const actions = getAllowedBookingActions(admin, booking);
    expect(actions).toContain("edit");
    expect(actions).toContain("extend");
    expect(actions).not.toContain("cancel");
    expect(actions).not.toContain("checkin");
    expect(actions).not.toContain("open");
    expect(actions).toContain("manage-custody");
  });

  it("returns correct actions for BOOKED checkout as owner", () => {
    const booking = makeCheckout("BOOKED");
    const actions = getAllowedBookingActions(owner, booking);
    expect(actions).toContain("edit");
    expect(actions).toContain("extend");
    expect(actions).toContain("cancel");
    expect(actions).toContain("open");
    expect(actions).not.toContain("checkin");
  });

  it("returns edit, cancel, and transfer for pending-pickup checkout as owner", () => {
    const booking = makeCheckout("PENDING_PICKUP");
    expect(getAllowedBookingActions(owner, booking)).toEqual(["edit", "cancel", "transfer-owner"]);
  });

  it("returns empty array for COMPLETED checkout", () => {
    const booking = makeCheckout("COMPLETED");
    expect(getAllowedBookingActions(admin, booking)).toEqual([]);
  });

  it("returns empty array for CANCELLED checkout", () => {
    const booking = makeCheckout("CANCELLED");
    expect(getAllowedBookingActions(admin, booking)).toEqual([]);
  });

  it("student non-owner gets no actions on OPEN", () => {
    const booking = makeCheckout("OPEN");
    // Student cancel is denied, other actions require ownership
    const actions = getAllowedBookingActions(otherStudent, booking);
    expect(actions).toEqual([]);
  });
});
