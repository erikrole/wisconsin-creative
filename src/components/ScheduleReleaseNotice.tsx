"use client";

import { useEffect, useState } from "react";
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
  const eventHasEnded = eventEndsAt ? new Date(eventEndsAt).getTime() <= clock : false;

  useEffect(() => {
    if (!hasWorkingCopy || eventHasEnded) return;
    const timer = window.setInterval(() => {
      setClock(Date.now());
      void onRefresh?.();
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [eventHasEnded, hasWorkingCopy, onRefresh]);

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
