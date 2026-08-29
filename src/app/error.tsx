"use client";

import { useEffect } from "react";
import { ErrorRecoveryPanel } from "@/components/ErrorRecoveryPanel";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Root error boundary caught:", error);
  }, [error]);

  return (
    <ErrorRecoveryPanel
      title="Wisconsin Creative could not recover this page"
      description="Retry the page before acting on the visible state. If the problem returns, go back to the dashboard and reopen the workflow."
      reset={reset}
      retryLabel="Retry page"
      secondaryHref="/"
      secondaryLabel="Dashboard"
      digest={error.digest}
    />
  );
}
