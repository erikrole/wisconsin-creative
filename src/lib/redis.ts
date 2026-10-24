import { Redis } from "@upstash/redis";
import { isolatedIntegrationValue } from "@/lib/environment-safety";

let client: Redis | null | undefined;

/**
 * The shared Upstash Redis client, or null when Redis is not configured.
 *
 * Credentials come through `isolatedIntegrationValue`, so a preview only ever
 * sees its own `WC_PREVIEW_*` values and never production's. A malformed or
 * non-https URL (a local placeholder) counts as unconfigured, and each caller
 * keeps its own fallback for that case. Keys still need `cacheNamespace`.
 */
export function getUpstashRedis(): Redis | null {
  if (client !== undefined) return client;
  const url = isolatedIntegrationValue("UPSTASH_REDIS_REST_URL") || isolatedIntegrationValue("KV_REST_API_URL");
  const token = isolatedIntegrationValue("UPSTASH_REDIS_REST_TOKEN") || isolatedIntegrationValue("KV_REST_API_TOKEN");
  try {
    client = url && token && new URL(url).protocol === "https:" ? new Redis({ url, token }) : null;
  } catch {
    client = null;
  }
  return client;
}

/** Test hook: forget the memoized client so environment changes take effect. */
export function resetUpstashRedisForTests() {
  client = undefined;
}
