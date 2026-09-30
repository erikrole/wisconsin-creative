import { describe, expect, it, vi } from "vitest";
import { evaluateKioskCheckoutAllowance, checkoutLimitConflict } from "@/lib/services/kiosk-checkout-allowance";
import { leftoverReservationPickupConflict } from "@/lib/services/reservation-pickup-guard";
import { fail, HttpError } from "@/lib/http";
import { source as readSource } from "./_helpers/source";

function client(opts: { limit: unknown; count: number; reservations?: unknown[] }) {
  return {
    systemConfig: { findUnique: vi.fn().mockResolvedValue(opts.limit === undefined ? null : { value: { maxItemsPerUser: opts.limit } }) },
    booking: {
      count: vi.fn().mockResolvedValue(opts.count),
      findMany: vi.fn().mockResolvedValue(opts.reservations ?? []),
    },
  };
}

describe("kiosk checkout allowance", () => {
  it("allows checkout when no limit is configured", async () => {
    const tx = client({ limit: undefined, count: 7 });
    await expect(evaluateKioskCheckoutAllowance(tx as never, { userId: "u1", locationId: "loc-1" })).resolves.toEqual({
      openCheckoutCount: 7, limit: null, canCheckout: true, blockedReason: null,
    });
  });

  it("blocks at the limit using the same personal OPEN+PENDING_PICKUP count as completion", async () => {
    const tx = client({ limit: 2, count: 2 });
    const allowance = await evaluateKioskCheckoutAllowance(tx as never, { userId: "u1", locationId: "loc-1" });
    expect(allowance).toMatchObject({ openCheckoutCount: 2, limit: 2, canCheckout: false, blockedReason: "limit" });
    expect(tx.booking.count).toHaveBeenCalledWith({
      where: { kind: "CHECKOUT", requesterUserId: "u1", custodyScope: "PERSON", status: { in: ["OPEN", "PENDING_PICKUP"] } },
    });
  });

  it("reports an unfinished leftover pickup first, with its title", async () => {
    const tx = client({
      limit: 5,
      count: 1,
      reservations: [{
        id: "res-1", refNumber: "RS-1", title: "Football at Iowa",
        serializedItems: [{ allocationStatus: "active" }], bulkItems: [], derivedCheckouts: [{ id: "co-1" }],
      }],
    });
    await expect(evaluateKioskCheckoutAllowance(tx as never, { userId: "u1", locationId: "loc-1" })).resolves.toEqual({
      openCheckoutCount: 1, limit: 5, canCheckout: false, blockedReason: "leftover_pickup",
      leftoverPickupTitle: "Football at Iowa", leftoverPickupId: "res-1",
    });
  });

  it("gives the limit and leftover refusals machine codes without changing their text", async () => {
    const limit = await fail(checkoutLimitConflict()).json();
    expect(limit).toMatchObject({ error: "This user already has the maximum number of active checkouts", code: "checkout_limit" });
    const leftover = await fail(leftoverReservationPickupConflict({ id: "r", refNumber: "RS-1", title: "t" })).json();
    expect(leftover).toMatchObject({ error: "Finish pickup for RS-1 first instead of starting a new checkout.", code: "leftover_pickup" });
    expect(leftover.data.errorCode).toBe("leftover_reservation_pickup");
    const plain = await fail(new HttpError(409, "x")).json();
    expect(plain).not.toHaveProperty("code");
  });

  it("wires the shared helper into the hub and completion", () => {
    const student = readSource("src/app/api/kiosk/student/[userId]/route.ts");
    expect(student).toContain("evaluateKioskCheckoutAllowance");
    expect(student).toContain("checkoutAllowance");
    const complete = readSource("src/app/api/kiosk/checkout/complete/route.ts");
    expect(complete).toContain("countPersonalActiveCheckouts(tx, actorId)");
    expect(complete).toContain("throw checkoutLimitConflict()");
    const receipts = readSource("src/lib/services/kiosk-operation-receipts.ts");
    expect(receipts).toContain("...httpErrorCode(error)");
  });
});
