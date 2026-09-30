import { defineConfig } from "vitest/config";
import base from "./vitest.config";

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ["tests/postgres/**/*.postgres.ts"],
    maxWorkers: 1,
    testTimeout: 15_000,
    hookTimeout: 15_000,
    coverage: { enabled: false },
  },
});
