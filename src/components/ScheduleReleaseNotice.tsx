"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BellRingIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { formatScheduleReleaseCountdown } from "@/lib/schedule-release";

type ScheduleReleaseNoticeProps = {
  hasWorkingCopy?: boolean;
  eventEndsAt?: string | null;
  autoReleaseAt?: string | null;
  autoReleaseError?: string | null;
  onRefresh?: () => void | Promise<void>;
};

export function ScheduleReleaseNotice({
  hasWorkingCopy = false,
  eventEndsAt = null,
  autoReleaseAt = null,
  autoReleaseError = null,
  onRefresh,
}: ScheduleReleaseNoticeProps) {
  const [clock, setClock] = useState(() => Date.now());
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;
  const eventHasEnded = eventEndsAt ? new Date(eventEndsAt).getTime() <= clock : false;

  useEffect(() => {
    if (!hasWorkingCopy || eventHasEnded) return;
    let stopped = false;
    let refreshing = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const refresh = async () => {
      if (stopped || refreshing || document.hidden || !navigator.onLine) return;
      setClock(Date.now());
      refreshing = true;
      try {
        await refreshRef.current?.();
      } catch {
        // Keep the current notice; the next active tick can retry.
      } finally {
        refreshing = false;
      }
    };
    const updateActivity = () => {
      clearInterval(timer);
      timer = undefined;
      if (document.hidden || !navigator.onLine) return;
      // Refresh on the cadence: some parents replace this notice with a loading
      // state during a refresh, so an immediate mount read would loop forever.
      // Active schedule editing keeps its cadence even late at night.
      setClock(Date.now());
      timer = setInterval(() => { void refresh(); }, 15_000);
    };
    updateActivity();
    document.addEventListener("visibilitychange", updateActivity);
    window.addEventListener("online", updateActivity);
    window.addEventListener("offline", updateActivity);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", updateActivity);
      window.removeEventListener("online", updateActivity);
      window.removeEventListener("offline", updateActivity);
    };
  }, [eventHasEnded, hasWorkingCopy]);

  if (!hasWorkingCopy || eventHasEnded) return null;

  const hasReleaseError = Boolean(autoReleaseError);

  return (
    <Alert
      className="mb-4"
      variant={hasReleaseError ? "destructive" : "default"}
      role={hasReleaseError ? "alert" : "status"}
      aria-live={hasReleaseError ? "assertive" : "off"}
    >
      <BellRingIcon aria-hidden="true" />
      <AlertTitle>{hasReleaseError ? "Schedule changes need attention" : "Schedule changes"}</AlertTitle>
      <AlertDescription>
        {hasReleaseError ? (
          <>
            <p>Release needs attention: {autoReleaseError}</p>
            <p className="mt-1 text-xs">
              <Link href="/schedule" className="font-medium underline">Open Schedule</Link> to review or revert changes.
            </p>
          </>
        ) : (
          <>
            <p>{formatScheduleReleaseCountdown(autoReleaseAt, clock, "Affected users")}.</p>
            <p className="mt-1 text-xs text-muted-foreground">Each new edit restarts the timer.</p>
          </>
        )}
      </AlertDescription>
    </Alert>
  );
}
