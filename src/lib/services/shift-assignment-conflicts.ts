import { Prisma } from "@prisma/client";

type ShiftAssignmentConflictRefresh = {
  id: string;
  hasConflict: boolean;
  conflictNote: string | null;
};

export async function updateShiftAssignmentConflictsTx(
  tx: Prisma.TransactionClient,
  rows: ShiftAssignmentConflictRefresh[],
  resetAcknowledgements: boolean,
) {
  if (rows.length === 0) return;

  const values = rows.map((row) => Prisma.sql`(
    CAST(${row.id} AS TEXT),
    CAST(${row.hasConflict} AS BOOLEAN),
    CAST(${row.conflictNote} AS TEXT)
  )`);
  const updatedCount = await tx.$executeRaw(Prisma.sql`
    UPDATE "shift_assignments" AS current
    SET
      "has_conflict" = incoming.has_conflict,
      "conflict_note" = incoming.conflict_note,
      "acknowledged_at" = CASE
        WHEN CAST(${resetAcknowledgements} AS BOOLEAN) THEN NULL
        ELSE current."acknowledged_at"
      END,
      "acknowledged_by_id" = CASE
        WHEN CAST(${resetAcknowledgements} AS BOOLEAN) THEN NULL
        ELSE current."acknowledged_by_id"
      END,
      "updated_at" = NOW()
    FROM (VALUES ${Prisma.join(values)}) AS incoming(id, has_conflict, conflict_note)
    WHERE current.id = incoming.id
  `);

  if (updatedCount !== rows.length) {
    throw new Error("One or more shift assignments changed during conflict refresh");
  }
}
