import { describe, expect, it } from "vitest";

// The health checker is a plain ESM Node script, but the comparison logic is exported for tests.
// @ts-expect-error no declaration file for local .mjs script modules
import { evaluateMigrationHealth, evaluateAllocationProtection } from "../scripts/prisma-migrate-health.mjs";

const localMigrations = [
  "0063_allow_manual_calendar_events_source_null",
  "0064_add_kiosk_session_expiry",
  "0065_add_booking_completed_at",
] as const;

describe("evaluateMigrationHealth", () => {
  it("passes when every local migration is applied in Neon", () => {
    const health = check([
      applied("0063_allow_manual_calendar_events_source_null"),
      applied("0064_add_kiosk_session_expiry"),
      applied("0065_add_booking_completed_at"),
    ]);

    expect(health.ok).toBe(true);
    expect(health.pending).toEqual([]);
    expect(health.unresolvedFailed).toEqual([]);
    expect(health.appliedDbOnly).toEqual([]);
    expect(health.newestLocalApplied).toBe(true);
  });

  it("fails when a local migration is pending", () => {
    const health = check([
      applied("0063_allow_manual_calendar_events_source_null"),
      applied("0064_add_kiosk_session_expiry"),
    ]);

    expect(health.ok).toBe(false);
    expect(health.pending).toEqual(["0065_add_booking_completed_at"]);
    expect(health.newestLocalApplied).toBe(false);
  });

  it("fails when Neon has an unresolved failed migration row", () => {
    const health = check([
      applied("0063_allow_manual_calendar_events_source_null"),
      failed("0064_add_kiosk_session_expiry"),
      applied("0065_add_booking_completed_at"),
    ]);

    expect(health.ok).toBe(false);
    expect(health.pending).toEqual(["0064_add_kiosk_session_expiry"]);
    expect(health.unresolvedFailed).toEqual(["0064_add_kiosk_session_expiry"]);
  });

  it("fails when Neon has an applied migration missing from the repo", () => {
    const health = check([
      applied("0063_allow_manual_calendar_events_source_null"),
      applied("0064_add_kiosk_session_expiry"),
      applied("0065_add_booking_completed_at"),
      applied("0066_missing_locally"),
    ]);

    expect(health.ok).toBe(false);
    expect(health.appliedDbOnly).toEqual(["0066_missing_locally"]);
  });

  it("ignores rolled-back rows as applied migration history", () => {
    const health = check([
      applied("0063_allow_manual_calendar_events_source_null"),
      rolledBack("0064_add_kiosk_session_expiry"),
      applied("0065_add_booking_completed_at"),
    ]);

    expect(health.ok).toBe(false);
    expect(health.pending).toEqual(["0064_add_kiosk_session_expiry"]);
    expect(health.rolledBack).toEqual(["0064_add_kiosk_session_expiry"]);
  });
});

function applied(migrationName: string) {
  return {
    migration_name: migrationName,
    finished_at: new Date("2026-05-12T12:00:00.000Z"),
    rolled_back_at: null,
    applied_steps_count: 1,
    checksum: "a".repeat(64),
  };
}

function failed(migrationName: string) {
  return {
    migration_name: migrationName,
    finished_at: null,
    rolled_back_at: null,
    applied_steps_count: 0,
  };
}

function rolledBack(migrationName: string) {
  return {
    migration_name: migrationName,
    finished_at: null,
    rolled_back_at: new Date("2026-05-12T12:00:00.000Z"),
    applied_steps_count: 0,
  };
}

function check(rows: { migration_name: string; finished_at: Date | null; rolled_back_at: Date | null; checksum?: string; applied_steps_count: number }[]) {
  return evaluateMigrationHealth(localMigrations, rows, Object.fromEntries(
    localMigrations.map((name) => [name, "a".repeat(64)]),
  ));
}

describe("applied migration SQL evidence", () => {
  const rows = () => localMigrations.map(applied);

  it("fails when applied SQL differs despite matching names", () => {
    const history = rows();
    history[0]!.checksum = "b".repeat(64);
    const health = check(history);
    expect(health.ok).toBe(false);
    expect(health.pending).toEqual([]);
    expect(health.checksumMismatches).toEqual([localMigrations[0]]);
  });

  it.each(["", "not-a-hash"])("reports unavailable checksum evidence: %s", (checksum) => {
    const history = rows();
    history[0]!.checksum = checksum;
    const health = check(history);
    expect(health.ok).toBe(false);
    expect(health.unverifiedChecksums).toEqual([localMigrations[0]]);
  });

  it("does not silently verify history without local SQL hashes", () => {
    const health = evaluateMigrationHealth(localMigrations, rows());
    expect(health.ok).toBe(false);
    expect(health.unverifiedChecksums).toEqual(localMigrations);
  });

  it("ignores a rolled-back checksum mismatch when the successful retry matches", () => {
    const health = check([
      ...rows(),
      { ...applied(localMigrations[0]), checksum: "b".repeat(64),
        rolled_back_at: new Date("2026-05-12T13:00:00.000Z") },
    ]);
    expect(health.ok).toBe(true);
    expect(health.checksumMismatches).toEqual([]);
  });

  it("does not let a matching duplicate receipt hide a different applied checksum", () => {
    const health = check([...rows(), { ...applied(localMigrations[0]), checksum: "b".repeat(64) }]);
    expect(health.ok).toBe(false);
    expect(health.checksumMismatches).toEqual([localMigrations[0]]);
  });
});

describe("live allocation protection", () => {
  const definition = "EXCLUDE USING gist (asset_id WITH =, tsrange(starts_at, ends_at, '[)'::text) WITH &&) WHERE ((active = true))";

  it("accepts the validated half-open active-window guard", () => {
    expect(evaluateAllocationProtection([{ definition, valid: true }])).toEqual([]);
  });

  it("rejects missing, invalid, or incorrectly scoped constraints", () => {
    for (const rows of [[], [{ definition, valid: false }], [{ definition: "UNIQUE (asset_id)", valid: true }]]) {
      expect(evaluateAllocationProtection(rows)).toHaveLength(1);
    }
  });
});
