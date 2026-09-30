import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkRateLimit, enforceRateLimit, isRateLimitExhausted } from "@/lib/rate-limit";

// No UPSTASH_REDIS_REST_* env in the test environment, so checkRateLimit
// exercises the in-memory fallback sliding window.

describe("rate-limit in-memory fallback", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("allows up to max requests then blocks within the window", async () => {
    const key = `test:block:${Math.random()}`;
    const config = { max: 3, windowMs: 60_000 };

    for (let i = 0; i < 3; i++) {
      const result = await checkRateLimit(key, config);
      expect(result.allowed).toBe(true);
    }
    const blocked = await checkRateLimit(key, config);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it("resets after the window elapses", async () => {
    const key = `test:reset:${Math.random()}`;
    const config = { max: 1, windowMs: 1_000 };

    expect((await checkRateLimit(key, config)).allowed).toBe(true);
    expect((await checkRateLimit(key, config)).allowed).toBe(false);

    vi.advanceTimersByTime(1_001);
    expect((await checkRateLimit(key, config)).allowed).toBe(true);
  });

  it("isRateLimitExhausted peeks without consuming quota", async () => {
    const key = `test:peek:${Math.random()}`;
    const config = { max: 2, windowMs: 60_000 };

    expect(await isRateLimitExhausted(key, config)).toBe(false);
    expect(await isRateLimitExhausted(key, config)).toBe(false);
    await checkRateLimit(key, config);
    expect(await isRateLimitExhausted(key, config)).toBe(false);
    await checkRateLimit(key, config);
    expect(await isRateLimitExhausted(key, config)).toBe(true);

    vi.advanceTimersByTime(60_001);
    expect(await isRateLimitExhausted(key, config)).toBe(false);
  });

  it("enforceRateLimit throws HttpError(429) once the limit is exceeded", async () => {
    const key = `test:enforce:${Math.random()}`;
    const config = { max: 1, windowMs: 60_000 };

    await expect(enforceRateLimit(key, config)).resolves.toBeUndefined();
    await expect(enforceRateLimit(key, config)).rejects.toMatchObject({ status: 429 });
  });

  it("treats a malformed Redis URL as unconfigured instead of breaking auth", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "redis-placeholder");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "local-placeholder-token");
    vi.resetModules();
    const { checkRateLimit: checkWithInvalidRedis } = await import("@/lib/rate-limit");

    await expect(checkWithInvalidRedis(`test:invalid-redis:${Math.random()}`, {
      max: 1,
      windowMs: 60_000,
    })).resolves.toMatchObject({ allowed: true, remaining: 0 });
  });
});
