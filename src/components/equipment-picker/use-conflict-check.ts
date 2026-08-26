"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { handleAuthRedirect, isAbortError, parseJsonSafely } from "@/lib/errors";

export type ConflictInfo = {
  assetId: string;
  conflictingBookingId?: string;
  conflictingBookingTitle?: string;
  startsAt: string;
  endsAt: string;
};

export type UpcomingCommitmentInfo = {
  assetId: string;
  bookingId: string;
  bookingTitle?: string;
  startsAt: string;
  endsAt: string;
  status: string;
  nextLocationId?: string | null;
  nextLocationName?: string | null;
};

export type TurnaroundRiskInfo = {
  assetId: string;
  code: "SHORT_TURNAROUND" | "LOCATION_TRANSFER" | "RECENT_CHECKIN_REPORT";
  severity: "warning" | "critical";
  message: string;
  bookingId?: string;
  bookingTitle?: string;
  startsAt?: string;
  gapMinutes?: number;
  nextLocationName?: string | null;
  reportType?: "DAMAGED" | "LOST";
  reportCreatedAt?: string;
};

export type BulkTurnaroundRiskInfo = {
  bulkSkuId: string;
  code: "BULK_SHORT_TURNAROUND";
  severity: "warning" | "critical";
  message: string;
  bookingId: string;
  bookingTitle?: string;
  startsAt: string;
  gapMinutes: number;
  plannedQuantity: number;
};

type UseConflictCheckParams = {
  startsAt?: string;
  endsAt?: string;
  locationId?: string;
  assetIds: string[];
  bulkItems?: Array<{ bulkSkuId: string; quantity: number }>;
  excludeBookingId?: string;
  /** Booking kind for per-kind availability gating — preflight must apply the
   * same availableForCheckout/availableForReservation rules the save does. */
  bookingKind?: "RESERVATION" | "CHECKOUT";
};

/**
 * Checks scheduling conflicts for a batched set of assets within a booking window.
 * Re-fires whenever asset IDs, dates, location, or excluded booking change.
 */
export function useConflictCheck({
  startsAt,
  endsAt,
  locationId,
  assetIds,
  bulkItems = [],
  excludeBookingId,
  bookingKind,
}: UseConflictCheckParams) {
  const [conflicts, setConflicts] = useState<Map<string, ConflictInfo>>(new Map());
  const [upcomingCommitments, setUpcomingCommitments] = useState<Map<string, UpcomingCommitmentInfo>>(new Map());
  const [turnaroundRisks, setTurnaroundRisks] = useState<Map<string, TurnaroundRiskInfo[]>>(new Map());
  const [bulkTurnaroundRisks, setBulkTurnaroundRisks] = useState<Map<string, BulkTurnaroundRiskInfo[]>>(new Map());
  const [checking, setChecking] = useState(false);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null);

  const check = useCallback(async (
    ids: string[],
    bulk: Array<{ bulkSkuId: string; quantity: number }>,
    start: string,
    end: string,
    loc: string,
    excludeId?: string,
  ) => {
    if (ids.length === 0 && bulk.length === 0) {
      setConflicts(new Map());
      setUpcomingCommitments(new Map());
      setTurnaroundRisks(new Map());
      setBulkTurnaroundRisks(new Map());
      setAvailabilityError(null);
      setChecking(false);
      return;
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setChecking(true);
    setAvailabilityError(null);
    try {
      const res = await fetch("/api/availability/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locationId: loc,
          startsAt: new Date(start).toISOString(),
          endsAt: new Date(end).toISOString(),
          serializedAssetIds: ids,
          bulkItems: bulk,
          ...(excludeId ? { excludeBookingId: excludeId } : {}),
          ...(bookingKind ? { kind: bookingKind } : {}),
        }),
        signal: ctrl.signal,
      });
      if (ctrl.signal.aborted) return;
      if (handleAuthRedirect(res)) return;
      if (res.ok) {
        const json = await parseJsonSafely<{
          conflicts?: Array<{ assetId: string; conflictingBookingId?: string; conflictingBookingTitle?: string; startsAt: string; endsAt: string }>;
          upcomingCommitments?: UpcomingCommitmentInfo[];
          turnaroundRisks?: TurnaroundRiskInfo[];
          bulkTurnaroundRisks?: BulkTurnaroundRiskInfo[];
        }>(res);
        // `/api/availability/check` returns the availability result at the
        // top level. Looking under `data` silently turns a successful
        // pre-selection check into an empty preview.
        const data = json;
        if (!data) {
          setAvailabilityError("Availability could not be refreshed. Showing the last known result.");
          return;
        }
        const conflictMap = new Map<string, ConflictInfo>();
        for (const c of data.conflicts ?? []) conflictMap.set(c.assetId, c);
        const upcomingMap = new Map<string, UpcomingCommitmentInfo>();
        for (const c of data.upcomingCommitments ?? []) upcomingMap.set(c.assetId, c);
        const riskMap = new Map<string, TurnaroundRiskInfo[]>();
        for (const risk of data.turnaroundRisks ?? []) {
          riskMap.set(risk.assetId, [...(riskMap.get(risk.assetId) ?? []), risk]);
        }
        const bulkRiskMap = new Map<string, BulkTurnaroundRiskInfo[]>();
        for (const risk of data.bulkTurnaroundRisks ?? []) {
          bulkRiskMap.set(risk.bulkSkuId, [...(bulkRiskMap.get(risk.bulkSkuId) ?? []), risk]);
        }
        setConflicts(conflictMap);
        setUpcomingCommitments(upcomingMap);
        setTurnaroundRisks(riskMap);
        setBulkTurnaroundRisks(bulkRiskMap);
        setAvailabilityError(null);
      } else {
        setAvailabilityError("Availability could not be refreshed. Showing the last known result.");
      }
    } catch (err) {
      if (isAbortError(err)) return;
      setAvailabilityError("Availability could not be refreshed. Showing the last known result.");
    } finally {
      if (!ctrl.signal.aborted) setChecking(false);
    }
  }, [bookingKind]);

  const retry = useCallback(() => setRetryToken((value) => value + 1), []);

  useEffect(() => {
    if (!startsAt || !endsAt || !locationId) {
      setConflicts(new Map());
      setUpcomingCommitments(new Map());
      setTurnaroundRisks(new Map());
      setBulkTurnaroundRisks(new Map());
      setAvailabilityError(null);
      setChecking(false);
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      check(assetIds, bulkItems, startsAt, endsAt, locationId, excludeBookingId);
    }, 400);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // assetIds and bulkItems are intentionally keyed by serialized value so
    // parent array/object identity churn does not re-run availability checks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startsAt, endsAt, locationId, excludeBookingId, assetIds.join(","), JSON.stringify(bulkItems), retryToken, check]);

  // Abort on unmount
  useEffect(() => () => abortRef.current?.abort(), []);

  return { conflicts, upcomingCommitments, turnaroundRisks, bulkTurnaroundRisks, checking, availabilityError, retry };
}
