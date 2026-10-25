import { defineConfig } from "@playwright/test";

/** The Brother label renderer in Chromium, with the real Gotham outlines and QR decoder. */
export default defineConfig({
  testDir: "./tests/browser", testMatch: "brother-label.spec.ts",
  outputDir: "test-results/brother-label", workers: 1, reporter: "list",
  timeout: 20_000, expect: { timeout: 5000 },
});
