/**
 * Read-only Preview smoke-identity inventory. Prints role/active/hidden flags
 * and email local-part only. Never prints secrets, hashes, or passwords.
 */
import { neon } from "@neondatabase/serverless";

function rewriteGearTracker(url) {
  if (!url || url.trim() === "[SENSITIVE]") return url;
  const parsed = new URL(url);
  parsed.pathname = "/gear-tracker";
  return parsed.toString();
}

const raw =
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.DIRECT_URL ||
  process.env.DATABASE_URL ||
  "";
const connectionString = rewriteGearTracker(raw);
if (!connectionString || connectionString.trim() === "[SENSITIVE]") {
  console.error("NO_USABLE_CONNECTION");
  process.exit(2);
}

const parsed = new URL(connectionString);
console.log(
  JSON.stringify(
    {
      host: parsed.hostname,
      db: parsed.pathname,
      cookieNamePresent: Boolean(process.env.SESSION_COOKIE_NAME),
      cookieName: process.env.SESSION_COOKIE_NAME || null,
      sessionSecretLength: (process.env.SESSION_SECRET || "").length,
    },
    null,
    2,
  ),
);

const sql = neon(connectionString);
const users = await sql`
  SELECT
    id,
    split_part(email, '@', 1) AS email_local,
    split_part(email, '@', 2) AS email_domain,
    role,
    active,
    hidden_from_roster,
    force_password_change,
    (password_hash IS NOT NULL AND length(password_hash) > 0) AS has_password,
    last_active_at
  FROM users
  WHERE hidden_from_roster = true
     OR email ILIKE '%smoke%'
     OR email ILIKE '%playwright%'
     OR email ILIKE '%+test%'
  ORDER BY hidden_from_roster DESC, role, email
  LIMIT 40
`;

const sessions = await sql`
  SELECT COUNT(*)::int AS live_sessions
  FROM sessions
  WHERE expires_at > NOW()
`;

console.log(JSON.stringify({ liveSessions: sessions[0]?.live_sessions ?? null, users }, null, 2));
