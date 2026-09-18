#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  ensureDevelopmentSessionCookieName,
  ensureDevelopmentSessionSecret,
  isValidSessionSecret,
  readDotenvValue,
} from "./ensure-dev-env.mjs";
import {
  DEFAULT_SESSION_COOKIE_NAME,
  LOCAL_PREVIEW_OVERLAY_KEYS,
  assertNotProductionDatabase,
  readLocalPreviewOverlay,
  retargetPreviewDatabaseEnv,
} from "./lib/preview-dev-env.mjs";

export function resolveDevelopmentSessionSecret({ rootDir = process.cwd() } = {}) {
  ensureDevelopmentSessionSecret({
    rootDir,
    environment: { NODE_ENV: "development" },
  });
  ensureDevelopmentSessionCookieName({
    rootDir,
    environment: { NODE_ENV: "development" },
  });

  for (const fileName of [".env.development.local", ".env.local"]) {
    const filePath = join(rootDir, fileName);
    if (!existsSync(filePath)) continue;

    const secret = readDotenvValue(readFileSync(filePath, "utf8"), "SESSION_SECRET");
    if (isValidSessionSecret(secret)) return secret;
  }

  throw new Error(
    "Could not resolve a valid local SESSION_SECRET for Preview dev. Run npm run dev once to bootstrap the local development secret.",
  );
}

export function buildPreviewDevEnvironment({
  baseEnvironment = process.env,
  developmentSecret,
  rootDir = process.cwd(),
} = {}) {
  if (!isValidSessionSecret(developmentSecret)) {
    throw new Error("The local development SESSION_SECRET must be at least 32 characters.");
  }

  const overlay = readLocalPreviewOverlay(rootDir);
  const next = {
    ...baseEnvironment,
    NODE_ENV: "development",
    SESSION_SECRET: developmentSecret,
  };

  for (const key of LOCAL_PREVIEW_OVERLAY_KEYS) {
    if (overlay[key] !== undefined) next[key] = overlay[key];
  }

  next.SESSION_COOKIE_NAME ||= DEFAULT_SESSION_COOKIE_NAME;
  if (overlay.APP_URL === undefined) next.APP_URL = "http://127.0.0.1:3000";
  if (overlay.BADGES_ENABLED === undefined) next.BADGES_ENABLED = "true";

  for (const key of ["DATABASE_URL", "DIRECT_URL", "DATABASE_URL_UNPOOLED"]) {
    if (!next[key] || next[key].trim() === "[SENSITIVE]") continue;
    assertNotProductionDatabase(next[key], key);
  }

  return retargetPreviewDatabaseEnv(next);
}

function startPreviewDev() {
  const rootDir = process.cwd();
  const developmentSecret = resolveDevelopmentSessionSecret({ rootDir });
  const host = process.env.NEXT_DEV_HOST ?? "127.0.0.1";
  const args = ["run", "dev", "--", "--hostname", host];
  if (process.env.NEXT_DEV_PORT !== undefined) {
    args.push("--port", process.env.NEXT_DEV_PORT);
  }

  const child = spawn(process.platform === "win32" ? "npm.cmd" : "npm", args, {
    cwd: rootDir,
    env: buildPreviewDevEnvironment({ developmentSecret, rootDir }),
    stdio: "inherit",
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => child.kill(signal));
  }

  child.once("error", (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  try {
    startPreviewDev();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
