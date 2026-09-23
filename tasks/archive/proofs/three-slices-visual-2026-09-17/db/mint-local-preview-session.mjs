/**
 * Mint a local Preview session for the existing hidden smoke admin.
 * Uses SESSION_SECRET from .env.development.local (the same override the
 * Preview dev server applies) and writes gitignored Playwright storage state.
 * Never prints the session token or secret.
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { neon } from "@neondatabase/serverless";
import { readDotenvValue } from "../../../../../scripts/ensure-dev-env.mjs";

function rewriteGearTracker(url) {
  if (!url || url.trim() === "[SENSITIVE]") return url;
  const parsed = new URL(url);
  parsed.pathname = "/gear-tracker";
  return parsed.toString();
}

function randomHex(bytes) {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function tokenHash(secret, token) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(token));
  return Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, "0")).join("");
}

const root = "/Users/role/Code/wisconsin-creative";
const developmentEnv = readFileSync(join(root, ".env.development.local"), "utf8");
const secret = readDotenvValue(developmentEnv, "SESSION_SECRET");
const cookieName = readDotenvValue(developmentEnv, "SESSION_COOKIE_NAME") || "gear-tracker-session";
if (!secret || secret.length < 32) {
  throw new Error("Local development SESSION_SECRET is missing or too short.");
}

const rawDb =
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.DIRECT_URL ||
  process.env.DATABASE_URL ||
  "";
const connectionString = rewriteGearTracker(rawDb);
if (!connectionString || connectionString.trim() === "[SENSITIVE]") {
  throw new Error("No usable Preview database URL.");
}

const sql = neon(connectionString);
const users = await sql`
  SELECT id, role, active, hidden_from_roster, force_password_change,
         split_part(email, '@', 1) AS email_local
  FROM users
  WHERE email = 'admin@creative.local'
  LIMIT 1
`;
const user = users[0];
if (!user || user.active !== true || user.hidden_from_roster !== true) {
  throw new Error("Expected hidden active smoke admin was not found.");
}

const rawToken = randomHex(32);
const hashed = await tokenHash(secret, rawToken);
const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);
const sessionId = `sms_${randomHex(12)}`;

await sql`
  INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
  VALUES (${sessionId}, ${user.id}, ${hashed}, ${expiresAt.toISOString()}, NOW())
`;

const authFile = join(root, "test-results/playwright/auth/user.json");
mkdirSync(dirname(authFile), { recursive: true });
writeFileSync(
  authFile,
  JSON.stringify(
    {
      cookies: [
        {
          name: cookieName,
          value: rawToken,
          domain: "127.0.0.1",
          path: "/",
          expires: expiresAt.getTime() / 1000,
          httpOnly: true,
          secure: false,
          sameSite: "Lax",
        },
      ],
      origins: [{ origin: "http://127.0.0.1:3000", localStorage: [] }],
    },
    null,
    2,
  ),
  { encoding: "utf8", mode: 0o600 },
);

const me = await fetch("http://127.0.0.1:3000/api/me", {
  headers: {
    Cookie: `${cookieName}=${rawToken}`,
    Accept: "application/json",
  },
});
const meBody = await me.json().catch(() => ({}));
const meUser = meBody?.user ?? meBody;

console.log(
  JSON.stringify(
    {
      dbHost: new URL(connectionString).hostname,
      dbName: new URL(connectionString).pathname,
      cookieName,
      sessionIdPrefix: sessionId.slice(0, 8),
      expiresAt: expiresAt.toISOString(),
      identity: {
        emailLocal: user.email_local,
        role: user.role,
        hidden: user.hidden_from_roster,
        forcePasswordChange: user.force_password_change,
      },
      apiMe: {
        status: me.status,
        idSuffix: typeof meUser?.id === "string" ? meUser.id.slice(-6) : null,
        name: meUser?.name ?? null,
        role: meUser?.role ?? null,
        emailLocal:
          typeof meUser?.email === "string" ? meUser.email.split("@")[0] : null,
      },
      storageState: "test-results/playwright/auth/user.json",
    },
    null,
    2,
  ),
);

if (me.status !== 200 || meUser?.role !== "ADMIN") {
  process.exit(1);
}
