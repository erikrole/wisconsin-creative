import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createServer } from "node:net";
import { neon } from "@neondatabase/serverless";
import { identitySql, loadMigrationBaseline, readInfrastructureConfig } from "./migration-baseline.mjs";

export function branchKey(branch) {
  if (!branch || branch === "HEAD" || /[\r\n\0]/.test(branch) || ["main", "master"].includes(branch)) {
    throw new Error("Use a named feature branch for a preview; main and detached checkouts are refused.");
  }
  return createHash("sha256").update(branch).digest("hex").slice(0, 20);
}
export function currentBranch(root = process.cwd()) {
  return execFileSync("git", ["branch", "--show-current"], { cwd: root, encoding: "utf8" }).trim();
}
export function previewStatePath(branch, root = process.cwd()) {
  const common = resolve(root, execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd: root, encoding: "utf8" }).trim());
  return join(dirname(common), ".tmp", "preview-environments", `${branchKey(branch)}.json`);
}
export function savePreviewState(state, root = process.cwd()) {
  const path = previewStatePath(state.gitBranch, root);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
  return path;
}
export function readPreviewState(root = process.cwd()) {
  const branch = currentBranch(root);
  const path = previewStatePath(branch, root);
  if (!existsSync(path)) throw new Error("This branch has no managed preview. Run npm run preview:setup or attach its provisioned environment first.");
  const state = JSON.parse(readFileSync(path, "utf8"));
  if (state.gitBranch !== branch || state.key !== branchKey(branch)) throw new Error("Preview handoff state belongs to another Git branch.");
  return state;
}
export function assertPreviewUrls(state, config = readInfrastructureConfig()) {
  if (state.key !== branchKey(state.gitBranch)) throw new Error("Preview branch key does not match its Git branch.");
  if (state.projectId !== config.preview.projectId || state.branchId === config.preview.templateBranchId) {
    throw new Error("Preview state does not target an isolated child in the preview project.");
  }
  for (const key of ["DATABASE_URL", "DIRECT_URL", "DATABASE_URL_UNPOOLED"]) {
    const url = new URL(state.environment[key]);
    const endpoint = url.hostname.split(".")[0].replace(/-pooler$/, "");
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname.endsWith(".neon.tech")
      || endpoint !== state.endpointId || decodeURIComponent(url.pathname.slice(1)) !== config.preview.database
      || (key !== "DATABASE_URL" && url.hostname.includes("-pooler."))) throw new Error(`Preview ${key} does not match its attested endpoint and database.`);
  }
}
export async function verifyPreviewState(state, checksums, config = readInfrastructureConfig(), { allowCleanup = false } = {}) {
  assertPreviewUrls(state, config);
  const sql = neon(state.environment.DIRECT_URL);
  const [identity] = await sql.query(identitySql);
  if (identity.branch !== state.branchId || identity.endpoint !== state.endpointId || identity.database !== config.preview.database) {
    throw new Error("Live database identity differs from this branch's preview state.");
  }
  const baseline = await loadMigrationBaseline(sql, checksums);
  if (!baseline || baseline.approval?.kind !== "sanitized-child" || baseline.approval.gitBranch !== state.gitBranch) {
    throw new Error("Preview is missing its signed branch and template provenance.");
  }
  const [runtime] = await sql.query("SELECT to_jsonb(r)->>'cleanup_started_at' AS cleanup_started_at FROM wc_preview_meta.runtime r WHERE id=true");
  if (!runtime || (runtime.cleanup_started_at && !allowCleanup)) throw new Error("Preview is being retired or has incomplete runtime metadata; do not reuse its credentials.");
  return { sql, baseline };
}

// Empty values intentionally override .env.local when Next loads dotenv files.
// Operator keys are never inherited by the application child process.
export const blockedPreviewKeys = Object.freeze([
  "NEON_API_KEY", "NEON_PREVIEW_API_KEY", "VERCEL_TOKEN", "VERCEL_PREVIEW_TOKEN", "GH_TOKEN", "GITHUB_TOKEN", "PREVIEW_SIGNING_KEY",
  "RESEND_API_KEY", "APNS_P8_KEY", "APNS_KEY_ID", "APNS_TEAM_ID", "APNS_BUNDLE_ID", "APNS_MACOS_BUNDLE_ID",
  "WEB_PUSH_VAPID_PRIVATE_KEY", "WEB_PUSH_VAPID_PUBLIC_KEY", "WEB_PUSH_SUBJECT", "CRON_SECRET",
  "BLOB_READ_WRITE_TOKEN", "SIGNATURE_BLOB_READ_WRITE_TOKEN", "SIGNATURE_BLOB_STORE_ID", "RESOURCE_ASSET_BLOB_READ_WRITE_TOKEN",
  "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_URL", "KV_REST_API_TOKEN",
  "SENTRY_DSN", "NEXT_PUBLIC_SENTRY_DSN", "SENTRY_AUTH_TOKEN", "BRAVE_SEARCH_API_KEY", "VERCEL_OIDC_TOKEN",
  "SEED_ADMIN_PASSWORD", "SEED_ENDPOINT_ENABLED", "APP_REVIEW_DEMO_PASSWORD",
  "VERCEL_AUTOMATION_BYPASS_SECRET",
  "INTERNAL_OPERATOR_EMAILS", "USAGE_ANALYTICS_OWNER_EMAILS", "USAGE_ANALYTICS_HASH_SECRET",
]);
const runtimeKeys = new Set([
  "DATABASE_URL", "DIRECT_URL", "DATABASE_URL_UNPOOLED", "SESSION_SECRET", "SOFTWARE_VAULT_KEY", "PLAYWRIGHT_PASSWORD",
  "WC_PREVIEW_BLOB_READ_WRITE_TOKEN", "WC_PREVIEW_SIGNATURE_BLOB_READ_WRITE_TOKEN", "WC_PREVIEW_RESOURCE_ASSET_BLOB_READ_WRITE_TOKEN",
  "WC_PREVIEW_UPSTASH_REDIS_REST_URL", "WC_PREVIEW_UPSTASH_REDIS_REST_TOKEN",
]);
export function previewRuntimeEnvironment(state) {
  return {
    ...Object.fromEntries(Object.entries(state.environment).filter(([key, value]) => runtimeKeys.has(key) && typeof value === "string")),
    WC_ENVIRONMENT: "preview", WC_PREVIEW_BRANCH: state.branchId, WC_PREVIEW_KEY: state.key,
    SESSION_COOKIE_NAME: `wc-preview-${state.key}`, BADGES_ENABLED: "true",
  };
}
export function localPreviewEnvironment(state, port, base = process.env) {
  assertPreviewUrls(state);
  const origin = `http://127.0.0.1:${port}`;
  const inherited = Object.fromEntries(Object.entries(base).filter(([key]) => /^(PATH|HOME|USER|SHELL|TMPDIR|TMP|TEMP|LANG|LC_.*|TERM|COLORTERM|CI|NODE_OPTIONS|npm_.*)$/.test(key)));
  return {
    ...inherited, ...Object.fromEntries(blockedPreviewKeys.map((key) => [key, ""])), ...previewRuntimeEnvironment(state),
    VERCEL: "", VERCEL_ENV: "development", VERCEL_URL: "", NODE_ENV: "development",
    WC_ENVIRONMENT: "preview", WC_PREVIEW_BRANCH: state.branchId, WC_PREVIEW_KEY: state.key,
    APP_URL: origin, TRUSTED_ORIGINS: origin, PASSKEY_RP_ID: "127.0.0.1", PASSKEY_ORIGINS: origin,
    SESSION_COOKIE_NAME: `wc-preview-${state.key}-${port}`, PLAYWRIGHT_BASE_URL: origin,
    PLAYWRIGHT_TARGET_ISOLATED: "1", PLAYWRIGHT_EMAIL: "admin@creative.local", PLAYWRIGHT_ROLE: "ADMIN",
    NEXT_DEV_HOST: "127.0.0.1", NEXT_DEV_PORT: String(port), BADGES_ENABLED: "true",
  };
}
export async function availablePreviewPort(root = process.cwd(), requested = process.env.NEXT_DEV_PORT) {
  const start = requested === undefined ? 3100 + (parseInt(createHash("sha256").update(root).digest("hex").slice(0, 6), 16) % 2000) : Number(requested);
  if (!Number.isInteger(start) || start < 1024 || start > 65535) throw new Error("NEXT_DEV_PORT must be an integer from 1024 through 65535.");
  for (let offset = 0; offset < (requested ? 1 : 100); offset += 1) {
    const port = start + offset;
    const free = await new Promise((resolve) => {
      const server = createServer(); server.once("error", () => resolve(false));
      server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
    });
    if (free) return port;
  }
  throw new Error("Preview port is occupied. The existing process was left alone; choose NEXT_DEV_PORT explicitly.");
}
