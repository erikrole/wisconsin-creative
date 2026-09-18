import { describe, it, expect } from "vitest";
import { getAllowedBookingActions, type CheckoutAction } from "@/lib/booking-actions";

/* ───── Test helpers ───── */

const staff = { id: "staff-1", role: "STAFF" };
const admin = { id: "admin-1", role: "ADMIN" };
const owner = { id: "student-1", role: "STUDENT" };
const nonOwner = { id: "student-2", role: "STUDENT" };

function booking(status: string, requesterId = "student-1", creatorId = "staff-1") {
  return {
    status,
    requester: { id: requesterId },
    createdBy: creatorId,
  };
}

function getActions(actor: { id: string; role: string }, ctx: { status: string; requester?: { id: string }; createdBy?: string }) {
  return getAllowedBookingActions(actor, ctx, "CHECKOUT") as CheckoutAction[];
}

function has(actions: CheckoutAction[], action: CheckoutAction): boolean {
  return actions.includes(action);
}

/* ───── Tests ───── */

describe("getAllowedActionsClient", () => {
  describe("BOOKED state", () => {
    const ctx = booking("BOOKED");

    it("staff can edit, extend, cancel, open", () => {
      const actions = getActions(staff, ctx);
      expect(has(actions, "edit")).toBe(true);
      expect(has(actions, "extend")).toBe(true);
      expect(has(actions, "cancel")).toBe(true);
      expect(has(actions, "open")).toBe(true);
      expect(has(actions, "checkin")).toBe(false);
    });

    it("admin can edit, extend, cancel, open", () => {
      const actions = getActions(admin, ctx);
      expect(has(actions, "edit")).toBe(true);
      expect(has(actions, "cancel")).toBe(true);
      expect(has(actions, "open")).toBe(true);
    });

    it("owner (student) can edit, extend, cancel, open", () => {
      const actions = getActions(owner, ctx);
      expect(has(actions, "edit")).toBe(true);
      expect(has(actions, "cancel")).toBe(true);
      expect(has(actions, "open")).toBe(true);
    });

    it("non-owner student gets no actions", () => {
      const actions = getActions(nonOwner, ctx);
      expect(actions).toEqual([]);
    });
  });

  describe("PENDING_PICKUP state", () => {
    const ctx = booking("PENDING_PICKUP");

    it("staff can edit, cancel, transfer, and manage custody before pickup", () => {
      const actions = getActions(staff, ctx);
      expect(actions).toEqual(["edit", "cancel", "transfer-owner", "manage-custody"]);
    });

    it("owner can edit, cancel, and transfer awaiting pickup checkouts", () => {
      const actions = getActions(owner, ctx);
      expect(actions).toEqual(["edit", "cancel", "transfer-owner"]);
    });

    it("non-owner student gets no actions", () => {
      const actions = getActions(nonOwner, ctx);
      expect(actions).toEqual([]);
    });
  });

  describe("OPEN state", () => {
    const ctx = booking("OPEN");

    it("staff can edit and extend but cannot cancel or check in", () => {
      const actions = getActions(staff, ctx);
      expect(has(actions, "edit")).toBe(true);
      expect(has(actions, "extend")).toBe(true);
      expect(has(actions, "cancel")).toBe(false);
      expect(has(actions, "checkin")).toBe(false);
      expect(has(actions, "open")).toBe(false);
    });

    it("owner can edit and extend but NOT cancel or checkin", () => {
      const actions = getActions(owner, ctx);
      expect(has(actions, "edit")).toBe(true);
      expect(has(actions, "extend")).toBe(true);
      expect(has(actions, "checkin")).toBe(false);
      expect(has(actions, "cancel")).toBe(false);
    });

    it("non-owner student gets no actions", () => {
      const actions = getActions(nonOwner, ctx);
      expect(actions).toEqual([]);
    });
  });

  describe("COMPLETED state", () => {
    it("allows re-reserve for staff, admin, and owner", () => {
      const ctx = booking("COMPLETED");
      expect(getActions(staff, ctx)).toEqual(["duplicate"]);
      expect(getActions(admin, ctx)).toEqual(["duplicate"]);
      expect(getActions(owner, ctx)).toEqual(["duplicate"]);
      expect(getActions(nonOwner, ctx)).toEqual([]);
    });
  });

  describe("CANCELLED state", () => {
    it("returns empty for all roles", () => {
      const ctx = booking("CANCELLED");
      expect(getActions(staff, ctx)).toEqual([]);
      expect(getActions(admin, ctx)).toEqual([]);
      expect(getActions(owner, ctx)).toEqual([]);
    });
  });

  describe("DRAFT state", () => {
    const ctx = booking("DRAFT");

    it("staff can edit and cancel", () => {
      const actions = getActions(staff, ctx);
      expect(has(actions, "edit")).toBe(true);
      expect(has(actions, "cancel")).toBe(true);
      expect(has(actions, "extend")).toBe(false);
      expect(has(actions, "checkin")).toBe(false);
      expect(has(actions, "open")).toBe(false);
    });
  });

  describe("ownership via createdBy", () => {
    it("student who is creator but not requester has access", () => {
      const ctx = booking("OPEN", "other-student", "student-1");
      const actions = getActions(owner, ctx);
      expect(has(actions, "edit")).toBe(true);
      expect(has(actions, "checkin")).toBe(false);
    });
  });

  describe("mirrors server-side checkout-rules", () => {
    it("keeps OPEN checkout cancellation out of normal app and web actions", () => {
      const ctx = booking("OPEN");
      expect(has(getActions(owner, ctx), "cancel")).toBe(false);
      expect(has(getActions(staff, ctx), "cancel")).toBe(false);
      expect(has(getActions(admin, ctx), "cancel")).toBe(false);
    });
  });
});
