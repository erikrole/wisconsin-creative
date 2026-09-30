import { BookingCustodyScope, BookingKind, BookingStatus, type Prisma, type PrismaClient } from "@prisma/client";
import { HttpError } from "@/lib/http";
import { normalizeCheckoutPolicies } from "@/lib/services/checkout-policies";
import { findLeftoverReservationPickup } from "@/lib/services/reservation-pickup-guard";

type Client = Prisma.TransactionClient | PrismaClient;

export const CHECKOUT_LIMIT_CODE = "checkout_limit";
export const LEFTOVER_PICKUP_CODE = "leftover_pickup";

export type KioskCheckoutAllowance = {
  /** Personal OPEN + PENDING_PICKUP checkouts, the set the limit counts. */
  openCheckoutCount: number;
  limit: number | null;
  canCheckout: boolean;
  blockedReason: "limit" | "leftover_pickup" | null;
  leftoverPickupTitle?: string;
  leftoverPickupId?: string;
};

/**
 * Personal checkouts that count against `checkout_policies.maxItemsPerUser`.
 * SHARED travel-case custody is not this person's (D-061) and never counts.
 */
export async function countPersonalActiveCheckouts(tx: Client, userId: string) {
  return tx.booking.count({
    where: {
      kind: BookingKind.CHECKOUT,
      requesterUserId: userId,
      custodyScope: BookingCustodyScope.PERSON,
      status: { in: [BookingStatus.OPEN, BookingStatus.PENDING_PICKUP] },
    },
  });
}

export async function loadCheckoutLimit(tx: Client): Promise<number | null> {
  const policyRow = await tx.systemConfig.findUnique({
    where: { key: "checkout_policies" },
    select: { value: true },
  });
  return normalizeCheckoutPolicies(policyRow?.value).maxItemsPerUser;
}

export function checkoutLimitConflict() {
  return new HttpError(409, "This user already has the maximum number of active checkouts", {
    code: CHECKOUT_LIMIT_CODE,
  });
}

/**
 * The same rules `POST /api/kiosk/checkout/complete` enforces, read up front
 * so the hub can say why checkout is unavailable before anyone scans.
 * Leftover pickup is checked first, matching completion order.
 */
export async function evaluateKioskCheckoutAllowance(
  tx: Client,
  args: { userId: string; locationId: string; now?: Date },
): Promise<KioskCheckoutAllowance> {
  const [leftover, limit, openCheckoutCount] = await Promise.all([
    findLeftoverReservationPickup(tx as Prisma.TransactionClient, {
      requesterUserId: args.userId,
      locationId: args.locationId,
      now: args.now,
    }),
    loadCheckoutLimit(tx),
    countPersonalActiveCheckouts(tx, args.userId),
  ]);
  if (leftover) {
    return {
      openCheckoutCount,
      limit,
      canCheckout: false,
      blockedReason: "leftover_pickup",
      leftoverPickupTitle: leftover.title,
      leftoverPickupId: leftover.id,
    };
  }
  const atLimit = limit !== null && openCheckoutCount >= limit;
  return {
    openCheckoutCount,
    limit,
    canCheckout: !atLimit,
    blockedReason: atLimit ? "limit" : null,
  };
}
