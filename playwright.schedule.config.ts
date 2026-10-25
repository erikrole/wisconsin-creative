import { defineConfig } from "@playwright/test";

/** The real Schedule list timeline in Chromium; all data is local fixtures. */
export default defineConfig({
  testDir: "./tests/browser", testMatch: "schedule-list.spec.ts",
  outputDir: "test-results/schedule-list", workers: 1, reporter: "list",
  timeout: 20_000, expect: { timeout: 5000 },
});
