import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync(
  "prisma/migrations/0099_shift_group_working_copy/migration.sql",
  "utf8",
);
const historyMigration = readFileSync(
  "prisma/migrations/0139_schedule_working_copy_undo_redo/migration.sql",
  "utf8",
);

describe("schedule working-copy persistence", () => {
  it("keeps one versioned working copy per shift group", () => {
    expect(schema).toContain("model ShiftGroupWorkingCopy");
    expect(schema).toMatch(/shiftGroupId\s+String\s+@id @map\("shift_group_id"\)/);
    expect(schema).toMatch(/publishedVersion\s+Int\s+@default\(0\) @map\("published_version"\)/);
    expect(schema).toMatch(/basePublishedVersion\s+Int/);
    expect(schema).toMatch(/payloadVersion\s+Int/);
    expect(schema).toMatch(/payload\s+Json/);
    expect(schema).toMatch(/templateManaged\s+Boolean\s+@default\(false\) @map\("template_managed"\)/);
  });

  it("backfills existing published groups and enforces version bounds", () => {
    expect(migration).toContain('WHERE "published_at" IS NOT NULL');
    expect(migration).toContain('SET "published_version" = 1');
    expect(migration).toContain('CHECK ("version" > 0)');
    expect(migration).toContain('CHECK ("base_published_version" >= 0)');
    expect(migration).toContain('REFERENCES "shift_groups"("id") ON DELETE CASCADE');
    expect(migration).toContain('ADD COLUMN "template_managed" BOOLEAN NOT NULL DEFAULT false');
    expect(migration).toContain('shift_group."generated_at" IS NOT NULL');
  });

  it("stores bounded per-command undo and redo stacks beside the version", () => {
    expect(schema).toContain('undoStack            Json       @default("[]") @map("undo_stack")');
    expect(schema).toContain('redoStack            Json       @default("[]") @map("redo_stack")');
    expect(historyMigration).toContain('ADD COLUMN "undo_stack" JSONB NOT NULL DEFAULT \'[]\'::jsonb');
    expect(historyMigration).toContain('ADD COLUMN "redo_stack" JSONB NOT NULL DEFAULT \'[]\'::jsonb');
    expect(historyMigration).toContain('jsonb_typeof("undo_stack") = \'array\'');
    expect(historyMigration).toContain('jsonb_typeof("redo_stack") = \'array\'');
  });
});
