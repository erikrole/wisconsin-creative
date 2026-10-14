import { defineConfig } from "@playwright/test";

/** Browser-only gear picker regressions with local API fixtures; no credentials or database. */
export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "gear-picks.spec.ts",
  outputDir: "test-results/gear-picker",
  workers: 1,
  reporter: "list",
  timeout: 15_000,
  expect: { timeout: 3000 },
});
