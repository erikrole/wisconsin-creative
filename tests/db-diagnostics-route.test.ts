import { readdirSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";
import { authUser, routeCtx } from "./_helpers/route-request";

const mocks = vi.hoisted(() => ({ requireAuth: vi.fn(), queryRawUnsafe: vi.fn() }));

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth, requireKiosk: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $queryRawUnsafe: mocks.queryRawUnsafe } }));

import { GET } from "@/app/api/db-diagnostics/route";

const local = readdirSync("prisma/migrations", { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
const applied = (name: string) => ({ migration_name: name, finished_at: new Date("2026-10-01T12:00:00Z"), rolled_back_at: null });
const tables = ["users", "sessions", "locations", "departments", "categories", "assets", "bookings", "booking_serialized_items", "booking_bulk_items", "asset_allocations", "bulk_skus", "bulk_stock_balances", "bulk_stock_movements", "scan_events", "scan_sessions", "override_events", "audit_logs", "kits", "kit_memberships", "calendar_sources", "calendar_events", "location_mappings", "notifications", "bulk_sku_units", "booking_bulk_unit_allocations", "sport_configs", "sport_shift_configs", "shift_groups", "shifts", "shift_assignments", "shift_trades", "student_sport_assignments", "student_area_assignments", "escalation_rules", "system_config", "favorite_items"];
const enums = ["Role", "AssetStatus", "BookingKind", "BookingStatus", "AllocationKind", "BulkMovementKind", "ScanType", "ScanPhase", "ScanSessionStatus", "CalendarEventStatus", "NotificationChannel", "BulkUnitStatus", "ShiftArea", "ShiftWorkerType", "ShiftAssignmentStatus", "ShiftTradeStatus"];
const columns = {
  assets: ["name", "uw_asset_tag", "consumable", "primary_scan_code", "image_url", "warranty_date", "residual_value", "department_id", "category_id", "available_for_reservation", "available_for_checkout", "available_for_custody", "link_url"],
  bookings: ["source_reservation_id", "event_id", "sport_code"],
  calendar_events: ["sport_code", "is_home", "opponent"],
  bulk_skus: ["category_id", "track_by_number"],
  bulk_sku_units: ["bulk_sku_id", "unit_number", "status"],
};

function database(migrations: object[] | Error) {
  mocks.queryRawUnsafe.mockImplementation(async (sql: string) => {
    if (sql.includes("_prisma_migrations")) {
      if (migrations instanceof Error) throw migrations;
      return migrations;
    }
    if (sql.includes("pg_tables")) return [...tables, "badges"].map((tablename) => ({ tablename }));
    if (sql.includes("typtype")) return enums.map((typname) => ({ typname }));
    if (sql.includes("pg_extension")) return [{ extname: "btree_gist" }];
    return Object.entries(columns).flatMap(([table_name, cols]) => cols.map((column_name) => ({ table_name, column_name })));
  });
}

const diagnose = async () => (await (await GET(new Request("https://app.example.com/api/db-diagnostics"), routeCtx({}))).json());

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue(authUser(Role.ADMIN));
});

describe("/api/db-diagnostics", () => {
  it("is admin only", async () => {
    mocks.requireAuth.mockResolvedValue(authUser(Role.STAFF));
    expect((await GET(new Request("https://app.example.com/api/db-diagnostics"), routeCtx({}))).status).toBe(403);
  });

  it("is healthy when every shipped migration is applied, and extra tables are only listed", async () => {
    database(local.map(applied));

    const body = await diagnose();

    expect(body).toMatchObject({ ok: true, remediation: [] });
    expect(body.checks.tables.extra).toEqual(["badges"]);
  });

  it("compares against the shipped migration folders, not a fixed list", async () => {
    const newest = local.at(-1)!;
    database([
      ...local.filter((name) => name !== newest).map(applied),
      { migration_name: "9999_from_another_branch", finished_at: new Date(), rolled_back_at: null },
      { migration_name: "0500_half_done", finished_at: null, rolled_back_at: null },
      { migration_name: "0501_undone", finished_at: null, rolled_back_at: new Date() },
    ]);

    const body = await diagnose();

    expect(body.ok).toBe(false);
    expect(body.remediation).toEqual([
      `Migrations not yet applied: ${newest}. Run "npx prisma migrate deploy".`,
      expect.stringContaining("failed partway: 0500_half_done."),
      expect.stringContaining("missing from this deploy: 9999_from_another_branch."),
    ]);
    expect(body.checks.migrationTable.migrations.map((m: { name: string }) => m.name)).not.toContain("0501_undone");
  });

  it("does not count a failed attempt that a later run finished", async () => {
    database([{ migration_name: local[0], finished_at: null, rolled_back_at: null }, ...local.map(applied)]);

    expect(await diagnose()).toMatchObject({ ok: true, remediation: [] });
  });

  it("reports a missing migration table and a failed connection", async () => {
    database(new Error("relation does not exist"));
    const body = await diagnose();
    expect(body.ok).toBe(false);
    expect(body.remediation[0]).toContain("_prisma_migrations table does not exist");

    mocks.queryRawUnsafe.mockRejectedValue(new Error("connection refused"));
    expect((await diagnose()).remediation).toEqual([expect.stringContaining("Database query failed: connection refused.")]);
  });
});
