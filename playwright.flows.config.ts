import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end flow tests. `npm run test:e2e:flows` (scripts/test-e2e-flows.mjs)
 * owns the disposable PostgreSQL cluster and the app server and sets
 * E2E_FLOWS_BASE_URL; this config never points at a deployed host.
 */
const baseURL = process.env.E2E_FLOWS_BASE_URL;
if (!baseURL) throw new Error("Run the flow tests through `npm run test:e2e:flows`.");

export default defineConfig({
  testDir: "./tests/e2e-flows",
  outputDir: "test-results/e2e-flows/results",
  reporter: process.env.CI ? [["list"], ["html", { outputFolder: "test-results/e2e-flows/report", open: "never" }]] : "list",
  // The flows share one seeded database and build on each other's state.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    // The people are in Madison; the server (like Vercel) is not.
    timezoneId: "America/Chicago",
    locale: "en-US",
    // Mutating API routes require a same-origin Origin header (CSRF).
    extraHTTPHeaders: { origin: baseURL },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "sign-in", testMatch: /auth\.setup\.ts/ },
    { name: "flows", testMatch: /.*\.flow\.ts/, dependencies: ["sign-in"] },
  ],
});
