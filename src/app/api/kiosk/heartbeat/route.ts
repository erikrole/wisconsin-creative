import { withKiosk } from "@/lib/api";
import { KIOSK_COOKIE, tokenHash } from "@/lib/auth";
import { db } from "@/lib/db";
import { ok } from "@/lib/http";
import {
  heartbeatCanSkipDatabase,
  readCachedKioskHeartbeat,
  recordKioskBeat,
  rememberKioskHeartbeat,
  type KioskBuildReport,
} from "@/lib/kiosk-heartbeat-cache";
import { enforceRateLimit } from "@/lib/rate-limit";
import { refreshCompanionProjection } from "@/lib/services/companion-projection";

/**
 * Heartbeat endpoint — kiosk calls this periodically.
 * requireKiosk() already updates lastSeenAt, so just return ok.
 * GET is preferred (no CSRF gate); POST kept for backward-compat with deployed iOS clients.
 *
 * POST additionally accepts an optional build-identity report so the fleet is
 * legible from the server: which app version, which build, which iPadOS,
 * which model. Without it "did the new build actually land on Video Office?"
 * was unanswerable from the database.
 *
 * An unchanged beat from a kiosk the database saw recently is answered from
 * Redis without touching Neon (see kiosk-heartbeat-cache.ts).
 */

/** Trim, bound, and reject empties so a malformed client can't write junk. */
function field(value: unknown, max = 64): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

/** The optional build report in a POST body, or null when there is none. */
async function readBuildReport(req: Request): Promise<KioskBuildReport | null> {
  if (req.method !== "POST") return null;
  // Body is optional — older kiosk builds POST nothing at all.
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return null;
  const source = body as Record<string, unknown>;
  const report = {
    appVersion: field(source.appVersion),
    appBuild: field(source.appBuild),
    osVersion: field(source.osVersion),
    deviceModel: field(source.deviceModel),
  };
  return Object.values(report).some((value) => value !== null) ? report : null;
}

function kioskToken(req: Request): string | null {
  const cookie = req.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${KIOSK_COOKIE}=`));
  return cookie ? decodeURIComponent(cookie.slice(KIOSK_COOKIE.length + 1)) || null : null;
}

/**
 * Answer from Redis when the database does not need to hear about this beat.
 * Returns null to fall through to the full database heartbeat.
 */
async function cachedHeartbeat(req: Request) {
  const token = kioskToken(req);
  if (!token) return null;
  const cached = await readCachedKioskHeartbeat(await tokenHash(token));
  const now = new Date();
  // The body can only be read once, so peek at a clone.
  const report = await readBuildReport(req.clone());
  if (!heartbeatCanSkipDatabase(cached, report, now)) return null;

  await enforceRateLimit(`kiosk:heartbeat:${cached.kioskId}`, { max: 1, windowMs: 60_000 });
  await recordKioskBeat(cached.kioskId, now);
  return ok({ status: "ok", kioskId: cached.kioskId });
}

const handler = withKiosk(async (req, { kiosk }) => {
  await enforceRateLimit(`kiosk:heartbeat:${kiosk.kioskId}`, { max: 1, windowMs: 60_000 });

  const report = await readBuildReport(req);
  if (report) {
    // Only write when something actually changed. A kiosk reports the same
    // build on every heartbeat for weeks; persisting that unconditionally
    // would reintroduce exactly the per-heartbeat write we just removed so
    // the Neon compute endpoint could suspend.
    const current = await db.kioskDevice.findUnique({
      where: { id: kiosk.kioskId },
      select: { appVersion: true, appBuild: true, osVersion: true, deviceModel: true },
    });

    const changed =
      current !== null &&
      (Object.keys(report) as Array<keyof typeof report>).some(
        (key) => report[key] !== null && report[key] !== current[key]
      );

    if (changed) {
      await db.kioskDevice.update({
        where: { id: kiosk.kioskId },
        data: {
          ...(report.appVersion ? { appVersion: report.appVersion } : {}),
          ...(report.appBuild ? { appBuild: report.appBuild } : {}),
          ...(report.osVersion ? { osVersion: report.osVersion } : {}),
          ...(report.deviceModel ? { deviceModel: report.deviceModel } : {}),
          appReportedAt: new Date(),
        },
      });
      await refreshCompanionProjection({ notify: true });
    }
  }

  // requireKiosk() has just recorded this kiosk as seen (within its own
  // five-minute throttle), so the next beats can stay off Neon for a while.
  const token = kioskToken(req);
  const device = token
    ? await db.kioskDevice.findUnique({
        where: { id: kiosk.kioskId },
        select: { sessionExpiresAt: true, appVersion: true, appBuild: true, osVersion: true, deviceModel: true },
      })
    : null;
  if (token && device?.sessionExpiresAt) {
    const now = new Date();
    const { sessionExpiresAt, ...stored } = device;
    await Promise.all([
      rememberKioskHeartbeat(await tokenHash(token), {
        kioskId: kiosk.kioskId,
        sessionExpiresAt: sessionExpiresAt.toISOString(),
        dbSeenAt: now.toISOString(),
        report: stored,
      }),
      recordKioskBeat(kiosk.kioskId, now),
    ]);
  }

  return ok({ status: "ok", kioskId: kiosk.kioskId });
}, { withoutDatabase: cachedHeartbeat });

export const GET = handler;
export const POST = handler;
