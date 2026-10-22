import { Redis } from "@upstash/redis";
import { cacheNamespace, isolatedIntegrationValue } from "@/lib/environment-safety";

/**
 * Lets an idle kiosk's heartbeat skip Neon.
 *
 * Any query wakes a suspended Neon compute, reads included, and each wake
 * bills at least the five-minute suspend window. Two kiosks beating hourly
 * overnight woke production about twice an hour with nobody in the gear room.
 *
 * A heartbeat only proves the iPad is alive, so once a full database
 * heartbeat has run, the next ones within `DB_REFRESH_MS` are answered from
 * Redis. The database still sees the kiosk at least every 12 hours, which
 * keeps "stale" (under 24 hours) from ever reading as "offline". The precise
 * beat time lives in Redis and is overlaid wherever last seen is shown.
 *
 * Every other kiosk route still authenticates against the database, so an
 * admin deactivation stops real work immediately. Revoking routes also drop
 * the cached session so the next heartbeat sends the iPad to activation.
 */

export const KIOSK_HEARTBEAT_DB_REFRESH_MS = 12 * 60 * 60 * 1000;
/** Never answer from cache when the session is within a day of expiring. */
const SESSION_MARGIN_MS = 24 * 60 * 60 * 1000;

const SESSION_PREFIX = cacheNamespace("gear-tracker:kiosk:heartbeat-session:v1:");
const LAST_BEAT_KEY = cacheNamespace("gear-tracker:kiosk:last-heartbeat:v1");

export type KioskBuildReport = {
  appVersion: string | null;
  appBuild: string | null;
  osVersion: string | null;
  deviceModel: string | null;
};

export type CachedKioskHeartbeat = {
  kioskId: string;
  sessionExpiresAt: string;
  /** When the database last recorded this kiosk as seen. */
  dbSeenAt: string;
  report: KioskBuildReport;
};

let redis: Redis | null | undefined;

function getRedis(): Redis | null {
  if (redis !== undefined) return redis;
  const url = isolatedIntegrationValue("UPSTASH_REDIS_REST_URL") || isolatedIntegrationValue("KV_REST_API_URL");
  const token = isolatedIntegrationValue("UPSTASH_REDIS_REST_TOKEN") || isolatedIntegrationValue("KV_REST_API_TOKEN");
  try {
    redis = url && token && new URL(url).protocol === "https:" ? new Redis({ url, token }) : null;
  } catch {
    redis = null;
  }
  return redis;
}

/** Test hook: forget the memoized client so env changes take effect. */
export function resetKioskHeartbeatRedisForTests(client?: Redis | null) {
  redis = client;
}

/**
 * The cached session when it is safe to answer a heartbeat without Neon:
 * the database saw the kiosk recently, the session is not near expiry, and
 * the reported build has not changed. Null means take the database path.
 */
export function heartbeatCanSkipDatabase(
  cached: CachedKioskHeartbeat | null,
  report: KioskBuildReport | null,
  now: Date,
): cached is CachedKioskHeartbeat {
  if (!cached) return false;
  const nowMs = now.getTime();
  if (Date.parse(cached.dbSeenAt) + KIOSK_HEARTBEAT_DB_REFRESH_MS <= nowMs) return false;
  if (Date.parse(cached.sessionExpiresAt) - SESSION_MARGIN_MS <= nowMs) return false;
  if (report) {
    for (const key of Object.keys(report) as Array<keyof KioskBuildReport>) {
      if (report[key] !== null && report[key] !== cached.report[key]) return false;
    }
  }
  return true;
}

export async function readCachedKioskHeartbeat(tokenHash: string): Promise<CachedKioskHeartbeat | null> {
  const client = getRedis();
  if (!client) return null;
  try {
    return (await client.get<CachedKioskHeartbeat>(`${SESSION_PREFIX}${tokenHash}`)) ?? null;
  } catch {
    return null;
  }
}

export async function rememberKioskHeartbeat(tokenHash: string, value: CachedKioskHeartbeat): Promise<void> {
  const client = getRedis();
  if (!client) return;
  try {
    await client.set(`${SESSION_PREFIX}${tokenHash}`, value, {
      px: KIOSK_HEARTBEAT_DB_REFRESH_MS,
    });
  } catch {
    // The next heartbeat simply takes the database path again.
  }
}

/** Drop a kiosk's cached session. `tokenHash` is the stored `sessionToken`. */
export async function forgetKioskHeartbeat(tokenHash: string | null | undefined): Promise<void> {
  if (!tokenHash) return;
  const client = getRedis();
  if (!client) return;
  try {
    await client.del(`${SESSION_PREFIX}${tokenHash}`);
  } catch {
    // Expires on its own within the refresh window; other kiosk routes
    // already reject a revoked session.
  }
}

/** Forget the Redis heartbeat time, for a kiosk that was reset or deleted. */
export async function clearKioskBeat(kioskId: string): Promise<void> {
  const client = getRedis();
  if (!client) return;
  try {
    await client.hdel(LAST_BEAT_KEY, kioskId);
  } catch {
    // A stale beat only affects the "last seen" label until the next one.
  }
}

export async function recordKioskBeat(kioskId: string, at: Date): Promise<void> {
  const client = getRedis();
  if (!client) return;
  try {
    await client.hset(LAST_BEAT_KEY, { [kioskId]: at.toISOString() });
  } catch {
    // Last seen falls back to the database value.
  }
}

/**
 * Replace each device's `lastSeenAt` with its newest Redis heartbeat when that
 * is later than the database value.
 */
export async function withLatestKioskBeats<T extends { id: string; lastSeenAt: Date | null }>(
  devices: T[],
): Promise<T[]> {
  const client = getRedis();
  if (!client || devices.length === 0) return devices;
  let beats: Record<string, unknown> | null;
  try {
    beats = await client.hgetall<Record<string, unknown>>(LAST_BEAT_KEY);
  } catch {
    return devices;
  }
  if (!beats) return devices;
  return devices.map((device) => {
    const raw = beats[device.id];
    const beat = typeof raw === "string" ? new Date(raw) : null;
    if (!beat || Number.isNaN(beat.getTime())) return device;
    if (device.lastSeenAt && device.lastSeenAt >= beat) return device;
    return { ...device, lastSeenAt: beat };
  });
}
