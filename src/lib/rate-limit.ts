/**
 * Rate limiter for serverless API routes.
 *
 * Uses Upstash Redis (cross-instance, survives cold starts) when
 * UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (or the Vercel
 * Marketplace KV_REST_API_* equivalents) are configured. Otherwise, and on
 * any Redis error, it falls back to a per-instance in-memory sliding window
 * so local dev and previews work with zero setup and a Redis outage can
 * never take down auth/login.
 */

import { Ratelimit } from "@upstash/ratelimit";
import { HttpError } from "./http";
import { Redis } from "@upstash/redis";
import { cacheNamespace, isolatedIntegrationValue } from "@/lib/environment-safety";

type RateLimitConfig = {
  /** Maximum requests allowed in the window. */
  max: number;
  /** Window duration in milliseconds. */
  windowMs: number;
};

type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
};

// --- In-memory fallback (per-instance sliding window) ---

type Entry = { count: number; resetAt: number };
const memStore = new Map<string, Entry>();

const PRUNE_INTERVAL = 60_000;
let lastPrune = Date.now();

function prune() {
  const now = Date.now();
  if (now - lastPrune < PRUNE_INTERVAL) return;
  lastPrune = now;
  for (const [key, entry] of memStore) {
    if (entry.resetAt <= now) memStore.delete(key);
  }
}

function checkRateLimitMemory(key: string, config: RateLimitConfig): RateLimitResult {
  prune();
  const now = Date.now();
  const entry = memStore.get(key);

  if (!entry || entry.resetAt <= now) {
    memStore.set(key, { count: 1, resetAt: now + config.windowMs });
    return { allowed: true, remaining: config.max - 1, resetAt: now + config.windowMs };
  }

  entry.count++;
  if (entry.count > config.max) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  return { allowed: true, remaining: config.max - entry.count, resetAt: entry.resetAt };
}

// --- Upstash Redis backend (lazy, memoized) ---

let redis: Redis | null | undefined;

function getRedis(): Redis | null {
  if (redis !== undefined) return redis;
  const url = isolatedIntegrationValue("UPSTASH_REDIS_REST_URL") || isolatedIntegrationValue("KV_REST_API_URL");
  const token = isolatedIntegrationValue("UPSTASH_REDIS_REST_TOKEN") || isolatedIntegrationValue("KV_REST_API_TOKEN");
  if (!url || !token) {
    redis = null;
    return redis;
  }

  try {
    const parsedUrl = new URL(url);
    redis = parsedUrl.protocol === "https:" ? new Redis({ url, token }) : null;
  } catch {
    // Malformed or placeholder local configuration is equivalent to Redis
    // being unconfigured. Keep auth available through the memory fallback.
    redis = null;
  }
  return redis;
}

// One ephemeral cache shared by every limiter so repeated hits in the same
// instance short-circuit without a Redis round-trip.
const ephemeralCache = new Map<string, number>();
const limiterCache = new Map<string, Ratelimit>();

function getLimiter(config: RateLimitConfig): Ratelimit | null {
  const client = getRedis();
  if (!client) return null;

  const cacheKey = `${config.max}:${config.windowMs}`;
  let limiter = limiterCache.get(cacheKey);
  if (!limiter) {
    // Window is expressed in whole seconds; all presets are >= 1s multiples.
    const windowSec = Math.max(1, Math.ceil(config.windowMs / 1000));
    limiter = new Ratelimit({
      redis: client,
      limiter: Ratelimit.slidingWindow(config.max, `${windowSec} s`),
      analytics: false,
      prefix: cacheNamespace("gear-tracker:rl"),
      ephemeralCache,
    });
    limiterCache.set(cacheKey, limiter);
  }
  return limiter;
}

/**
 * Check if a request is within rate limits.
 *
 * @param key - Unique identifier (e.g., "login:192.168.1.1")
 * @param config - Rate limit configuration
 * @returns Whether the request is allowed and remaining quota
 */
export async function checkRateLimit(
  key: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const limiter = getLimiter(config);
  if (limiter) {
    try {
      const { success, remaining, reset } = await limiter.limit(key);
      return { allowed: success, remaining, resetAt: reset };
    } catch {
      // Redis unreachable: degrade to in-memory rather than fail the request.
      return checkRateLimitMemory(key, config);
    }
  }
  return checkRateLimitMemory(key, config);
}

/**
 * Get the client IP from a request (respects x-forwarded-for for proxied environments).
 */
export function getClientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || req.headers.get("x-real-ip")
    || "unknown";
}

/**
 * Enforce a rate limit on a route handler. Throws HttpError(429) if exceeded.
 *
 * Caller decides the bucket key - usually `${scope}:${user.id}` for user-scoped
 * limits or `${scope}:${ip}` for unauthenticated routes.
 */
export async function enforceRateLimit(
  key: string,
  config: RateLimitConfig
): Promise<void> {
  const result = await checkRateLimit(key, config);
  if (!result.allowed) {
    const retryAfterSec = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
    throw new HttpError(429, `Too many requests. Try again in ${retryAfterSec}s.`);
  }
}

/** Common preset for admin-surface mutation endpoints (settings, etc.). */
export const SETTINGS_MUTATION_LIMIT: RateLimitConfig = {
  max: 60,
  windowMs: 60_000,
};

/** Common preset for bounded report CSV export endpoints. */
export const REPORT_EXPORT_LIMIT: RateLimitConfig = {
  max: 10,
  windowMs: 60_000,
};

/**
 * Common preset for worker-facing scheduling mutations (trade claim/cancel,
 * open-shift pickup, assignment acknowledge/decline, staff trade decisions).
 * Sized well above a real student's tap rate on the Trade Board while capping
 * scripted claim-spam against contested shifts.
 */
export const SCHEDULE_MUTATION_LIMIT: RateLimitConfig = {
  max: 30,
  windowMs: 60_000,
};

/**
 * Common preset for image write endpoints (asset/bulk-SKU uploads and
 * URL mirroring). Sized for intake sessions, where staff attach images to
 * many items in a row, while still capping blob writes and outbound
 * mirror fetches from a compromised account.
 */
export const IMAGE_MUTATION_LIMIT: RateLimitConfig = {
  max: 60,
  windowMs: 60 * 60_000,
};

/** Capture saves can upload two artifacts and must stay bounded per operator. */
export const SIGNATURE_CAPTURE_LIMIT: RateLimitConfig = {
  max: 30,
  windowMs: 60_000,
};

/** Roster fetches are outbound source reads and should not be spammed. */
export const SIGNATURE_IMPORT_LIMIT: RateLimitConfig = {
  max: 12,
  windowMs: 60 * 60_000,
};

/** Signature collection mutations should be deliberate and bounded. */
export const SIGNATURE_MUTATION_LIMIT: RateLimitConfig = {
  max: 60,
  windowMs: 60_000,
};
