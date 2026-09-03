import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("shared checkout custody migration", () => {
  it("renames the unused event scope without dropping deployed data", () => {
    const sql = readFileSync(
      join(process.cwd(), "prisma/migrations/0143_shared_checkout_custody/migration.sql"),
      "utf8",
    );

    expect(sql).toContain(
      'ALTER TYPE "BookingCustodyScope" RENAME VALUE \'EVENT\' TO \'SHARED\'',
    );
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN|TYPE)/i);
    expect(sql).not.toMatch(/UPDATE\s+"booking_serialized_items"/i);
  });
});
