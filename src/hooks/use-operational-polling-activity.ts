"use client";

import { useEffect, useRef, useState } from "react";

export const OPERATIONAL_POLLING_IDLE_MS = 2 * 60_000;

const ACTIVITY_RECORD_THROTTLE_MS = 15_000;
const ACTIVITY_EVENTS = ["pointerdown", "pointermove", "keydown", "touchstart", "wheel"] as const;

type OperationalPollingState = "active" | "idle" | "hidden" | "offline" | "disabled";

type PollingStateInput = {
  enabled: boolean;
  visible: boolean;
  online: boolean;
  lastActivityAt: number;
  now: number;
  idleMs?: number;
};

export function getOperationalPollingState({
  enabled,
  visible,
  online,
  lastActivityAt,
  now,
  idleMs = OPERATIONAL_POLLING_IDLE_MS,
}: PollingStateInput): OperationalPollingState {
  if (!enabled) return "disabled";
  if (!visible) return "hidden";
  if (!online) return "offline";
  if (now - lastActivityAt >= idleMs) return "idle";
  return "active";
}

export function useOperationalPollingActivity(
  enabled = true,
  idleMs = OPERATIONAL_POLLING_IDLE_MS,
): OperationalPollingState {
  const lastActivityAtRef = useRef(Date.now());
  const lastRecordedAtRef = useRef(0);
  const stateRef = useRef<OperationalPollingState>(enabled ? "active" : "disabled");
  const [state, setState] = useState<OperationalPollingState>(stateRef.current);

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
      const nextState = getOperationalPollingState({
        enabled,
        visible: document.visibilityState === "visible",
        online: navigator.onLine,
        lastActivityAt: lastActivityAtRef.current,
        now,
        idleMs,
      });
      updateState(nextState);

      if (nextState === "active") {
        const remaining = Math.max(0, idleMs - (now - lastActivityAtRef.current));
        idleTimer = setTimeout(syncState, remaining);
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
