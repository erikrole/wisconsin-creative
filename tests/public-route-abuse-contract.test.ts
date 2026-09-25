import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const PUBLIC_HANDLER_ROUTES = [
  "src/app/api/auth/forgot-password/route.ts",
  "src/app/api/auth/login/route.ts",
  "src/app/api/auth/register/route.ts",
  "src/app/api/auth/reset-password/route.ts",
  "src/app/api/kiosk/activate/route.ts",
  "src/app/api/seed/route.ts",
  "src/app/api/shifts/ics/[token]/route.ts",
] as const;

const SEED_ROUTE = "src/app/api/seed/route.ts";
const ROUTE_CONTROLS: Record<(typeof PUBLIC_HANDLER_ROUTES)[number], RegExp[]> = {
  "src/app/api/auth/forgot-password/route.ts": [
    /\bcheckRateLimit\s*\(\s*`forgot:\$\{ip\}`/,
    /\bgetClientIp\s*\(/,
    /If that email exists, we sent a reset link/,
    /\bif\s*\(\s*!env\.resendApiKey\s*\)/,
    /\bcreateSystemAuditEntry\s*\(/,
  ],
  "src/app/api/auth/login/route.ts": [
    /\bcheckRateLimit\s*\(\s*`login:ip:\$\{ip\}`/,
    /\bcheckRateLimit\s*\(\s*`login:email:\$\{email\}`/,
    /\bgetClientIp\s*\(/,
    /Invalid credentials/,
    /\bcreateSession\s*\(/,
    /\bcreateAuditEntry\s*\(/,
  ],
  "src/app/api/auth/register/route.ts": [
    /\bcheckRateLimit\s*\(\s*`register:\$\{ip\}`/,
    /\bgetClientIp\s*\(/,
    /\bdb\.allowedEmail\.findUnique\s*\(/,
    /\bclaimedAt\b/,
    /\bPrisma\.PrismaClientKnownRequestError\b/,
    /\bcreateAuditEntry\s*\(/,
  ],
  "src/app/api/auth/reset-password/route.ts": [
    /\bcheckRateLimit\s*\(\s*`reset:\$\{ip\}`/,
    /\bgetClientIp\s*\(/,
    /\btokenHash\s*\(\s*body\.token\s*\)/,
    /\bpasswordResetToken\.deleteMany\s*\(/,
    /\bsession\.deleteMany\s*\(/,
    /Prisma\.TransactionIsolationLevel\.Serializable/,
    /\bcreateAuditEntryTx\s*\(/,
  ],
  "src/app/api/kiosk/activate/route.ts": [
    /\benforceRateLimit\s*\(\s*`kiosk:activate:\$\{ip\}`/,
    /\benforceRateLimit\s*\(\s*`kiosk:activate:code:\$\{hashedCode\}`/,
    /\bgetClientIp\s*\(/,
    /\btokenHash\s*\(\s*code\s*\)/,
    /\bactivationCodeExpiresAt\b/,
    /\bkioskDevice\.updateMany\s*\(/,
    /\bcreateSystemAuditEntry\s*\(/,
  ],
  "src/app/api/seed/route.ts": [
    /process\.env\.SEED_ENDPOINT_ENABLED\s*===\s*"true"/,
    /\bassertSeedEnabled\s*\(/,
    /\bthrow\s+new\s+HttpError\s*\(\s*404\s*,\s*"Not found"\s*\)/,
    /\bwithAuth\s*\(/,
    /user\.role\s*!==\s*"ADMIN"/,
    /SEED_ADMIN_PASSWORD/,
    /\.\.\.\(isProduction/,
  ],
  "src/app/api/shifts/ics/[token]/route.ts": [
    /\bTOKEN_RE\.test\s*\(\s*token\s*\)/,
    /\bcheckRateLimit\s*\(\s*`shifts:ics:ip:\$\{ip\}`/,
    /\bcheckRateLimit\s*\(\s*`shifts:ics:token:\$\{tokenKey\}`/,
    /\bgetClientIp\s*\(/,
    /\bwhere:\s*\{\s*icsToken:\s*\{\s*in:\s*icsTokenLookupValues\(token\)\s*\},\s*active:\s*true\s*\}/,
    /Cache-Control/,
    /no-cache, no-store/,
  ],
};

function sourceFor(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

describe("public API route abuse-control contract", () => {
  it("keeps every unauthenticated API route on an explicit control ledger", () => {
    expect(Object.keys(ROUTE_CONTROLS).sort()).toEqual([...PUBLIC_HANDLER_ROUTES].sort());
  });

  it("keeps unauthenticated public routes rate-limited by client IP", () => {
    const missingRateLimits = PUBLIC_HANDLER_ROUTES.filter((route) => route !== SEED_ROUTE)
      .filter((route) => {
        const source = sourceFor(route);
        return !/\b(?:checkRateLimit|enforceRateLimit)\s*\(/.test(source) || !/\bgetClientIp\s*\(/.test(source);
      });

    expect(missingRateLimits).toEqual([]);
  });

  it("pins each public route to its route-specific abuse controls", () => {
    const missingControls = PUBLIC_HANDLER_ROUTES.flatMap((route) => {
      const source = sourceFor(route);
      return ROUTE_CONTROLS[route]
        .filter((pattern) => !pattern.test(source))
        .map((pattern) => `${route}:missing ${pattern}`);
    });

    expect(missingControls).toEqual([]);
  });

  it("keeps the seed endpoint disabled unless explicitly enabled", () => {
    const source = sourceFor(SEED_ROUTE);

    expect(source).toContain('process.env.SEED_ENDPOINT_ENABLED === "true"');
    expect(source).toMatch(/\bassertSeedEnabled\s*\(/);
    expect(source).toMatch(/\bthrow\s+new\s+HttpError\s*\(\s*404\s*,\s*"Not found"\s*\)/);
    expect(source).toMatch(/\bwithAuth\s*\(/);
  });
});
