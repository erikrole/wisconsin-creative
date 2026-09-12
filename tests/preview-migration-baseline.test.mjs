import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  readApprovedBaseline, validateBaseline, loadMigrationBaseline, digest,
  previewTarget, buildBaselineInstall,
} from "../scripts/lib/migration-baseline.mjs";
import { evaluateMigrationHealth } from "../scripts/prisma-migrate-health.mjs";
import { assertFallbackHistory, buildFallbackTransaction } from "../scripts/prisma-migrate-deploy.mjs";

const baseline = readApprovedBaseline();
const record = { manifest_hash: digest(baseline), manifest: baseline };
const validate = (overrides = {}) => validateBaseline(baseline, overrides.target ?? previewTarget,
  overrides.record ?? record, overrides.checksums ?? baseline.checksums, overrides.rows ?? baseline.receipts);

describe("explicit Preview checkpoint", () => {
  it("retains 43 unknown histories, one historical version and all 153 receipts", () => {
    expect(validate()).toEqual(baseline);
    expect(baseline.receipts).toHaveLength(153);
    const health = evaluateMigrationHealth(Object.keys(baseline.checksums).sort(), baseline.receipts, baseline.checksums, baseline);
    expect(health.baselinedUnknown).toHaveLength(43);
    expect(health.baselinedHistorical).toEqual(["0071_add_event_subtitle"]);
    expect(health.pending).toEqual(baseline.reviewedPending);
    expect(health.ok).toBe(false); // pending SQL is not an applied baseline
    expect(assertFallbackHistory(baseline.checksums, baseline.receipts, baseline)).toEqual(baseline.reviewedPending);
  });

  it("does not waive legacy checks without the exact baseline", () => {
    expect(() => assertFallbackHistory(baseline.checksums, baseline.receipts)).toThrow("Refusing");
    expect(() => validate({ record: {} })).toThrow("record is missing or changed");
    expect(() => validate({ record: { ...record, manifest: { ...baseline, id: "replacement" } } })).toThrow("record is missing or changed");
  });

  it.each(["branch", "endpoint", "database"])("refuses another %s including a copied checkpoint", (field) => {
    expect(() => validate({ target: { ...previewTarget, [field]: "production-or-another-target" } })).toThrow("cannot authorize");
  });

  it("never loads Preview exceptions on Production or a new database", async () => {
    const sql = { query: vi.fn().mockResolvedValue([{ ...previewTarget, branch: "br-gentle-sky-aisuwcsf" }]) };
    expect(await loadMigrationBaseline(sql, baseline.checksums)).toBeNull();
    expect(sql.query).toHaveBeenCalledOnce(); // no migration table needed here
  });

  it("requires the persisted checkpoint on Preview", async () => {
    const sql = { query: vi.fn().mockResolvedValueOnce([previewTarget]).mockResolvedValueOnce([{ name: null }]) };
    expect(await loadMigrationBaseline(sql, baseline.checksums)).toBeNull();
  });

  it.each(["checksum", "logs", "started_at", "finished_at", "rolled_back_at", "applied_steps_count"])("detects a changed historical %s", (field) => {
    const rows = structuredClone(baseline.receipts);
    rows[0][field] = "changed";
    expect(() => validate({ rows })).toThrow("receipt changed or missing");
  });

  it("detects removed receipts and changes to rolled-back attempts", () => {
    expect(() => validate({ rows: baseline.receipts.slice(1) })).toThrow("receipt changed or missing");
    const rows = structuredClone(baseline.receipts);
    rows.find((row) => row.rolled_back_at).logs = "rewritten";
    expect(() => validate({ rows })).toThrow("receipt changed or missing");
  });

  it("pins legacy AND reviewed forward SQL", () => {
    for (const name of [baseline.receipts[0].migration_name, ...baseline.reviewedPending]) {
      expect(() => validate({ checksums: { ...baseline.checksums, [name]: "a".repeat(64) } })).toThrow("Baseline SQL changed");
    }
  });

  it("does not let the baseline excuse new bad, failed, or duplicate receipts", () => {
    for (const row of [
      { ...baseline.receipts[0], id: "new" },
      { id: "new", migration_name: baseline.reviewedPending[0], checksum: "manual", finished_at: "now" },
      { id: "new", migration_name: "unknown", checksum: "a".repeat(64), finished_at: "now" },
      { id: "new", migration_name: baseline.reviewedPending[0], checksum: baseline.checksums[baseline.reviewedPending[0]], finished_at: null },
    ]) expect(() => assertFallbackHistory(baseline.checksums, [...baseline.receipts, row], baseline)).toThrow("Refusing");
  });

  it("installs only metadata, never rewrites Prisma receipts or application data", () => {
    const sql = buildBaselineInstall(baseline, baseline.checksums).join(";\n");
    expect(sql).toContain("Schema changed since baseline review");
    expect(sql).toContain("History changed since baseline review");
    expect(sql).toContain("INSERT INTO wc_migration_meta.baselines");
    expect(sql).not.toMatch(/(?:UPDATE|DELETE FROM|INSERT INTO) (?:public\.)?_prisma_migrations/);
    expect(sql).not.toContain("ON CONFLICT");
  });

  it("checks branch, checkpoint and full receipt snapshot inside every forward transaction", () => {
    for (const name of baseline.reviewedPending) {
      const source = readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8");
      const plan = buildFallbackTransaction(name, source, baseline.checksums, baseline);
      const guard = plan.queries[1].text;
      expect(guard).toContain("pg_try_advisory_xact_lock");
      expect(guard).toContain("Preview baseline target mismatch");
      expect(guard).toContain("LOCK TABLE public._prisma_migrations");
      expect(guard).toContain("to_jsonb(m) IS DISTINCT FROM b");
      expect(guard).toContain("Preview baseline record missing or changed");
      expect(guard).toContain("Migration history changed");
    }
  });
});
