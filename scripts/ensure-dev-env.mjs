#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

export const SESSION_SECRET_KEY = "SESSION_SECRET";
export const SESSION_COOKIE_NAME_KEY = "SESSION_COOKIE_NAME";
export const DATABASE_URL_KEY = "DATABASE_URL";
export const MIN_SESSION_SECRET_LENGTH = 32;
const GENERATED_SESSION_SECRET_BYTES = 32;
const DEFAULT_SESSION_COOKIE_NAME = "gear-tracker-session";
const DEVELOPMENT_ENV_FILES = [
  ".env.development.local",
  ".env.local",
  ".env.development",
  ".env",
];

if (isMainModule()) {
  try {
    assertDevelopmentDatabaseUrl();
    const result = ensureDevelopmentSessionSecret();
    if (result.status === "generated") {
      console.log(
        `Generated a local development SESSION_SECRET in ${relative(process.cwd(), result.path)}.`,
      );
    }
    const cookie = ensureDevelopmentSessionCookieName();
    if (cookie.status === "generated") {
      console.log(
        `Set ${SESSION_COOKIE_NAME_KEY} in ${relative(process.cwd(), cookie.path)}.`,
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

export function ensureDevelopmentSessionSecret({
  rootDir = process.cwd(),
  environment = process.env,
  randomSecret = () => randomBytes(GENERATED_SESSION_SECRET_BYTES).toString("hex"),
} = {}) {
  if (environment.NODE_ENV === "production") {
    return { status: "skipped", reason: "production" };
  }

  const processSecret = environment[SESSION_SECRET_KEY];
  if (processSecret !== undefined) {
    if (!isValidSessionSecret(processSecret)) {
      throw new Error(
        "SESSION_SECRET must be at least 32 characters. Replace the invalid shell value before running npm run dev.",
      );
    }
    return { status: "process" };
  }

  const developmentEnvPath = join(rootDir, ".env.development.local");
  if (existsSync(developmentEnvPath)) {
    const developmentSecret = readDotenvValue(
      readFileSync(developmentEnvPath, "utf8"),
      SESSION_SECRET_KEY,
    );
    if (developmentSecret !== undefined) {
      if (!isValidSessionSecret(developmentSecret)) {
        throw new Error(
          "The SESSION_SECRET in .env.development.local must be at least 32 characters. Replace it or remove that file before running npm run dev.",
        );
      }
      return { status: "development-file", path: developmentEnvPath };
    }
  }

  const localEnvPath = join(rootDir, ".env.local");
  const localSecret = existsSync(localEnvPath)
    ? readDotenvValue(readFileSync(localEnvPath, "utf8"), SESSION_SECRET_KEY)
    : undefined;
  if (isValidSessionSecret(localSecret)) {
    return { status: "local-file", path: localEnvPath };
  }

  const generatedSecret = randomSecret();
  if (!isValidSessionSecret(generatedSecret)) {
    throw new Error("The generated development SESSION_SECRET was invalid.");
  }

  writeDotenvValue(developmentEnvPath, SESSION_SECRET_KEY, generatedSecret);
  return { status: "generated", path: developmentEnvPath };
}

export function ensureDevelopmentSessionCookieName({
  rootDir = process.cwd(),
  environment = process.env,
} = {}) {
  if (environment.NODE_ENV === "production") {
    return { status: "skipped", reason: "production" };
  }

  if (environment[SESSION_COOKIE_NAME_KEY]) {
    return { status: "process" };
  }

  const developmentEnvPath = join(rootDir, ".env.development.local");
  if (existsSync(developmentEnvPath)) {
    const existing = readDotenvValue(
      readFileSync(developmentEnvPath, "utf8"),
      SESSION_COOKIE_NAME_KEY,
    );
    if (existing) return { status: "development-file", path: developmentEnvPath };
  }

  const localEnvPath = join(rootDir, ".env.local");
  if (existsSync(localEnvPath)) {
    const existing = readDotenvValue(readFileSync(localEnvPath, "utf8"), SESSION_COOKIE_NAME_KEY);
    if (existing) return { status: "local-file", path: localEnvPath };
  }

  writeDotenvValue(developmentEnvPath, SESSION_COOKIE_NAME_KEY, DEFAULT_SESSION_COOKIE_NAME);
  return { status: "generated", path: developmentEnvPath };
}

export function resolveDevelopmentDatabaseUrl({
  rootDir = process.cwd(),
  environment = process.env,
} = {}) {
  if (isValidDatabaseUrl(environment[DATABASE_URL_KEY])) {
    return { status: "process" };
  }

  for (const fileName of DEVELOPMENT_ENV_FILES) {
    const filePath = join(rootDir, fileName);
    if (!existsSync(filePath)) continue;

    const databaseUrl = readDotenvValue(
      readFileSync(filePath, "utf8"),
      DATABASE_URL_KEY,
    );
    if (isValidDatabaseUrl(databaseUrl)) {
      return { status: "file", path: filePath };
    }
  }

  return { status: "missing" };
}

export function assertDevelopmentDatabaseUrl({
  rootDir = process.cwd(),
  environment = process.env,
} = {}) {
  if (environment.NODE_ENV === "production") {
    return { status: "skipped", reason: "production" };
  }

  const result = resolveDevelopmentDatabaseUrl({ rootDir, environment });
  if (result.status === "missing") {
    throw new Error(
      "DATABASE_URL is missing for local Next development. Run npm run dev:preview for the guarded Preview environment, or set DATABASE_URL in .env.development.local.",
    );
  }

  return result;
}

export function isValidSessionSecret(value) {
  return typeof value === "string" && value.length >= MIN_SESSION_SECRET_LENGTH;
}

export function isValidDatabaseUrl(value) {
  if (typeof value !== "string" || value.trim() === "" || value.trim() === "[SENSITIVE]") {
    return false;
  }

  try {
    const url = new URL(value);
    return (url.protocol === "postgres:" || url.protocol === "postgresql:") && Boolean(url.hostname);
  } catch {
    return false;
  }
}

export function readDotenvValue(contents, key) {
  const keyPattern = new RegExp(`^\\s*(?:export\\s+)?${escapeRegExp(key)}\\s*=\\s*(.*)$`, "m");
  const match = contents.match(keyPattern);
  if (!match) return undefined;

  const value = match[1].trim();
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

export function writeDotenvValue(filePath, key, value) {
  const existing = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  const lines = existing.split(/\r?\n/);
  while (lines.at(-1) === "") lines.pop();

  const keyPattern = new RegExp(`^\\s*(?:export\\s+)?${escapeRegExp(key)}\\s*=`);
  const index = lines.findIndex((line) => keyPattern.test(line));
  const replacement = `${key}="${value}"`;
  if (index >= 0) {
    lines[index] = replacement;
  } else {
    lines.push(replacement);
  }

  writeFileSync(filePath, `${lines.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}
