import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const nextConfigSource = readFileSync("next.config.ts", "utf8");
const vercelConfig = JSON.parse(readFileSync("vercel.json", "utf8")) as {
  buildCommand?: string;
};

describe("deployment build memory", () => {
  it("keeps webpack compilation isolated and memory-optimized", () => {
    expect(nextConfigSource).toMatch(/webpackBuildWorker:\s*true/);
    expect(nextConfigSource).toMatch(/webpackMemoryOptimizations:\s*true/);
  });

  it("caps the deployment build heap below the standard Vercel limit", () => {
    expect(vercelConfig.buildCommand).toBe(
      "NODE_OPTIONS=--max-old-space-size=2048 npm run build",
    );
  });
});
