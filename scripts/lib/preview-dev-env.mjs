import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isIP } from "node:net";

import { readDotenvValue } from "../ensure-dev-env.mjs";

export const LOCAL_SMOKE_EMAIL = "admin@creative.local";
export const DEFAULT_SESSION_COOKIE_NAME = "gear-tracker-session";
export const PREVIEW_DATABASE_NAME = "gear-tracker";
export const PRODUCTION_NEON_ENDPOINT = "ep-flat-firefly-ai889avp";

export const LOCAL_PREVIEW_OVERLAY_KEYS = Object.freeze([
  "SESSION_COOKIE_NAME",
  "BADGES_ENABLED",
  "APP_URL",
  "TRUSTED_ORIGINS",
]);

export const PLAYWRIGHT_ENV_KEYS = Object.freeze([
  "PLAYWRIGHT_EMAIL",
  "PLAYWRIGHT_PASSWORD",
  "PLAYWRIGHT_ROLE",
  "PLAYWRIGHT_BASE_URL",
  "PLAYWRIGHT_TARGET_ISOLATED",
  "PLAYWRIGHT_RELEASE",
  "PLAYWRIGHT_PRODUCTION_HOSTS",
]);

const DATABASE_URL_KEYS = ["DATABASE_URL", "DIRECT_URL", "DATABASE_URL_UNPOOLED"];

export function isLoopbackHostname(hostname) {
  const normalized = String(hostname ?? "").replace(/^\[|\]$/g, "").toLowerCase();
  return normalized === "localhost" || normalized === "::1" || (isIP(normalized) === 4 && normalized.startsWith("127."));
}

export function isLocalPostgresHost(hostname) {
  return isLoopbackHostname(hostname);
}

export function isSensitiveEnvValue(value) {
  return typeof value !== "string" || value.trim() === "" || value.trim() === "[SENSITIVE]";
}

export function parseConnectionUrl(value, label = "database URL") {
  if (isSensitiveEnvValue(value)) {
    throw new Error(`${label} is missing or marked [SENSITIVE]. Use vercel env run so the real Preview URL is injected.`);
  }
  try {
    const url = new URL(value);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname) throw new Error("Invalid PostgreSQL protocol");
    return url;
  } catch {
    throw new Error(`${label} is not a valid URL.`);
  }
}

export function assertNotProductionDatabase(value, label = "DATABASE_URL") {
  const url = parseConnectionUrl(value, label);
  if (url.hostname.includes(PRODUCTION_NEON_ENDPOINT)) {
    throw new Error(`${label} points at the production Neon endpoint. Local Preview and smoke bootstrap refuse that target.`);
  }
  return url;
}

export function rewritePreviewDatabaseUrl(value, label = "DATABASE_URL") {
  const url = assertNotProductionDatabase(value, label);
  if (isLocalPostgresHost(url.hostname)) return url.toString();

  const databaseName = url.pathname.replace(/^\//, "").split("/")[0] ?? "";
  if (databaseName === "" || databaseName === "neondb") {
    url.pathname = `/${PREVIEW_DATABASE_NAME}`;
  }
  return url.toString();
}

export function retargetPreviewDatabaseEnv(environment = {}) {
  const next = { ...environment };
  for (const key of DATABASE_URL_KEYS) {
    if (isSensitiveEnvValue(next[key])) continue;
    next[key] = rewritePreviewDatabaseUrl(next[key], key);
  }
  return next;
}

export function assertIsolatedPreviewDatabase(value, label = "DATABASE_URL") {
  const rewritten = rewritePreviewDatabaseUrl(value, label);
  const url = new URL(rewritten);
  if (isLocalPostgresHost(url.hostname)) return rewritten;
  if (url.pathname !== `/${PREVIEW_DATABASE_NAME}`) {
    throw new Error(`${label} must use the ${PREVIEW_DATABASE_NAME} database for local Preview work.`);
  }
  return rewritten;
}

export function assertLocalPreviewRuntime({ environment = process.env, baseURL } = {}) {
  if (environment.VERCEL_ENV === "production") {
    throw new Error("Local Preview bootstrap refuses Vercel production env.");
  }
  if (baseURL) {
    let parsed;
    try {
      parsed = new URL(baseURL);
    } catch {
      throw new Error("PLAYWRIGHT_BASE_URL is not a valid URL.");
    }
    if (!isLoopbackHostname(parsed.hostname)) {
      throw new Error(`Local Preview session bootstrap only targets loopback hosts, not ${parsed.hostname}.`);
    }
  }
}

export function isLocalSmokeEmail(email) {
  return String(email ?? "").trim().toLowerCase().endsWith("@creative.local");
}

export function readLocalEnvFile(rootDir, fileName = ".env.development.local") {
  const filePath = join(rootDir, fileName);
  if (!existsSync(filePath)) return { path: filePath, contents: "" };
  return { path: filePath, contents: readFileSync(filePath, "utf8") };
}

export function readLocalPreviewOverlay(rootDir) {
  const { contents } = readLocalEnvFile(rootDir);
  const overlay = {};
  for (const key of LOCAL_PREVIEW_OVERLAY_KEYS) {
    const value = readDotenvValue(contents, key);
    if (value !== undefined) overlay[key] = value;
  }
  return overlay;
}

export function applyLocalPlaywrightEnv({
  rootDir = process.cwd(),
  environment = process.env,
} = {}) {
  if (environment.CI !== undefined) return { status: "skipped", reason: "ci" };

  const { contents } = readLocalEnvFile(rootDir);
  if (!contents) return { status: "missing" };

  let applied = 0;
  for (const key of PLAYWRIGHT_ENV_KEYS) {
    if (environment[key]) continue;
    const value = readDotenvValue(contents, key);
    if (value === undefined || value === "") continue;
    environment[key] = value;
    applied += 1;
  }
  return { status: applied > 0 ? "applied" : "unchanged", applied };
}
