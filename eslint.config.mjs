import { FlatCompat } from "@eslint/eslintrc";
import { defineConfig, globalIgnores } from "eslint/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
  baseDirectory: __dirname,
});

export default defineConfig([
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  globalIgnores([
    ".next/**",
    ".vercel/**",
    ".claude/**",
    ".codex/**",
    ".agents/**",
    ".tmp/**",
    "node_modules/**",
    "playwright-report/**",
    "test-results/**",
    "out/**",
    "build/**",
    "coverage/**",
    "next-env.d.ts",
    "src/app/.well-known/**",
    "docs/**",
    "tasks/**",
    "plans/**",
    "ios/**",
  ]),
]);
