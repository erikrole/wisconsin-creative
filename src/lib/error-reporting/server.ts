import { waitUntil } from "@vercel/functions";
import type { ErrorReportInput } from "./grouping";
import { routeTemplate } from "./grouping";

/**
 * Records an unexpected server failure as an error report without slowing or
 * breaking the response: the write runs after the response through
 * `waitUntil`, the database module loads lazily (public routes import this
 * path too), and a failed write is only logged.
 */

type ServerErrorContext = {
  kind: "api_error" | "render_error";
  method?: string | null;
  path?: string | null;
  /** Next route template such as `/bookings/[id]`, when Next provides one. */
  routePath?: string | null;
  headers?: Headers | null;
  user?: { id: string; role: string } | null;
};

/** Control-flow throws from Next (redirect, notFound, dynamic bailout) are not failures. */
function isNextControlFlow(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && /^(NEXT_REDIRECT|NEXT_NOT_FOUND|NEXT_HTTP_ERROR_FALLBACK|DYNAMIC_SERVER_USAGE|BAILOUT_TO_CLIENT_SIDE_RENDERING)/.test(digest);
}

/** Expected HTTP outcomes (401, 404, 409, ...) thrown during a render are not failures either. */
function isExpectedHttpError(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" && status < 500;
}

export function deployInfo() {
  return {
    appBuild: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    releaseChannel: process.env.VERCEL_ENV ?? (process.env.NODE_ENV === "production" ? "production" : "development"),
  };
}

export function buildServerErrorReport(error: unknown, context: ServerErrorContext): ErrorReportInput | null {
  if (isNextControlFlow(error) || isExpectedHttpError(error)) return null;
  const err = error instanceof Error ? error : new Error(typeof error === "string" ? error : "Non-error thrown");
  const route = context.routePath ?? routeTemplate(context.path);
  const method = context.method?.toUpperCase();
  const digest = (error as { digest?: unknown }).digest;
  return {
    platform: "server",
    kind: context.kind,
    name: err.name,
    message: err.message,
    stack: err.stack ?? null,
    culprit: [method && context.kind === "api_error" ? method : null, route].filter(Boolean).join(" ") || null,
    screen: context.path ? context.path.split(/[?#]/)[0] : null,
    requestId: context.headers?.get("x-vercel-id") ?? context.headers?.get("x-request-id") ?? null,
    digest: typeof digest === "string" ? digest : null,
    ...deployInfo(),
  };
}

export function captureServerError(error: unknown, context: ServerErrorContext): void {
  const report = buildServerErrorReport(error, context);
  if (!report) return;
  const task = import("@/lib/services/error-reports")
    .then(({ recordErrorReport }) => recordErrorReport(report, context.user ?? null))
    .then(() => undefined)
    .catch((recordError: unknown) => {
      console.error("event=error_report_write_failed", {
        error: recordError instanceof Error ? recordError.message : String(recordError),
      });
    });
  try {
    waitUntil(task);
  } catch {
    void task;
  }
}
