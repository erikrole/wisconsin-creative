import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("retired successful-scan badge metric", () => {
  it("keeps operational scans but emits no badge scan result", () => {
    for (const route of [
      "src/app/api/kiosk/checkout/scan/route.ts",
      "src/app/api/kiosk/pickup/[id]/scan/route.ts",
      "src/app/api/kiosk/checkin/[id]/scan/route.ts",
    ]) {
      const routeSource = source(route);
      expect(routeSource).not.toContain("onScanResult");
      expect(routeSource).not.toContain("badgeScanSourceKey");
    }

    expect(source("src/lib/badges/evaluator.ts")).not.toContain("export async function onScanResult");
    expect(source("src/lib/schemas/kiosk.ts")).not.toContain("scanAttemptId");
  });

  it("retires definitions without deleting historical awards", () => {
    const migration = source("prisma/migrations/0110_badge_rewards/migration.sql");
    expect(migration).toContain("'first_scan', 'scan_10', 'scan_25', 'scan_50', 'scan_100', 'zero_errors'");
    expect(migration).toContain('"active" = false');
    expect(migration).not.toMatch(/DELETE FROM "student_badges"/i);
  });
});
