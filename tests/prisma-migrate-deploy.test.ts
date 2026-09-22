import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

// The deploy wrapper is a plain ESM Node script, but the splitter is exported for regression coverage.
// @ts-expect-error no declaration file for local .mjs script modules
import { splitSqlStatements, assertFallbackHistory, buildFallbackTransaction, applyFallbackMigration } from "../scripts/prisma-migrate-deploy.mjs";

describe("splitSqlStatements", () => {
  it("keeps semicolons inside strings and comments", () => {
    expect(
      splitSqlStatements(`
        -- comment with ; inside
        INSERT INTO "system_config" ("key", "value")
        VALUES ('copy;inside', '{"x":"a;b"}'::jsonb);
        /* block ; comment */
        CREATE INDEX IF NOT EXISTS "idx_demo" ON "demo"("value");
      `),
    ).toEqual([
      `-- comment with ; inside
        INSERT INTO "system_config" ("key", "value")
        VALUES ('copy;inside', '{"x":"a;b"}'::jsonb)`,
      `/* block ; comment */
        CREATE INDEX IF NOT EXISTS "idx_demo" ON "demo"("value")`,
    ]);
  });

  it("keeps dollar-quoted blocks together", () => {
    expect(
      splitSqlStatements(`
        DO $$
        BEGIN
          RAISE NOTICE 'hello; still inside';
        END $$;
        ALTER TABLE "bookings" ADD COLUMN "completed_at" TIMESTAMP(3);
      `),
    ).toEqual([
      `DO $$
        BEGIN
          RAISE NOTICE 'hello; still inside';
        END $$`,
      `ALTER TABLE "bookings" ADD COLUMN "completed_at" TIMESTAMP(3)`,
    ]);
  });

  it("keeps nested comments and doubled identifier quotes together", () => {
    expect(splitSqlStatements('/* outer /* inner */ ; still outer */ SELECT "a"";b"; SELECT 2;'))
      .toEqual(['/* outer /* inner */ ; still outer */ SELECT "a"";b"', 'SELECT 2']);
  });
});

const checksum = (sql: string) => createHash("sha256").update(sql).digest("hex");
const source = 'CREATE TABLE migration_fixture (id integer); INSERT INTO migration_fixture VALUES (1);';
const name = "0144_fixture";
const manifest = { [name]: checksum(source) };

describe("fallback history preflight", () => {
  it("allows pending SQL, not failed, missing-local or unverifiable history", () => {
    expect(assertFallbackHistory(manifest, [])).toEqual([name]);
    for (const row of [
      { migration_name: name, checksum: manifest[name], finished_at: null },
      { migration_name: "missing", checksum: manifest[name], finished_at: "now" },
      { migration_name: name, checksum: "manual", finished_at: "now" },
      { migration_name: name, checksum: "b".repeat(64), finished_at: "now" },
    ]) {
      expect(() => assertFallbackHistory(manifest, [row])).toThrow("Refusing migration deploy");
    }
  });

  it("skips verified applied SQL and preserves rolled-back attempts", () => {
    expect(assertFallbackHistory(manifest, [
      { migration_name: name, checksum: "old", rolled_back_at: "now" },
      { migration_name: name, checksum: manifest[name], finished_at: "now" },
    ])).toEqual([]);
  });
});

describe("atomic fallback plan", () => {
  it.each([
    "COMMIT;", "-- leading\nBEGIN;", "/* outer /* nested */ comment */ END;",
    "ROLLBACK;", "START TRANSACTION;", "PREPARE TRANSACTION 'x';",
    "CREATE INDEX CONCURRENTLY demo ON example(id);", "VACUUM example;",
  ])("refuses SQL that cannot stay atomic: %s", (sql) => {
    expect(() => buildFallbackTransaction(name, sql, { [name]: checksum(sql) }))
      .toThrow("Refusing non-transactional SQL");
  });

  it("keeps PL/pgSQL BEGIN/END inside the driver's transaction", () => {
    const sql = "DO $$ BEGIN RAISE NOTICE 'test'; END $$;";
    expect(() => buildFallbackTransaction(name, sql, { [name]: checksum(sql) })).not.toThrow();
  });

  it("rejects changed SQL after manifest capture", () => {
    expect(() => buildFallbackTransaction(name, source + "SELECT 1;", manifest)).toThrow("checksum changed");
  });

  it("uses one transaction for the guard, migration and completion receipt", async () => {
    const plan = buildFallbackTransaction(name, source, manifest);
    const query = vi.fn((text: string, values: unknown[]) => ({ text, values }));
    const transaction = vi.fn().mockResolvedValue([]);
    await applyFallbackMigration({ query, transaction }, plan);
    expect(transaction).toHaveBeenCalledOnce();
    expect(transaction).toHaveBeenCalledWith(plan.queries, { isolationLevel: "ReadCommitted" });
    expect(plan.queries[1].text).toContain("pg_try_advisory_xact_lock(72707369)");
    expect(plan.queries[1].text).toContain("Migration history changed");
    expect(plan.queries.at(-1).text).toContain("finished_at = clock_timestamp()");
  });

  it("reconciles a lost response only from this exact committed attempt", async () => {
    const plan = buildFallbackTransaction(name, source, manifest);
    const query = vi.fn((text: string, values: unknown[]) => text.startsWith("SELECT checksum")
      ? Promise.resolve([{ checksum: plan.checksum, finished_at: "now", rolled_back_at: null }])
      : { text, values });
    const transaction = vi.fn().mockRejectedValue(new Error("lost HTTP response"));
    await expect(applyFallbackMigration({ query, transaction }, plan)).resolves.toBeUndefined();
    expect(transaction).toHaveBeenCalledOnce();
    expect(query).toHaveBeenLastCalledWith(expect.stringContaining("WHERE id = $1"), [plan.id]);
  });

  it.each([{ rows: [] }, { rows: [{ checksum: "wrong", finished_at: "now" }] }])("does not replay an unconfirmed attempt", async ({ rows }) => {
    const plan = buildFallbackTransaction(name, source, manifest);
    const query = vi.fn((text: string, values: unknown[]) => text.startsWith("SELECT checksum")
      ? Promise.resolve(rows) : { text, values });
    const transaction = vi.fn().mockRejectedValue(new Error("failure"));
    await expect(applyFallbackMigration({ query, transaction }, plan)).rejects.toThrow("no automatic retry");
    expect(transaction).toHaveBeenCalledOnce();
  });

  it("reports an unknown outcome when the reconciliation read also fails", async () => {
    const plan = buildFallbackTransaction(name, source, manifest);
    const query = vi.fn((text: string, values: unknown[]) => text.startsWith("SELECT checksum")
      ? Promise.reject(new Error("read failed")) : { text, values });
    const transaction = vi.fn().mockRejectedValue(new Error("lost response"));
    await expect(applyFallbackMigration({ query, transaction }, plan)).rejects.toThrow("outcome is unverified");
    expect(transaction).toHaveBeenCalledOnce();
  });
});
