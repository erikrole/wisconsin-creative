"use client";

import { useEffect, useRef, useState } from "react";
import { isOvernightQuietHours } from "@/lib/app-time";

export const OPERATIONAL_POLLING_IDLE_MS = 2 * 60_000;
/** Recheck the 10 PM–6 AM window so a tab left open resumes after quiet hours without a refresh. */
export const QUIET_HOURS_RECHECK_MS = 60_000;

const ACTIVITY_RECORD_THROTTLE_MS = 15_000;
const ACTIVITY_EVENTS = ["pointerdown", "pointermove", "keydown", "touchstart", "wheel"] as const;

type OperationalPollingState = "active" | "idle" | "hidden" | "offline" | "disabled" | "quiet";

type PollingStateInput = {
  enabled: boolean;
  visible: boolean;
  online: boolean;
  lastActivityAt: number;
  now: number;
  idleMs?: number;
  quietHours?: boolean;
};

/**
 * Shared gate for database polling. Hidden tabs and overnight quiet hours
 * (10 PM–6 AM in the app timezone) must not keep Neon compute awake.
 * Pass `hidden` explicitly when the caller already knows visibility.
 */
export function isBackgroundPollingPaused(
  hidden: boolean = typeof document !== "undefined" && document.hidden,
  now: Date = new Date(),
): boolean {
  return hidden || isOvernightQuietHours(now);
}

export function getOperationalPollingState({
  enabled,
  visible,
  online,
  lastActivityAt,
  now,
  idleMs = OPERATIONAL_POLLING_IDLE_MS,
  quietHours = false,
}: PollingStateInput): OperationalPollingState {
  if (!enabled) return "disabled";
  if (!visible) return "hidden";
  if (quietHours) return "quiet";
  if (!online) return "offline";
  if (now - lastActivityAt >= idleMs) return "idle";
  return "active";
}

export function useOperationalPollingActivity(
  enabled = true,
  idleMs = OPERATIONAL_POLLING_IDLE_MS,
): OperationalPollingState {
  // The effect stamps this on mount; 0 keeps render pure.
  const lastActivityAtRef = useRef(0);
  const lastRecordedAtRef = useRef(0);
  const [state, setState] = useState<OperationalPollingState>(
    () => (!enabled ? "disabled" : isOvernightQuietHours() ? "quiet" : "active"),
  );
  const stateRef = useRef(state);

  useEffect(() => {
    let idleTimer: ReturnType<typeof setTimeout> | null = null;

    const updateState = (nextState: OperationalPollingState) => {
      stateRef.current = nextState;
      setState(nextState);
    };

    const clearIdleTimer = () => {
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
    };

    if (!enabled) {
      clearIdleTimer();
      updateState("disabled");
      return;
    }

    lastActivityAtRef.current = Date.now();

    const syncState = () => {
      clearIdleTimer();
      const now = Date.now();
      const visible = document.visibilityState === "visible";
      const nextState = getOperationalPollingState({
        enabled,
        visible,
        online: navigator.onLine,
        lastActivityAt: lastActivityAtRef.current,
        now,
        idleMs,
        quietHours: isBackgroundPollingPaused(false, new Date(now)),
      });
      updateState(nextState);

      if (nextState === "active") {
        const remaining = Math.max(0, idleMs - (now - lastActivityAtRef.current));
        idleTimer = setTimeout(syncState, remaining);
      } else if (nextState === "quiet") {
        idleTimer = setTimeout(syncState, QUIET_HOURS_RECHECK_MS);
      }
    };

    const recordActivity = () => {
      const now = Date.now();
      if (
        stateRef.current === "active"
        && now - lastRecordedAtRef.current < ACTIVITY_RECORD_THROTTLE_MS
      ) {
        return;
      }
      lastRecordedAtRef.current = now;
      lastActivityAtRef.current = now;
      syncState();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        recordActivity();
      } else {
        syncState();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", recordActivity);
    window.addEventListener("online", recordActivity);
    window.addEventListener("offline", syncState);
    for (const eventName of ACTIVITY_EVENTS) {
      document.addEventListener(eventName, recordActivity, { passive: true });
    }
    syncState();

    return () => {
      clearIdleTimer();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", recordActivity);
      window.removeEventListener("online", recordActivity);
      window.removeEventListener("offline", syncState);
      for (const eventName of ACTIVITY_EVENTS) {
        document.removeEventListener(eventName, recordActivity);
      }
    };
  }, [enabled, idleMs]);

  return state;
}
