import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

/**
 * Inputs for the shared dashboard count aggregate. Both `/api/dashboard` and
 * `/api/dashboard/stats` derive these from the same clock + 7-day reservation
 * window so the two routes can never drift on count semantics.
 */
export type DashboardCountInputs = {
  userId: string;
  now: Date;
  sevenDaysFromNow: Date;
  startOfToday: Date;
  startOfTomorrow: Date;
};

/**
 * Numeric counts shared by the full dashboard payload and the lightweight stats
 * endpoint. All values are plain numbers (BigInt converted at this boundary) so
 * callers never have to think about JSON serialization.
 */
export type DashboardCounts = {
  teamCheckoutsTotal: number;
  teamCheckoutsOverdue: number;
  teamReservationsTotal: number;
  myCheckoutsTotal: number;
  myOverdue: number;
  myDueToday: number;
  totalCheckedOut: number;
  totalOverdue: number;
  totalReserved: number;
  dueToday: number;
  pendingPickupTotal: number;
  staleReservationTotal: number;
};

type CountRow = {
  team_checkouts: bigint;
  team_checkouts_overdue: bigint;
  team_reservations: bigint;
  my_checkouts: bigint;
  my_overdue: bigint;
  my_due_today: bigint;
  total_checked_out: bigint;
  total_overdue: bigint;
  total_reserved: bigint;
  due_today: bigint;
  pending_pickup: bigint;
  stale_reservations: bigint;
};

/**
 * Single bounded aggregate that produces every transient-lane count the
 * dashboard surfaces. The `WHERE` clause admits exactly the rows needed for
 * checkout, reservation-window, and pending-pickup counts;
 * the `FILTER` clauses partition those rows into each lane.
 */
export async function readDashboardCounts(inputs: DashboardCountInputs): Promise<DashboardCounts> {
  const { userId, now, sevenDaysFromNow, startOfToday, startOfTomorrow } = inputs;

  const rows = await db.$queryRaw<CountRow[]>(Prisma.sql`
    SELECT
      COUNT(*) FILTER (WHERE kind = 'CHECKOUT' AND status = 'OPEN') AS total_checked_out,
      COUNT(*) FILTER (WHERE kind = 'CHECKOUT' AND status = 'OPEN' AND ends_at < ${now}) AS total_overdue,
      COUNT(*) FILTER (WHERE kind = 'CHECKOUT' AND status = 'OPEN' AND ends_at >= ${startOfToday} AND ends_at < ${startOfTomorrow}) AS due_today,
      COUNT(*) FILTER (WHERE kind = 'CHECKOUT' AND status = 'OPEN' AND (custody_scope = 'SHARED' OR requester_user_id != ${userId})) AS team_checkouts,
      COUNT(*) FILTER (WHERE kind = 'CHECKOUT' AND status = 'OPEN' AND (custody_scope = 'SHARED' OR requester_user_id != ${userId}) AND ends_at < ${now}) AS team_checkouts_overdue,
      COUNT(*) FILTER (WHERE kind = 'CHECKOUT' AND status = 'OPEN' AND custody_scope = 'PERSON' AND requester_user_id = ${userId}) AS my_checkouts,
      COUNT(*) FILTER (WHERE kind = 'CHECKOUT' AND status = 'OPEN' AND custody_scope = 'PERSON' AND requester_user_id = ${userId} AND ends_at < ${now}) AS my_overdue,
      COUNT(*) FILTER (WHERE kind = 'CHECKOUT' AND status = 'OPEN' AND custody_scope = 'PERSON' AND requester_user_id = ${userId} AND ends_at >= ${startOfToday} AND ends_at < ${startOfTomorrow}) AS my_due_today,
      COUNT(*) FILTER (WHERE kind = 'RESERVATION' AND status = 'BOOKED' AND starts_at >= ${now} AND starts_at <= ${sevenDaysFromNow}) AS total_reserved,
      COUNT(*) FILTER (WHERE kind = 'RESERVATION' AND status = 'BOOKED' AND requester_user_id != ${userId} AND starts_at >= ${now} AND starts_at <= ${sevenDaysFromNow}) AS team_reservations,
      COUNT(*) FILTER (
        WHERE (kind = 'CHECKOUT' AND status = 'PENDING_PICKUP')
           OR (kind = 'RESERVATION' AND status = 'BOOKED' AND starts_at <= ${now})
      ) AS pending_pickup,
      0::bigint AS stale_reservations
    FROM bookings
    WHERE (kind = 'CHECKOUT' AND status = 'OPEN')
       OR (kind = 'RESERVATION' AND status = 'BOOKED' AND starts_at >= ${now} AND starts_at <= ${sevenDaysFromNow})
       OR (kind = 'RESERVATION' AND status = 'BOOKED' AND starts_at <= ${now})
       OR (kind = 'CHECKOUT' AND status = 'PENDING_PICKUP')
  `);

  const c = rows[0];
  if (!c) throw new Error("Dashboard counts query returned no rows");

  return {
    teamCheckoutsTotal: Number(c.team_checkouts),
    teamCheckoutsOverdue: Number(c.team_checkouts_overdue),
    teamReservationsTotal: Number(c.team_reservations),
    myCheckoutsTotal: Number(c.my_checkouts),
    myOverdue: Number(c.my_overdue),
    myDueToday: Number(c.my_due_today),
    totalCheckedOut: Number(c.total_checked_out),
    totalOverdue: Number(c.total_overdue),
    totalReserved: Number(c.total_reserved),
    dueToday: Number(c.due_today),
    pendingPickupTotal: Number(c.pending_pickup),
    staleReservationTotal: Number(c.stale_reservations),
  };
}

/** All-zero counts used as a `Promise.allSettled` fallback when the aggregate fails. */
export const zeroDashboardCounts: DashboardCounts = {
  teamCheckoutsTotal: 0,
  teamCheckoutsOverdue: 0,
  teamReservationsTotal: 0,
  myCheckoutsTotal: 0,
  myOverdue: 0,
  myDueToday: 0,
  totalCheckedOut: 0,
  totalOverdue: 0,
  totalReserved: 0,
  dueToday: 0,
  pendingPickupTotal: 0,
  staleReservationTotal: 0,
};
