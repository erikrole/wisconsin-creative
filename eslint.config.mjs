import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    // eslint-plugin-react-hooks 7 (via eslint-config-next 16) ships React
    // Compiler rules as errors. The existing code predates them; keep them
    // visible as warnings and burn them down per area instead of blocking CI.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/incompatible-library": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
    },
  },
  {
    // Static tools under public/ are plain browser scripts that swallow errors on purpose.
    files: ["public/**/*.js"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
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
    // Third-party distribution bundles retain their upstream module wrappers.
    "public/qrcode/vendor/**",
    "src/app/.well-known/**",
    "docs/**",
    "tasks/**",
    "plans/**",
    "ios/**",
  ]),
]);
