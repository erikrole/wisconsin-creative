import { createHash } from "node:crypto";
import type { Redis } from "@upstash/redis";
import { cacheNamespace } from "@/lib/environment-safety";
import { hashIcsToken, isHashedIcsToken } from "@/lib/ics-token";
import { getUpstashRedis } from "@/lib/redis";
import { readScheduleRevision } from "@/lib/schedule-live";

/**
 * Lets a subscribed calendar's poll skip Neon.
 *
 * Calendar apps re-fetch a subscribed feed on their own clock, hourly or
 * more, day and night, from every phone and laptop that holds the link. Each
 * poll ran two queries, and any query wakes a suspended Neon compute for at
 * least the five-minute suspend window, so a handful of subscribers kept
 * production awake around the clock with nobody using the app.
 *
 * A rendered feed is kept in Redis with the schedule revision it was built
 * from. Every successful schedule edit bumps that revision (see
 * `schedule-live`) and the nightly refresh bumps it after syncing calendars, so
 * a cached feed is served only while nothing it could show has changed. An
 * unknown token is remembered too: a rotated or revoked link keeps polling
 * from the old calendar forever, and it must not keep waking the database.
 *
 * Keys are the stored (hashed) token form, so a rotation can drop the old
 * feed by the value it replaces. Without Redis every request takes the
 * database path, exactly as before.
 */

const FEED_PREFIX = cacheNamespace("gear-tracker:shifts:ics-feed:v1:");
/** Safety net only; the revision check is what keeps a feed current. */
const FEED_TTL_SECONDS = 24 * 60 * 60;

export type CachedIcsFeed =
  | { status: 200; revision: number; etag: string; body: string }
  | { status: 404 };

let redisOverride: Redis | null | undefined;

function getRedis(): Redis | null {
  return redisOverride !== undefined ? redisOverride : getUpstashRedis();
}

/** Test hook: pin a client (or null), or pass undefined to use the shared one. */
export function resetIcsFeedRedisForTests(client?: Redis | null) {
  redisOverride = client;
}

/** The cache key for a token in either its raw or its stored form. */
export function icsFeedCacheKey(rawOrStored: string): string {
  return `${FEED_PREFIX}${isHashedIcsToken(rawOrStored) ? rawOrStored : hashIcsToken(rawOrStored)}`;
}

export function icsFeedEtag(body: string): string {
  return `"${createHash("sha256").update(body).digest("hex").slice(0, 32)}"`;
}

/**
 * The schedule revision to build against, plus the cached feed when it is
 * still current: a 404 for a token the database did not know, or a body built
 * from that same revision. A null feed means take the database path and
 * remember the result; a null revision means Redis is unavailable.
 */
export async function lookupIcsFeed(key: string): Promise<{ revision: number | null; feed: CachedIcsFeed | null }> {
  const client = getRedis();
  if (!client) return { revision: null, feed: null };
  try {
    const [revision, feed] = await Promise.all([readScheduleRevision(), client.get<CachedIcsFeed>(key)]);
    if (revision === null || !feed) return { revision, feed: null };
    if (feed.status === 404 || feed.revision === revision) return { revision, feed };
    return { revision, feed: null };
  } catch {
    return { revision: null, feed: null };
  }
}

export async function rememberIcsFeed(key: string, feed: CachedIcsFeed): Promise<void> {
  const client = getRedis();
  if (!client) return;
  try {
    await client.set(key, feed, { ex: FEED_TTL_SECONDS });
  } catch {
    // The next poll simply takes the database path again.
  }
}

/** Drop a feed by its stored token value, for a token that was rotated or revoked. */
export async function forgetIcsFeed(stored: string | null | undefined): Promise<void> {
  if (!stored) return;
  const client = getRedis();
  if (!client) return;
  try {
    await client.del(icsFeedCacheKey(stored));
  } catch {
    // Expires with the next schedule revision or within a day.
  }
}
