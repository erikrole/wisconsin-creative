"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { ErrorRecoveryPanel } from "@/components/ErrorRecoveryPanel";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <ErrorRecoveryPanel
          title="Wisconsin Creative could not finish loading"
          description="Retry the app before trusting this screen. If the issue returns after signing in again, the error has been recorded for review."
          reset={reset}
          retryLabel="Retry app"
          secondaryHref="/login"
          secondaryLabel="Sign in"
          secondaryIcon="login"
          digest={error.digest}
        />
      </body>
    </html>
  );
}
