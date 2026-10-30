import { cacheNamespace } from "@/lib/environment-safety";
import { getUpstashRedis } from "@/lib/redis";

/**
 * Live schedule signal. Every successful schedule edit bumps one Redis counter;
 * open Schedule pages compare it against the last value they saw and refetch
 * only when it moves. Reading it never touches Neon.
 */
const REVISION_KEY = cacheNamespace("gear-tracker:schedule:revision:v1");

const SCHEDULE_PREFIXES = [
  "/api/shift-groups",
  "/api/shifts",
  "/api/shift-assignments",
  "/api/shift-trades",
  "/api/schedule/",
  "/api/calendar-events",
];

export function isScheduleMutation(req: Request, response: Response): boolean {
  if (!response.ok || req.method === "GET" || req.method === "HEAD") return false;
  const path = new URL(req.url).pathname;
  return SCHEDULE_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`));
}

export async function bumpScheduleRevision(): Promise<void> {
  try {
    await getUpstashRedis()?.incr(REVISION_KEY);
  } catch (error) {
    console.error("[ScheduleLive] revision bump failed", error);
  }
}

/** Null when Redis is unavailable, so clients keep their current data. */
export async function readScheduleRevision(): Promise<number | null> {
  try {
    const redis = getUpstashRedis();
    if (!redis) return null;
    return Number((await redis.get<number>(REVISION_KEY)) ?? 0);
  } catch {
    return null;
  }
}
