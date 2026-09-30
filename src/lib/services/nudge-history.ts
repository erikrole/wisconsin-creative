import { db } from "@/lib/db";

export type LastNudge = {
  at: string;
  byName: string | null;
};

/**
 * Most recent staff nudge per booking, read from the audit entry the nudge
 * route writes. Staff otherwise cannot tell whether a colleague already
 * chased this borrower, because the "sent" state lived only in one screen.
 */
export async function readLastNudges(bookingIds: string[]): Promise<Map<string, LastNudge>> {
  const result = new Map<string, LastNudge>();
  if (bookingIds.length === 0) return result;

  const rows = await db.auditLog.findMany({
    where: { entityType: "booking", entityId: { in: bookingIds }, action: "overdue_nudge_sent" },
    orderBy: { createdAt: "desc" },
    // Newest first, so the first row seen per booking wins. The route allows
    // one nudge per booking per hour, so this stays small without a cap that
    // could let one long-overdue booking crowd out the others.
    select: { entityId: true, createdAt: true, actor: { select: { name: true } } },
  });

  for (const row of rows) {
    if (result.has(row.entityId)) continue;
    result.set(row.entityId, { at: row.createdAt.toISOString(), byName: row.actor?.name ?? null });
  }
  return result;
}

export async function readLastNudge(bookingId: string): Promise<LastNudge | null> {
  return (await readLastNudges([bookingId])).get(bookingId) ?? null;
}
