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
      include: [
        "src/lib/services/**",
        "src/lib/rbac.ts",
        "src/lib/permissions.ts",
        "src/lib/api.ts"
      ],
      thresholds: {
        statements: 70,
        // Accepted Vitest 4 AST-remapping baseline; see docs/TESTING.md.
        // Raise these floors as owner coverage improves.
        branches: 63.28,
        functions: 75.74,
        lines: 70
      }
    }
  }
});
