import { readdirSync } from "node:fs";
import { join } from "node:path";
import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";

// ── Expected schema derived from prisma/schema.prisma ──────────────

const EXPECTED_TABLES = [
  "users",
  "sessions",
  "locations",
  "departments",
  "categories",
  "assets",
  "bookings",
  "booking_serialized_items",
  "booking_bulk_items",
  "asset_allocations",
  "bulk_skus",
  "bulk_stock_balances",
  "bulk_stock_movements",
  "scan_events",
  "scan_sessions",
  "override_events",
  "audit_logs",
  "kits",
  "kit_memberships",
  "calendar_sources",
  "calendar_events",
  "location_mappings",
  "notifications",
  "bulk_sku_units",
  "booking_bulk_unit_allocations",
  "sport_configs",
  "sport_shift_configs",
  "shift_groups",
  "shifts",
  "shift_assignments",
  "shift_trades",
  "student_sport_assignments",
  "student_area_assignments",
  "escalation_rules",
  "system_config",
  "favorite_items",
];

const EXPECTED_ENUMS = [
  "Role",
  "AssetStatus",
  "BookingKind",
  "BookingStatus",
  "AllocationKind",
  "BulkMovementKind",
  "ScanType",
  "ScanPhase",
  "ScanSessionStatus",
  "CalendarEventStatus",
  "NotificationChannel",
  "BulkUnitStatus",
  "ShiftArea",
  "ShiftWorkerType",
  "ShiftAssignmentStatus",
  "ShiftTradeStatus",
];

const EXPECTED_EXTENSIONS = ["btree_gist"];

/** Columns added by migrations 0001–0006 that are easy to miss if db push was used partially */
const KEY_COLUMNS: Record<string, string[]> = {
  assets: [
    "name",
    "uw_asset_tag",
    "consumable",
    "primary_scan_code",
    "image_url",
    "warranty_date",
    "residual_value",
    "department_id",
    "category_id",
    "available_for_reservation",
    "available_for_checkout",
    "available_for_custody",
    "link_url",
  ],
  bookings: ["source_reservation_id", "event_id", "sport_code"],
  calendar_events: ["sport_code", "is_home", "opponent"],
  bulk_skus: ["category_id", "track_by_number"],
  bulk_sku_units: ["bulk_sku_id", "unit_number", "status"],
};

/** Every migration folder the deploy ships, the same truth `db:migrate:health` compares against. */
function localMigrationNames() {
  return readdirSync(join(process.cwd(), "prisma", "migrations"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

// ── Diagnostic queries (batched into one round-trip where Neon allows) ─

async function checkMigrationTable() {
  try {
    const rows: { migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[] =
      await db.$queryRawUnsafe(
        `SELECT migration_name::text, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY migration_name`,
      );
    return {
      exists: true,
      migrations: rows.filter((r) => !r.rolled_back_at).map((r) => ({
        name: r.migration_name,
        appliedAt: r.finished_at ? new Date(String(r.finished_at)).toISOString() : null,
      })),
    };
  } catch {
    return { exists: false, migrations: [] };
  }
}

async function checkTables() {
  const rows: { tablename: string }[] = await db.$queryRawUnsafe(
    `SELECT tablename::text FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
  );
  const existing = new Set(rows.map((r) => r.tablename));
  return {
    present: EXPECTED_TABLES.filter((t) => existing.has(t)),
    missing: EXPECTED_TABLES.filter((t) => !existing.has(t)),
    extra: rows
      .map((r) => r.tablename)
      .filter(
        (t) =>
          !EXPECTED_TABLES.includes(t) &&
          t !== "_prisma_migrations" &&
          !t.startsWith("_"),
      ),
  };
}

async function checkEnums() {
  const rows: { typname: string }[] = await db.$queryRawUnsafe(
    `SELECT t.typname::text FROM pg_type t JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public' AND t.typtype = 'e' ORDER BY t.typname`,
  );
  const existing = new Set(rows.map((r) => r.typname));
  return {
    present: EXPECTED_ENUMS.filter((e) => existing.has(e)),
    missing: EXPECTED_ENUMS.filter((e) => !existing.has(e)),
  };
}

async function checkExtensions() {
  const rows: { extname: string }[] = await db.$queryRawUnsafe(
    `SELECT extname::text FROM pg_extension`,
  );
  const existing = new Set(rows.map((r) => r.extname));
  return {
    present: EXPECTED_EXTENSIONS.filter((e) => existing.has(e)),
    missing: EXPECTED_EXTENSIONS.filter((e) => !existing.has(e)),
  };
}

async function checkColumns() {
  const rows: { table_name: string; column_name: string }[] =
    await db.$queryRawUnsafe(
      `SELECT table_name::text, column_name::text FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('assets', 'bookings', 'calendar_events', 'bulk_skus', 'bulk_sku_units') ORDER BY table_name, ordinal_position`,
    );

  const byTable = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!byTable.has(r.table_name)) byTable.set(r.table_name, new Set());
    byTable.get(r.table_name)!.add(r.column_name);
  }

  const drift: { table: string; column: string; status: string }[] = [];
  for (const [table, expectedCols] of Object.entries(KEY_COLUMNS)) {
    const actual = byTable.get(table);
    if (!actual) {
      // Table itself missing — already reported by checkTables
      continue;
    }
    for (const col of expectedCols) {
      if (!actual.has(col)) {
        drift.push({ table, column: col, status: "missing" });
      }
    }
  }
  return { drift };
}

function buildRemediation(checks: {
  migrationTable: Awaited<ReturnType<typeof checkMigrationTable>>;
  tables: Awaited<ReturnType<typeof checkTables>>;
  enums: Awaited<ReturnType<typeof checkEnums>>;
  extensions: Awaited<ReturnType<typeof checkExtensions>>;
  columns: Awaited<ReturnType<typeof checkColumns>>;
}) {
  const steps: string[] = [];

  if (!checks.migrationTable.exists) {
    steps.push(
      'The _prisma_migrations table does not exist. Run "npx prisma migrate deploy" or create it manually (see docs).',
    );
  } else {
    const local = localMigrationNames();
    const localSet = new Set(local);
    const applied = new Set(
      checks.migrationTable.migrations.filter((m) => m.appliedAt).map((m) => m.name),
    );
    const pending = local.filter((m) => !applied.has(m));
    const failed = checks.migrationTable.migrations.filter((m) => !m.appliedAt && !applied.has(m.name)).map((m) => m.name);
    const dbOnly = [...applied].filter((m) => !localSet.has(m));
    if (pending.length > 0) {
      steps.push(
        `Migrations not yet applied: ${pending.join(", ")}. Run "npx prisma migrate deploy".`,
      );
    }
    if (failed.length > 0) {
      steps.push(
        `Migrations that failed partway: ${failed.join(", ")}. Resolve them with "npx prisma migrate resolve" (see the Prisma Neon runbook).`,
      );
    }
    if (dbOnly.length > 0) {
      steps.push(
        `Migrations applied to the database but missing from this deploy: ${dbOnly.join(", ")}. Deploy the branch that added them.`,
      );
    }
  }

  if (checks.tables.missing.length > 0) {
    steps.push(
      `Missing tables: ${checks.tables.missing.join(", ")}. Run "npx prisma migrate deploy" or "npx prisma db push".`,
    );
  }

  if (checks.enums.missing.length > 0) {
    steps.push(
      `Missing enums: ${checks.enums.missing.join(", ")}. Run "npx prisma migrate deploy" or "npx prisma db push".`,
    );
  }

  if (checks.extensions.missing.length > 0) {
    steps.push(
      `Missing extensions: ${checks.extensions.missing.join(", ")}. Run: CREATE EXTENSION IF NOT EXISTS btree_gist;`,
    );
  }

  if (checks.columns.drift.length > 0) {
    const grouped = new Map<string, string[]>();
    for (const d of checks.columns.drift) {
      if (!grouped.has(d.table)) grouped.set(d.table, []);
      grouped.get(d.table)!.push(d.column);
    }
    for (const [table, cols] of grouped) {
      steps.push(
        `Table "${table}" is missing columns: ${cols.join(", ")}. Schema drift detected — run "npx prisma migrate deploy".`,
      );
    }
  }

  return steps;
}

// ── Route handler ──────────────────────────────────────────────────

/**
 * GET /api/db-diagnostics
 * Returns a comprehensive schema health report. Admin only.
 */
export const GET = withAuth(async (_req, { user }) => {
  if (user.role !== "ADMIN") {
    throw new HttpError(403, "Only admins can view diagnostics");
  }

  try {
    const [migrationTable, tables, enums, extensions, columns] =
      await Promise.all([
        checkMigrationTable(),
        checkTables(),
        checkEnums(),
        checkExtensions(),
        checkColumns(),
      ]);

    const checks = { migrationTable, tables, enums, extensions, columns };
    const remediation = buildRemediation(checks);

    const healthy =
      migrationTable.exists &&
      tables.missing.length === 0 &&
      enums.missing.length === 0 &&
      extensions.missing.length === 0 &&
      columns.drift.length === 0 &&
      remediation.length === 0;

    return ok({ ok: healthy, checks, remediation });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return ok({
      ok: false,
      checks: {
        migrationTable: { exists: false, migrations: [] },
        tables: { present: [], missing: [], extra: [] },
        enums: { present: [], missing: [] },
        extensions: { present: [], missing: [] },
        columns: { drift: [] },
      },
      remediation: [`Database query failed: ${message}. Ensure the database is accessible and migrations are applied.`],
    });
  }
});
