import { NextResponse } from "next/server";
import { withCron } from "@/lib/cron";
import { processOverdueNotifications } from "@/lib/services/notifications";
import { processLicenseNags, processExpiryWarnings } from "@/lib/services/licenses";

/**
 * GET /api/cron/notifications
 * Called by Vercel Cron daily at 9:00 AM UTC (see vercel.json). Validates CRON_SECRET bearer token.
 * No user session required — runs as a system job.
 */
export const GET = withCron(async () => {
  const [overdueResult, licenseNagResult, expiryResult] = await Promise.allSettled([
    processOverdueNotifications(),
    processLicenseNags(),
    processExpiryWarnings(),
  ]);

  const errors: Record<string, string> = {};
  const failedJobs: string[] = [];

  function valueOrFallback<T>(
    name: string,
    result: PromiseSettledResult<T>,
    fallback: T,
  ): T {
    if (result.status === "fulfilled") return result.value;
    const message = result.reason instanceof Error ? result.reason.message : "Unknown error";
    failedJobs.push(name);
    errors[name] = message;
    console.error(`Notification cron ${name} job failed`, result.reason);
    return fallback;
  }

  // `remaining` / `truncated` say how many open checkouts the sweep's 500-row cap
  // left unscanned, so a backlog shows up in the cron response instead of vanishing.
  const overdue = valueOrFallback("overdue", overdueResult, {
    scanned: 0,
    notificationsCreated: 0,
    remaining: 0,
    truncated: false,
  });
  const licenseNags = valueOrFallback("licenseNags", licenseNagResult, { nagged: 0 });
  const licenseExpiry = valueOrFallback("licenseExpiry", expiryResult, { warned: 0 });

  return NextResponse.json({
    ok: failedJobs.length === 0,
    ...overdue,
    licenseNags,
    licenseExpiry,
    ...(failedJobs.length > 0 ? { partialFailures: failedJobs, errors } : {}),
  });
});
