"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  dashboardQueryKey,
  dashboardStatsQueryKey,
} from "@/hooks/use-dashboard-data";
import { useAuthenticatedQueryUserId } from "@/components/QueryProvider";
import { handleAuthRedirect, parseJsonSafely } from "@/lib/errors";
import { useOperationalPollingActivity } from "@/hooks/use-operational-polling-activity";

// Booking pages remain operationally fresh without a visible tab keeping the
// database awake continuously. Kiosk custody uses its native immediate reloads.
export const BOOKING_CHANGE_SYNC_INTERVAL_MS = 30_000;
export const BOOKING_CHANGE_SYNC_EVENT = "booking-change-sync";

type BookingChangeSignal = {
  cursor: string;
  changedBookingIds: string[];
};

export type BookingChangeSyncStatus = {
  state: "active" | "down" | "fixing" | "idle";
  label: string;
  description: string;
  lastCheckedAt: Date | null;
};

const initialSyncStatus: BookingChangeSyncStatus = {
  state: "idle",
  label: "Checking sync",
  description: "Booking freshness check has not completed yet.",
  lastCheckedAt: null,
};

async function fetchBookingChanges(cursor: string | null, signal: AbortSignal): Promise<BookingChangeSignal> {
  const path = cursor
    ? `/api/bookings/changes?since=${encodeURIComponent(cursor)}`
    : "/api/bookings/changes";
  const res = await fetch(path, { signal });
  if (handleAuthRedirect(res)) throw new DOMException("Auth redirect", "AbortError");
  if (!res.ok) throw new Error("server");
  const json = await parseJsonSafely<{ data?: Partial<BookingChangeSignal> }>(res);
  const data = json?.data;
  if (!data || typeof data.cursor !== "string" || !Array.isArray(data.changedBookingIds)) {
    throw new Error("server");
  }
  return {
    cursor: data.cursor,
    changedBookingIds: data.changedBookingIds.filter((id): id is string => typeof id === "string" && id.length > 0),
  };
}

export function useBookingChangeSync(enabled = true) {
  const queryClient = useQueryClient();
  const userId = useAuthenticatedQueryUserId();
  const pollingState = useOperationalPollingActivity(enabled && Boolean(userId));
  const cursorRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);
  const [status, setStatus] = useState<BookingChangeSyncStatus>(initialSyncStatus);

  useEffect(() => {
    if (!enabled || !userId) {
      setStatus({
        state: "idle",
        label: "Sync paused",
        description: "Booking freshness sync is disabled for this view.",
        lastCheckedAt: null,
      });
      return;
    }

    if (pollingState !== "active") {
      setStatus((prev) => ({
        state: pollingState === "offline" ? "down" : "idle",
        label: pollingState === "offline" ? "Offline" : "Sync paused",
        description: pollingState === "offline"
          ? "Booking freshness sync will retry when the browser is online."
          : pollingState === "idle"
            ? "Booking freshness sync paused after inactivity and will resume when you return."
            : "Booking freshness sync pauses while this tab is in the background.",
        lastCheckedAt: prev.lastCheckedAt,
      }));
      return;
    }

    let stopped = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;

    const clearPending = () => {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
    };

    const invalidateBookingCaches = (changedBookingIds: string[]) => {
      if (changedBookingIds.length === 0) return;
      void queryClient.invalidateQueries({ queryKey: dashboardQueryKey(userId) });
      void queryClient.invalidateQueries({ queryKey: dashboardStatsQueryKey(userId) });
      void queryClient.invalidateQueries({ queryKey: ["bookingList"] });
      for (const bookingId of changedBookingIds) {
        void queryClient.invalidateQueries({ queryKey: ["booking", bookingId] });
      }
      window.dispatchEvent(
        new CustomEvent(BOOKING_CHANGE_SYNC_EVENT, { detail: { changedBookingIds } }),
      );
    };

    const schedule = (delay: number) => {
      if (stopped) return;
      clearPending();
      timeout = setTimeout(() => {
        void poll();
      }, delay);
    };

    const poll = async () => {
      if (stopped) return;
      if (inFlightRef.current) return;

      inFlightRef.current = true;
      controller = new AbortController();
      try {
        const result = await fetchBookingChanges(cursorRef.current, controller.signal);
        cursorRef.current = result.cursor;
        invalidateBookingCaches(result.changedBookingIds);
        const checkedAt = new Date();
        setStatus({
          state: "active",
          label: result.changedBookingIds.length > 0 ? "Sync updated" : "Live sync",
          description: result.changedBookingIds.length > 0
            ? `Refreshed ${result.changedBookingIds.length} changed booking${result.changedBookingIds.length === 1 ? "" : "s"}.`
            : "Booking freshness sync is current.",
          lastCheckedAt: checkedAt,
        });
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          // Keep the current cursor and retry on the next scheduled tick.
          setStatus((prev) => ({
            state: "fixing",
            label: "Sync retrying",
            description: "Booking freshness sync could not reach the server and will retry.",
            lastCheckedAt: prev.lastCheckedAt,
          }));
        }
      } finally {
        inFlightRef.current = false;
        controller = null;
        schedule(BOOKING_CHANGE_SYNC_INTERVAL_MS);
      }
    };

    schedule(0);

    return () => {
      stopped = true;
      clearPending();
      controller?.abort();
    };
  }, [enabled, pollingState, queryClient, userId]);

  return status;
}
