import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const nextConfigSource = readFileSync("next.config.ts", "utf8");

describe("deployment build memory", () => {
  it("keeps webpack compilation isolated and memory-optimized", () => {
    expect(nextConfigSource).toMatch(/webpackBuildWorker:\s*true/);
    expect(nextConfigSource).toMatch(/webpackMemoryOptimizations:\s*true/);
  });
});
