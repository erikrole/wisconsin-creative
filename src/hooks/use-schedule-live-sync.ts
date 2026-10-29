"use client";

import { useEffect, useRef } from "react";
import { useOperationalPollingActivity } from "@/hooks/use-operational-polling-activity";

// The live endpoint reads a single Redis counter and never touches Neon.
export const SCHEDULE_LIVE_INTERVAL_MS = 10_000;

/**
 * Calls `onChange` when anyone else edits the schedule. Pauses with the shared
 * polling gate (hidden tab, idle, overnight, offline).
 */
export function useScheduleLiveSync(onChange: () => void, enabled = true) {
  const pollingState = useOperationalPollingActivity(enabled);
  const revisionRef = useRef<number | null>(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!enabled || pollingState !== "active") return;

    let stopped = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const controller = new AbortController();

    const poll = async () => {
      try {
        const res = await fetch("/api/schedule/live", { signal: controller.signal });
        if (res.ok) {
          const json = (await res.json()) as { data?: { revision?: number | null } };
          const revision = json.data?.revision;
          if (typeof revision === "number") {
            const previous = revisionRef.current;
            revisionRef.current = revision;
            // Resuming from a pause also catches changes made while away.
            if (previous !== null && previous !== revision) onChangeRef.current();
          }
        }
      } catch {
        // Retry on the next tick; the regular focus refetch still applies.
      }
      if (!stopped) timeout = setTimeout(poll, SCHEDULE_LIVE_INTERVAL_MS);
    };

    void poll();
    return () => {
      stopped = true;
      if (timeout) clearTimeout(timeout);
      controller.abort();
    };
  }, [enabled, pollingState]);
}
