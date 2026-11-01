import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { PAST_START_SKEW_MS } from "@/lib/time";

export type ReservationRules = {
  advanceWindowDays: number | null;
  noShowExpiryHours: number;
  maxConcurrentReservations: number | null;
};

export const DEFAULT_RESERVATION_RULES: ReservationRules = {
  advanceWindowDays: null,
  noShowExpiryHours: 48,
  maxConcurrentReservations: null,
};

function normalizeRoundedInteger(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded >= min && rounded <= max ? rounded : null;
}

function normalizeBoundedNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
    ? value
    : fallback;
}

export function normalizeReservationRules(raw: unknown): ReservationRules {
  if (!raw || typeof raw !== "object") return DEFAULT_RESERVATION_RULES;
  const r = raw as Record<string, unknown>;
  return {
    advanceWindowDays: normalizeRoundedInteger(r.advanceWindowDays, 1, 730),
    noShowExpiryHours: normalizeBoundedNumber(
      r.noShowExpiryHours,
      1,
      336,
      DEFAULT_RESERVATION_RULES.noShowExpiryHours,
    ),
    maxConcurrentReservations: normalizeRoundedInteger(r.maxConcurrentReservations, 1, 50),
  };
}

export async function loadReservationRules(): Promise<ReservationRules> {
  const row = await db.systemConfig.findUnique({ where: { key: "reservation_rules" } });
  return normalizeReservationRules(row?.value);
}

/**
 * The start-time rules a new reservation must pass. Moving an existing
 * reservation's start goes through the same gate, so an edit cannot push a
 * pickup into the past or past the advance-booking window.
 */
export function assertReservationStartAllowed(start: Date, rules: ReservationRules) {
  if (start.getTime() < Date.now() - PAST_START_SKEW_MS) {
    throw new HttpError(400, "Start date must not be in the past");
  }
  if (rules.advanceWindowDays !== null && start.getTime() > Date.now() + rules.advanceWindowDays * 86_400_000) {
    throw new HttpError(
      409,
      `Reservations cannot be made more than ${rules.advanceWindowDays} day${rules.advanceWindowDays === 1 ? "" : "s"} in advance.`
    );
  }
}
