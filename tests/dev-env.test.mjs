import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";
import {
  ensureDevelopmentSessionCookieName,
  ensureDevelopmentSessionSecret,
  isValidSessionSecret,
  readDotenvValue,
} from "../scripts/ensure-dev-env.mjs";
import { assertNextBuildSafe } from "../scripts/guard-next-build.mjs";
import {
  applyLocalPlaywrightEnv,
  assertNotProductionDatabase,
  rewritePreviewDatabaseUrl,
} from "../scripts/lib/preview-dev-env.mjs";
import { resolveSmokeBootstrapTarget } from "../scripts/bootstrap-local-session.mjs";
import { buildPreviewDevEnvironment } from "../scripts/start-preview-dev.mjs";

const temporaryRoots = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function createTemporaryRoot() {
  const root = mkdtempSync(join(tmpdir(), "gear-tracker-dev-env-"));
  temporaryRoots.push(root);
  return root;
}

describe("development environment bootstrap", () => {
  it("BUG: creates a development override when the Vercel local secret is too short", () => {
    const root = createTemporaryRoot();
    writeFileSync(join(root, ".env.local"), 'SESSION_SECRET="short"\n');

    const result = ensureDevelopmentSessionSecret({
      rootDir: root,
      environment: {},
      randomSecret: () => "a".repeat(64),
    });

    expect(result.status).toBe("generated");
    expect(
      readDotenvValue(readFileSync(join(root, ".env.development.local"), "utf8"), "SESSION_SECRET"),
    ).toBe("a".repeat(64));
    expect(readFileSync(join(root, ".env.local"), "utf8")).toContain('SESSION_SECRET="short"');
  });

  it("preserves a valid local secret instead of creating an override", () => {
    const root = createTemporaryRoot();
    const secret = "b".repeat(32);
    writeFileSync(join(root, ".env.local"), `SESSION_SECRET="${secret}"\n`);

    const result = ensureDevelopmentSessionSecret({ rootDir: root, environment: {} });

    expect(result.status).toBe("local-file");
    expect(isValidSessionSecret(secret)).toBe(true);
  });

  it("fails clearly when an explicit shell secret is invalid", () => {
    expect(() =>
      ensureDevelopmentSessionSecret({
        rootDir: createTemporaryRoot(),
        environment: { SESSION_SECRET: "short" },
      }),
    ).toThrow("SESSION_SECRET must be at least 32 characters");
  });

  it("does not generate development credentials in production", () => {
    const root = createTemporaryRoot();

    const result = ensureDevelopmentSessionSecret({
      rootDir: root,
      environment: { NODE_ENV: "production" },
    });

    expect(result).toEqual({ status: "skipped", reason: "production" });
  });

  it("BUG: refuses a Next build while the dev port is active", async () => {
    await expect(
      assertNextBuildSafe({
        host: "127.0.0.1",
        port: 3000,
        isPortOpen: async () => true,
      }),
    ).rejects.toThrow("next dev and next build share .next");

    await expect(
      assertNextBuildSafe({
        host: "127.0.0.1",
        port: 3000,
        isPortOpen: async () => false,
      }),
    ).resolves.toEqual({ status: "clear", host: "127.0.0.1", port: 3000 });
  });

  it("BUG: keeps Preview storage variables while replacing a short provider session secret", () => {
    const developmentSecret = "c".repeat(32);
    const environment = buildPreviewDevEnvironment({
      baseEnvironment: {
        SESSION_SECRET: "short",
        SIGNATURE_BLOB_READ_WRITE_TOKEN: "private-preview-token",
        APP_URL: "https://wisconsincreative.com",
      },
      developmentSecret,
      rootDir: createTemporaryRoot(),
    });

    expect(environment.SESSION_SECRET).toBe(developmentSecret);
    expect(environment.SIGNATURE_BLOB_READ_WRITE_TOKEN).toBe("private-preview-token");
    expect(environment.NODE_ENV).toBe("development");
    expect(environment.SESSION_COOKIE_NAME).toBe("gear-tracker-session");
    expect(environment.BADGES_ENABLED).toBe("true");
    expect(environment.APP_URL).toBe("http://127.0.0.1:3000");
  });

  it("lets a local Preview overlay keep badges disabled and a custom app URL", () => {
    const root = createTemporaryRoot();
    writeFileSync(
      join(root, ".env.development.local"),
      'BADGES_ENABLED="false"\nAPP_URL="http://localhost:3001"\n',
    );

    const environment = buildPreviewDevEnvironment({
      baseEnvironment: {
        APP_URL: "https://wisconsincreative.com",
        BADGES_ENABLED: "false",
      },
      developmentSecret: "c".repeat(32),
      rootDir: root,
    });

    expect(environment.BADGES_ENABLED).toBe("false");
    expect(environment.APP_URL).toBe("http://localhost:3001");
  });

  it("writes a local session cookie name when one is missing", () => {
    const root = createTemporaryRoot();

    const result = ensureDevelopmentSessionCookieName({
      rootDir: root,
      environment: {},
    });

    expect(result.status).toBe("generated");
    expect(
      readDotenvValue(readFileSync(join(root, ".env.development.local"), "utf8"), "SESSION_COOKIE_NAME"),
    ).toBe("gear-tracker-session");
  });

  it("retargets Preview's empty default database and refuses production Neon", () => {
    expect(
      rewritePreviewDatabaseUrl(
        "postgresql://user:pass@ep-winter-leaf-ai0eekhl.us-east-1.aws.neon.tech/neondb?sslmode=require",
      ),
    ).toContain("/gear-tracker");

    expect(() =>
      assertNotProductionDatabase(
        "postgresql://user:pass@ep-flat-firefly-ai889avp.us-east-1.aws.neon.tech/gear-tracker?sslmode=require",
      ),
    ).toThrow("production Neon endpoint");
  });

  it("loads gitignored Playwright credentials without overriding the shell", () => {
    const root = createTemporaryRoot();
    writeFileSync(
      join(root, ".env.development.local"),
      'PLAYWRIGHT_EMAIL="admin@creative.local"\nPLAYWRIGHT_PASSWORD="stored-secret"\nPLAYWRIGHT_ROLE="ADMIN"\nPLAYWRIGHT_TARGET_ISOLATED="1"\n',
    );

    const environment = { PLAYWRIGHT_EMAIL: "already-set@example.test" };
    const result = applyLocalPlaywrightEnv({ rootDir: root, environment });

    expect(result.status).toBe("applied");
    expect(environment.PLAYWRIGHT_EMAIL).toBe("already-set@example.test");
    expect(environment.PLAYWRIGHT_PASSWORD).toBe("stored-secret");
    expect(environment.PLAYWRIGHT_ROLE).toBe("ADMIN");
  });

  it("does not load local Playwright credentials in CI", () => {
    const root = createTemporaryRoot();
    writeFileSync(join(root, ".env.development.local"), 'PLAYWRIGHT_PASSWORD="should-not-load"\n');

    const environment = { CI: "true" };
    expect(applyLocalPlaywrightEnv({ rootDir: root, environment })).toEqual({
      status: "skipped",
      reason: "ci",
    });
    expect(environment.PLAYWRIGHT_PASSWORD).toBeUndefined();
  });

  it("refuses production Vercel env and non-loopback session bootstrap targets", () => {
    expect(() =>
      resolveSmokeBootstrapTarget({
        environment: {
          VERCEL_ENV: "production",
          DATABASE_URL: "postgresql://user:pass@ep-winter-leaf-ai0eekhl.us-east-1.aws.neon.tech/gear-tracker",
        },
        rootDir: createTemporaryRoot(),
      }),
    ).toThrow("production env");

    expect(() =>
      resolveSmokeBootstrapTarget({
        environment: {
          PLAYWRIGHT_BASE_URL: "https://wisconsincreative.com",
          DATABASE_URL: "postgresql://user:pass@ep-winter-leaf-ai0eekhl.us-east-1.aws.neon.tech/gear-tracker",
        },
        rootDir: createTemporaryRoot(),
      }),
    ).toThrow("loopback hosts");
  });

  it("mints local Preview sessions through real login instead of inserting session rows", () => {
    const source = readFileSync(new URL("../scripts/bootstrap-local-session.mjs", import.meta.url), "utf8");
    expect(source).toContain("/api/auth/login");
    expect(source).toContain("/api/me");
    expect(source).not.toContain("INSERT INTO sessions");
  });
});
