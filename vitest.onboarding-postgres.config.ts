import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node", pool: "forks", maxWorkers: 1,
    include: ["tests/postgres/*.postgres.ts"],
    setupFiles: ["tests/_setup.ts"], testTimeout: 15_000, hookTimeout: 30_000,
  },
});
