import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("event checkout assignments migration", () => {
  it("adds event scope and optional serialized-item assignees additively", () => {
    const sql = readFileSync(
      join(process.cwd(), "prisma/migrations/0141_event_checkout_assignments/migration.sql"),
      "utf8",
    );

    expect(sql).toContain('CREATE TYPE "BookingCustodyScope" AS ENUM (\'PERSON\', \'EVENT\')');
    expect(sql).toContain(
      'ADD COLUMN "custody_scope" "BookingCustodyScope" NOT NULL DEFAULT \'PERSON\'',
    );
    expect(sql).toContain('ADD COLUMN "assigned_user_id" TEXT');
    expect(sql).toContain('ADD COLUMN "assigned_at" TIMESTAMP(3)');
    expect(sql).toContain(
      'FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id")',
    );
    expect(sql).toContain("ON DELETE SET NULL ON UPDATE CASCADE");
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN|TYPE)/i);
  });
});
