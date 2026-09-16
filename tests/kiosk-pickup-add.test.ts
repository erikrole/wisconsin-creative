import { describe, expect, it } from "vitest";
import { BookingCustodyScope, Role } from "@prisma/client";
import { HttpError } from "@/lib/http";
import {
  assertKioskPickupPlanActor,
  remainingPickupAllocationWindow,
} from "@/lib/services/kiosk-pickup-add";

const personal = {
  custodyScope: BookingCustodyScope.PERSON,
  requesterUserId: "david",
};

describe("kiosk pickup plan actor", () => {
  it("lets an identified operator mutate a shared travel-case pickup", () => {
    expect(() => assertKioskPickupPlanActor(
      { custodyScope: BookingCustodyScope.SHARED, requesterUserId: "creator" },
      { id: "operator", role: Role.STUDENT },
    )).not.toThrow();
  });

  it("keeps personal pickup add/remove requester-locked for students", () => {
    expect(() => assertKioskPickupPlanActor(personal, { id: "maya", role: Role.STUDENT }))
      .toThrow(HttpError);
    try {
      assertKioskPickupPlanActor(personal, { id: "maya", role: Role.STUDENT });
    } catch (error) {
      expect(error).toMatchObject({ status: 403 });
    }
  });

  it("requires a collaborator edit grant on a personal reservation", () => {
    expect(() => assertKioskPickupPlanActor(personal, {
      id: "david",
      role: Role.COLLABORATOR,
      collaboratorPolicy: {
        status: "ACTIVE",
        grants: [{ capabilityKey: "KIOSK_ROSTER_ELIGIBLE" }],
      },
    })).toThrow(HttpError);

    expect(() => assertKioskPickupPlanActor(personal, {
      id: "david",
      role: Role.COLLABORATOR,
      collaboratorPolicy: {
        status: "ACTIVE",
        grants: [{ capabilityKey: "RESERVATION_EDIT_OWN" }],
      },
    })).not.toThrow();
  });

  it("lets staff change remaining pickup items", () => {
    expect(() => assertKioskPickupPlanActor(personal, { id: "staff", role: Role.STAFF }))
      .not.toThrow();
  });
});

describe("remaining pickup allocation window", () => {
  it("keeps the original start when pickup is early", () => {
    const window = remainingPickupAllocationWindow({
      startsAt: new Date("2026-09-16T18:00:00.000Z"),
      endsAt: new Date("2026-09-17T02:00:00.000Z"),
    }, new Date("2026-09-16T16:00:00.000Z"));
    expect(window.startsAt.toISOString()).toBe("2026-09-16T18:00:00.000Z");
    expect(window.endsAt.toISOString()).toBe("2026-09-17T02:00:00.000Z");
  });

  it("checks from now when leftover pickup is late", () => {
    const now = new Date("2026-09-16T23:00:00.000Z");
    const window = remainingPickupAllocationWindow({
      startsAt: new Date("2026-09-16T14:00:00.000Z"),
      endsAt: new Date("2026-09-17T02:00:00.000Z"),
    }, now);
    expect(window.startsAt).toBe(now);
    expect(window.endsAt.toISOString()).toBe("2026-09-17T02:00:00.000Z");
  });
});
