import { afterEach, expect, it, vi } from "vitest";
const execute = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ db: { $executeRaw: execute } }));
vi.mock("@/lib/environment-safety", () => ({ isPreviewEnvironment: () => true }));
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); execute.mockReset(); });
it("shares a pending heartbeat and rejects both concurrent requests when retirement won", async () => {
  vi.stubEnv("WC_PREVIEW_KEY", "a".repeat(20));
  let resolve!: (value: number) => void;
  execute.mockReturnValue(new Promise<number>((done) => { resolve = done; }));
  const { recordPreviewActivity } = await import("@/lib/preview-activity");
  const first = recordPreviewActivity(), second = recordPreviewActivity();
  const outcomes = Promise.allSettled([first, second]);
  expect(execute).toHaveBeenCalledTimes(1);
  resolve(0);
  expect((await outcomes).map((result) => result.status)).toEqual(["rejected", "rejected"]);
});
it("caches only a completed successful heartbeat", async () => {
  vi.stubEnv("WC_PREVIEW_KEY", "a".repeat(20)); execute.mockResolvedValue(1);
  const { recordPreviewActivity } = await import("@/lib/preview-activity");
  await recordPreviewActivity(); await recordPreviewActivity();
  expect(execute).toHaveBeenCalledTimes(1);
});
