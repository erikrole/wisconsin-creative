import type { GraduationTerm } from "@prisma/client";
import { z } from "zod";
import { withAuth } from "@/lib/api";
import { createAuditEntryTx } from "@/lib/audit";
import { db } from "@/lib/db";
import { MAX_IMPORT_CHARS, MAX_IMPORT_ROWS } from "@/lib/hiring/import";
import { HttpError, ok } from "@/lib/http";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/rbac";
import { parseRosterCsv, planRosterImport } from "@/lib/workforce/roster-import";

const importSchema = z.object({
  csv: z.string().min(1).max(MAX_IMPORT_CHARS),
  /** Calendar year in which the roster's Fall term falls (2025 for the 2025-26 sheet). */
  academicYearStart: z.number().int().min(2000).max(2100),
  apply: z.boolean().default(false),
});

export const POST = withAuth(async (req, { user }) => {
  requirePermission(user.role, "workforce", "manage");
  await enforceRateLimit(`workforce:import:${user.id}`, SETTINGS_MUTATION_LIMIT);
  const body = importSchema.parse(await req.json());

  const { records, skipped } = parseRosterCsv(body.csv, body.academicYearStart);
  if (records.length === 0) throw new HttpError(400, "No rows found. Include a header row and at least one person.");
  if (records.length > MAX_IMPORT_ROWS) throw new HttpError(413, `Imports are limited to ${MAX_IMPORT_ROWS} rows.`);

  const emails = [...new Set(records.flatMap((r) => r.emails))];
  const users = emails.length
    ? await db.user.findMany({
        where: { OR: [{ email: { in: emails } }, { athleticsEmail: { in: emails } }] },
        select: { id: true, name: true, email: true, athleticsEmail: true, startTerm: true, staffingType: true },
      })
    : [];
  const placements = users.length
    ? await db.studentTermPlacement.findMany({
        where: { userId: { in: users.map((u) => u.id) } },
        select: { userId: true, term: true, year: true },
      })
    : [];

  const plan = planRosterImport(records, users, new Set(placements.map((p) => `${p.userId}:${p.term}:${p.year}`)));
  const counts = {
    updated: plan.filter((p) => p.action === "update").length,
    noChange: plan.filter((p) => p.action === "no_change").length,
    unmatched: plan.filter((p) => p.action === "unmatched").length,
    startTerms: plan.filter((p) => p.setStartTerm).length,
    placements: plan.reduce((n, p) => n + p.newPlacements.length, 0),
    skippedRows: skipped,
  };

  let applied = false;
  if (body.apply) {
    const writable = plan.filter((p) => p.action === "update");
    let actual = { startTerms: 0, placements: 0 };
    await db.$transaction(
      async (tx) => {
        // Start terms: one updateMany per distinct term (a roster has only a few), guarded to
        // people who still have none so an existing value is never overwritten.
        const byStart = new Map<string, { term: GraduationTerm; year: number; ids: string[] }>();
        for (const item of writable) {
          if (!item.setStartTerm || !item.record.startTerm) continue;
          const { term, year } = item.record.startTerm;
          const key = `${term}:${year}`;
          const group = byStart.get(key) ?? { term, year, ids: [] };
          group.ids.push(item.userId!);
          byStart.set(key, group);
        }
        let startTermsWritten = 0;
        for (const { term, year, ids } of byStart.values()) {
          const result = await tx.user.updateMany({ where: { id: { in: ids }, startTerm: null }, data: { startTerm: term, startTermYear: year } });
          startTermsWritten += result.count;
        }

        // Placements: one batched insert. The plan already removed anything that exists or
        // repeats in the file; skipDuplicates keeps a concurrent edit from failing the import.
        const placements = writable.flatMap((item) =>
          item.newPlacements.map((placement) => ({
            userId: item.userId!,
            term: placement.term,
            year: placement.year,
            area: item.record.area,
            sportCodes: placement.sportCodes,
          })),
        );
        let placementsWritten = 0;
        if (placements.length > 0) {
          placementsWritten = (await tx.studentTermPlacement.createMany({ data: placements, skipDuplicates: true })).count;
        }
        // A concurrent edit can make the guarded writes skip rows the preview counted. Report what
        // was really written, in the audit and the response, so the evidence is never overstated.
        actual = { startTerms: startTermsWritten, placements: placementsWritten };
        // Counts only, in the same transaction so the import never commits without its evidence.
        await createAuditEntryTx(tx, {
          actorId: user.id,
          actorRole: user.role,
          entityType: "workforce_import",
          entityId: `roster-${body.academicYearStart}`,
          action: "import",
          after: { startTerms: actual.startTerms, placements: actual.placements, unmatched: counts.unmatched },
        });
      },
      { timeout: 60_000 },
    );
    applied = true;
    counts.startTerms = actual.startTerms;
    counts.placements = actual.placements;
  }

  return ok({
    data: {
      applied,
      counts,
      rows: plan.map((p) => ({
        line: p.record.line,
        name: p.record.name,
        action: p.action,
        reason: p.reason,
        startTerm: p.setStartTerm,
        placements: p.newPlacements.length,
        warnings: p.record.warnings,
      })),
    },
  });
});
