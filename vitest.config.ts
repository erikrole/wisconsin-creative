import path from "node:path";

import { defineConfig } from "vitest/config";

// Worker threads share this process's ICU timezone, and assigning
// `process.env.TZ` inside a worker does not change it. Pin the product's
// Central zone before workers start so date tests match on CI (UTC) and
// on developer machines alike.
process.env.TZ = "America/Chicago";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src")
    }
  },
  test: {
    environment: "node",
    // Worker threads start faster than forked processes for this many small files.
    pool: "threads",
    include: ["tests/**/*.test.ts", "tests/**/*.test.mjs"],
    setupFiles: ["tests/_setup.ts"],
    coverage: {
      // Server logic only: services, libraries and API routes. Pages and
      // components are mostly checked through source-contract tests, so
      // including them would only add noise until they get render tests.
      include: ["src/lib/**/*.ts", "src/app/api/**/*.ts"],
      reporter: ["text-summary", "json-summary"],
      // Floors sit just under the measured numbers (2026-10-25: lines 75.9,
      // statements 73.3, functions 74.7, branches 65.6). Raise them when
      // coverage rises; never lower them to land a change.
      thresholds: {
        statements: 73,
        branches: 65,
        functions: 74,
        lines: 75
      }
    }
  }
});
