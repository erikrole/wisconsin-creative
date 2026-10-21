import * as Sentry from "@sentry/nextjs";
import type { Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.SENTRY_DSN) {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      tracesSampleRate: 0.1,
    });
  }

  if (process.env.NEXT_RUNTIME === "edge" && process.env.SENTRY_DSN) {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      tracesSampleRate: 0.1,
    });
  }
}

/**
 * Render and server-action failures that escape to Next. API routes catch
 * their own errors in `failRequest`, so they are not counted twice here.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  Sentry.captureRequestError(error, request, context);
  // The runtime check must wrap the import so the edge bundle drops it:
  // error reporting uses Node crypto and the database.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (context.routeType === "route") return;
    const { captureServerError } = await import("@/lib/error-reporting/server");
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (typeof value === "string") headers.set(key, value);
    }
    captureServerError(error, {
      kind: "render_error",
      method: request.method,
      path: request.path,
      routePath: context.routePath,
      headers,
    });
  }
};
