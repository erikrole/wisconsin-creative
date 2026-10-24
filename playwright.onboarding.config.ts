import { defineConfig } from "@playwright/test";

/** Component-level browser recovery proof; all network responses are fixtures. */
export default defineConfig({
  testDir: "./tests/browser", testMatch: "onboarding-continuity.spec.ts",
  outputDir: "test-results/onboarding-continuity", workers: 1, reporter: "list",
  timeout: 20_000, expect: { timeout: 5000 },
});
