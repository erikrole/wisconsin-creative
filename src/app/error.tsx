"use client";

import { useEffect } from "react";
import { ErrorRecoveryPanel } from "@/components/ErrorRecoveryPanel";
import { reportClientError } from "@/lib/error-reporting/client";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Root error boundary caught:", error);
    reportClientError(error, { kind: "render_error", digest: error.digest });
  }, [error]);

  return (
    <ErrorRecoveryPanel
      title="Wisconsin Creative could not recover this page"
      description="Retry the page before acting on the visible state. If the problem returns, go back to Home and reopen the workflow."
      reset={reset}
      retryLabel="Retry page"
      secondaryHref="/"
      secondaryLabel="Home"
      digest={error.digest}
    />
  );
}
