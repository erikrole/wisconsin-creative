"use client";

import { useEffect } from "react";
import { ErrorRecoveryPanel } from "@/components/ErrorRecoveryPanel";
import { useReportProblem } from "@/components/error-reporting/ReportProblemDialog";
import { reportClientError } from "@/lib/error-reporting/client";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const reportProblem = useReportProblem();
  useEffect(() => {
    console.error("App error boundary caught:", error);
    reportClientError(error, { kind: "render_error", digest: error.digest });
  }, [error]);

  return (
    <ErrorRecoveryPanel
      title="This workspace page stopped responding"
      description="Retry before changing gear, booking, schedule, or settings data. If your session expired, sign in again and return to this workflow."
      reset={reset}
      retryLabel="Retry page"
      secondaryHref="/login"
      secondaryLabel="Sign in"
      secondaryIcon="login"
      digest={error.digest}
      onReport={reportProblem ? () => reportProblem.open() : undefined}
    />
  );
}
