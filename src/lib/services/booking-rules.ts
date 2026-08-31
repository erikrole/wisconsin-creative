import { BookingKind, BookingStatus, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import type { AuthUser } from "@/lib/auth";
import {
  canPerformBookingAction as canPerformBookingActionPolicy,
  getAllowedBookingActions as getAllowedBookingActionsPolicy,
  type ActionCheckResult,
  type CheckoutAction,
  type ReservationAction,
} from "@/lib/booking-action-policy";

/**
 * Unified booking action gating rules (checkouts + reservations).
 *
 * Source of truth: AREA_CHECKOUTS.md, AREA_RESERVATIONS.md, AREA_USERS.md
 *
 * Checkout state × action matrix:
 * | Action   | DRAFT        | BOOKED       | PENDING_PICKUP | OPEN          | COMPLETED | CANCELLED |
 * |----------|-------------|-------------|----------------|---------------|-----------|-----------|
 * | edit     | staff+/owner | staff+/owner | staff+/owner   | staff+/owner  | ✗         | ✗         |
 * | extend   | ✗            | staff+/owner | ✗              | staff+/owner  | ✗         | ✗         |
 * | cancel   | staff+/owner | staff+/owner | staff+/owner   | ✗             | ✗         | ✗         |
 * | checkin  | ✗            | ✗            | ✗              | kiosk only    | ✗         | ✗         |
 * | force-complete | ✗       | ✗            | ✗              | admin only    | ✗         | ✗         |
 * | transfer-owner | staff+/owner | staff+/owner | staff+/owner | staff+/owner | ✗         | ✗         |
 * | open     | ✗            | staff+/owner | ✗              | ✗             | ✗         | ✗         |
 * | pickup   | ✗            | ✗            | kiosk only     | ✗             | ✗         | ✗         |
 *
 * Reservation state × action matrix:
 * | Action   | DRAFT        | BOOKED       | COMPLETED | CANCELLED |
 * |----------|-------------|-------------|-----------|-----------|
 * | edit     | staff+/owner | staff+/owner | ✗         | ✗         |
 * | extend   | ✗            | staff+/owner | ✗         | ✗         |
 * | cancel   | staff+/owner | staff+/owner | ✗         | ✗         |
 * | convert  | ✗            | kiosk only   | ✗         | ✗         |
 * | force-checkout | ✗      | admin only   | ✗         | ✗         |
 * | transfer-owner | staff+/owner | staff+/owner | ✗         | ✗         |
 *
 * "staff+" = ADMIN or STAFF
 * "owner" = STUDENT who is the requester or creator of the booking
 */

export type { CheckoutAction, ReservationAction };
export type BookingAction = string;

type BookingContext = {
  kind: BookingKind;
  status: BookingStatus;
  requesterUserId: string;
  createdBy: string;
};

type ActorContext = {
  id: string;
  role: Role;
  capabilities?: readonly string[];
};

/**
 * Check if a specific action is allowed for the given actor and booking.
 */
export function canPerformBookingAction(
  actor: ActorContext,
  booking: BookingContext,
  action: string
): ActionCheckResult {
  return canPerformBookingActionPolicy(actor, booking, action);
}

/**
 * Get all allowed actions for a booking.
 */
export function getAllowedBookingActions(
  actor: ActorContext,
  booking: BookingContext
): string[] {
  return getAllowedBookingActionsPolicy(actor, booking, { includeServerActions: true });
}

/**
 * Load a booking and enforce that the given action is permitted.
 * Throws HttpError if booking not found or action denied.
 */
export async function requireBookingAction(
  bookingId: string,
  actor: AuthUser,
  action: string,
  expectedKind?: BookingKind
) {
  const booking = await db.booking.findUnique({ where: { id: bookingId } });

  if (!booking) {
    throw new HttpError(404, "Booking not found");
  }

  if (expectedKind && booking.kind !== expectedKind) {
    const label = expectedKind === BookingKind.CHECKOUT ? "Checkout" : "Reservation";
    throw new HttpError(404, `${label} not found`);
  }

  const check = canPerformBookingAction(actor, booking, action);
  if (!check.allowed) {
    throw new HttpError(403, check.reason ?? "Forbidden");
  }

  return booking;
}
