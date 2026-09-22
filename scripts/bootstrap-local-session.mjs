#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import bcrypt from "bcryptjs";
import { neon } from "@neondatabase/serverless";

import {
  readDotenvValue,
  writeDotenvValue,
} from "./ensure-dev-env.mjs";
import {
  DEFAULT_SESSION_COOKIE_NAME,
  LOCAL_SMOKE_EMAIL,
  assertIsolatedPreviewDatabase,
  assertLocalPreviewRuntime,
  isLocalSmokeEmail,
  isSensitiveEnvValue,
  readLocalEnvFile,
} from "./lib/preview-dev-env.mjs";

const DEFAULT_BASE_URL = "http://127.0.0.1:3000";
const AUTH_FILE = "test-results/playwright/auth/user.json";
const DEFAULT_ROLE = "ADMIN";

export function resolveSmokeBootstrapTarget({
  environment = process.env,
  rootDir = process.cwd(),
} = {}) {
  const localEnv = readLocalEnvFile(rootDir).contents;
  const baseURL = environment.PLAYWRIGHT_BASE_URL
    || readDotenvValue(localEnv, "PLAYWRIGHT_BASE_URL")
    || DEFAULT_BASE_URL;
  assertLocalPreviewRuntime({ environment, baseURL });

  const rawDatabaseUrl = environment.DATABASE_URL_UNPOOLED
    || environment.DIRECT_URL
    || environment.DATABASE_URL
    || "";
  const connectionString = assertIsolatedPreviewDatabase(rawDatabaseUrl);
  const parsed = new URL(connectionString);

  return {
    baseURL,
    connectionString,
    dbHost: parsed.hostname,
    dbName: parsed.pathname,
    email: (
      environment.PLAYWRIGHT_EMAIL
      || readDotenvValue(localEnv, "PLAYWRIGHT_EMAIL")
      || LOCAL_SMOKE_EMAIL
    ).trim().toLowerCase(),
    password: environment.PLAYWRIGHT_PASSWORD
      || readDotenvValue(localEnv, "PLAYWRIGHT_PASSWORD"),
    role: (
      environment.PLAYWRIGHT_ROLE
      || readDotenvValue(localEnv, "PLAYWRIGHT_ROLE")
      || DEFAULT_ROLE
    ).trim().toUpperCase(),
    cookieName: environment.SESSION_COOKIE_NAME
      || readDotenvValue(localEnv, "SESSION_COOKIE_NAME")
      || DEFAULT_SESSION_COOKIE_NAME,
  };
}

async function loadSmokeIdentity(sql, email) {
  const rows = await sql`
    SELECT id, role, active, hidden_from_roster, force_password_change,
           split_part(email, '@', 1) AS email_local
    FROM users
    WHERE email = ${email}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function rotateLocalSmokePassword(sql, userId) {
  const password = randomBytes(24).toString("base64url");
  const passwordHash = await bcrypt.hash(password, 10);
  await sql`
    UPDATE users
    SET password_hash = ${passwordHash},
        force_password_change = false,
        hidden_from_roster = true
    WHERE id = ${userId}
  `;
  return password;
}

function persistLocalPlaywrightEnv({
  rootDir,
  email,
  password,
  role,
  baseURL,
}) {
  const filePath = join(rootDir, ".env.development.local");
  writeDotenvValue(filePath, "PLAYWRIGHT_EMAIL", email);
  writeDotenvValue(filePath, "PLAYWRIGHT_PASSWORD", password);
  writeDotenvValue(filePath, "PLAYWRIGHT_ROLE", role);
  writeDotenvValue(filePath, "PLAYWRIGHT_BASE_URL", baseURL);
  writeDotenvValue(filePath, "PLAYWRIGHT_TARGET_ISOLATED", "1");
}

export function parseSessionCookie(setCookieHeaders, cookieName, baseURL = DEFAULT_BASE_URL) {
  const match = setCookieHeaders.find((header) => header.startsWith(`${cookieName}=`));
  if (!match) return null;
  const parts = match.split(";").map((part) => part.trim());
  const value = parts[0].slice(`${cookieName}=`.length);
  const expiresPart = parts.find((part) => part.toLowerCase().startsWith("expires="));
  const expires = expiresPart ? Date.parse(expiresPart.slice("expires=".length)) : Date.now() + 12 * 60 * 60 * 1000;
  return {
    name: cookieName,
    value,
    domain: new URL(baseURL).hostname,
    path: "/",
    expires: Number.isFinite(expires) ? expires / 1000 : Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    httpOnly: true,
    secure: new URL(baseURL).protocol === "https:",
    sameSite: "Lax",
  };
}

function writeStorageState(rootDir, cookie, baseURL) {
  const authFile = join(rootDir, AUTH_FILE);
  mkdirSync(dirname(authFile), { recursive: true });
  writeFileSync(
    authFile,
    `${JSON.stringify(
      {
        cookies: [cookie],
        origins: [{ origin: new URL(baseURL).origin, localStorage: [] }],
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  return AUTH_FILE;
}

async function login(baseURL, email, password) {
  const response = await fetch(new URL("/api/auth/login", baseURL), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: new URL(baseURL).origin,
    },
    body: JSON.stringify({ email, password, rememberMe: false }),
    redirect: "manual",
  });
  const text = await response.text();
  let body = {};
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 240) };
  }
  return { response, body };
}

async function readCurrentUser(baseURL, cookieName, token) {
  const response = await fetch(new URL("/api/me", baseURL), {
    headers: {
      Cookie: `${cookieName}=${token}`,
      Accept: "application/json",
    },
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

async function main() {
  const rootDir = process.cwd();
  const target = resolveSmokeBootstrapTarget({ rootDir });
  if (!isLocalSmokeEmail(target.email)) {
    throw new Error("Local Preview session bootstrap only manages @creative.local smoke identities.");
  }
  if (isSensitiveEnvValue(target.connectionString)) {
    throw new Error("No usable isolated Preview database URL.");
  }

  const sql = neon(target.connectionString);
  const identity = await loadSmokeIdentity(sql, target.email);
  if (!identity || identity.active !== true) {
    throw new Error(
      `Hidden smoke identity ${target.email} was not found or is inactive. Seed a local database or use the existing Preview smoke admin.`,
    );
  }
  if (identity.hidden_from_roster !== true) {
    await sql`UPDATE users SET hidden_from_roster = true WHERE id = ${identity.id}`;
    identity.hidden_from_roster = true;
  }

  let password = target.password;
  let passwordSource = password ? "stored" : "missing";
  let loginResult = null;

  try {
    if (password) {
      loginResult = await login(target.baseURL, target.email, password);
    }
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(
        `Could not reach ${target.baseURL}. Start npm run dev:preview, then rerun npm run auth:local.`,
      );
    }
    throw error;
  }

  if (loginResult && loginResult.response.status === 200) {
    persistLocalPlaywrightEnv({
      rootDir,
      email: target.email,
      password,
      role: target.role || identity.role,
      baseURL: target.baseURL,
    });
  } else if (loginResult && loginResult.response.status !== 401) {
    throw new Error(`Login failed with ${loginResult.response.status}.`);
  } else {
    if (process.env.WC_PREVIEW_BRANCH) throw new Error("Managed preview login failed; rerun preview:setup to refresh credentials. Refusing a password rotation that would break another agent's handoff.");
    password = await rotateLocalSmokePassword(sql, identity.id);
    passwordSource = "rotated";
    persistLocalPlaywrightEnv({
      rootDir,
      email: target.email,
      password,
      role: target.role || identity.role,
      baseURL: target.baseURL,
    });
    try {
      loginResult = await login(target.baseURL, target.email, password);
    } catch (error) {
      if (error instanceof TypeError) {
        console.log(JSON.stringify({
          ok: false,
          reason: "server-unreachable",
          identity: {
            emailLocal: identity.email_local,
            role: identity.role,
            hidden: true,
          },
          password: "written-to-env-development-local",
          next: "Start npm run dev:preview, then rerun npm run auth:local to mint the Playwright cookie through /api/auth/login.",
        }, null, 2));
        return;
      }
      throw error;
    }
  }

  if (loginResult.response.status !== 200) {
    throw new Error(`Login failed with ${loginResult.response.status}.`);
  }

  const setCookie = typeof loginResult.response.headers.getSetCookie === "function"
    ? loginResult.response.headers.getSetCookie()
    : [loginResult.response.headers.get("set-cookie")].filter(Boolean);
  const cookie = parseSessionCookie(setCookie, target.cookieName, target.baseURL);
  if (!cookie) {
    throw new Error("Login succeeded but did not return a session cookie.");
  }

  const storageState = writeStorageState(rootDir, cookie, target.baseURL);
  const me = await readCurrentUser(target.baseURL, target.cookieName, cookie.value);
  const meUser = me.body?.user ?? me.body?.data ?? me.body;

  const summary = {
    ok: me.status === 200,
    dbHost: target.dbHost,
    dbName: target.dbName,
    cookieName: target.cookieName,
    passwordSource,
    identity: {
      emailLocal: identity.email_local,
      role: meUser?.role ?? identity.role,
      hidden: true,
    },
    apiMe: {
      status: me.status,
      name: meUser?.name ?? null,
      role: meUser?.role ?? null,
      emailLocal: typeof meUser?.email === "string" ? meUser.email.split("@")[0] : identity.email_local,
    },
    storageState,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exit(1);
}

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
