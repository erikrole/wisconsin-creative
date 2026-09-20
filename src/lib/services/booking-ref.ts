import { Prisma } from "@prisma/client";

/**
 * Booking ref-number generation.
 *
 * Per D-024: CO/RV kind prefix + a single GLOBAL sequence shared across kinds.
 * The sequence is the Postgres `booking_ref_seq` (created in the migration that
 * introduced ref numbers). Calling `nextval` is atomic and returns a unique
 * value per call, so this is safe under concurrency without an advisory lock.
 *
 * Must be invoked inside an active transaction so the resulting refNumber is
 * paired atomically with the booking it labels.
 *
 * Format: `${kind}-${4-digit zero-padded sequence}` (e.g. `CO-0042`).
 */
type BookingRefKind = "CO" | "RV";

export async function nextBookingRef(
  tx: Prisma.TransactionClient,
  kind: BookingRefKind,
): Promise<string> {
  const result = await tx.$queryRaw<[{ nextval: bigint }]>`SELECT nextval('booking_ref_seq')`;
  const seq = Number(result[0].nextval);
  return `${kind}-${String(seq).padStart(4, "0")}`;
}
