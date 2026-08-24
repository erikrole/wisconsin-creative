#!/usr/bin/env node

// Repair post-cutoff event classification so the profile Scoreboard reads the
// same canonical Home/Away/Neutral fields as Schedule, and attribute resolved
// games to the active workers already recorded on their shifts.
//
// The schedule assignments are the worker source of truth. This script does
// not create assignments from guesses; it restores CalendarEvent.site from the
// stored schedule evidence and CalendarEvent.result when the synced raw
// summary contains an explicit [W]/[L]/[T] marker.
//
// Usage:
//   node --env-file=.env.preview.local --import ./scripts/lib/register-ts.mjs \
//     scripts/backfill-profile-scoreboard.ts            # dry run
//   ... scripts/backfill-profile-scoreboard.ts --apply  # execute

import { mkdirSync, writeFileSync } from "node:fs";

import { db } from "@/lib/db";
import { GAME_RECORD_START_DATE } from "@/lib/services/game-record";
import { ACTIVE_ASSIGNMENT_STATUSES } from "@/lib/shift-constants";
import { buildVenueSearchText, classifySourceEvent } from "@/lib/schedule-event-identity";
import { sortVenueMappings, venueMappingMatches } from "@/lib/venue-mapping-contract";

const APPLY = process.argv.includes("--apply");
const WRITE_CHUNK_SIZE = 50;
type Site = "HOME" | "AWAY" | "NEUTRAL";
type Result = "WIN" | "LOSS" | "TIE";

type FieldChange = { field: "site" | "result"; before: unknown; after: unknown };

type BackfillItem = {
  id: string;
  startsAt: string;
  summary: string;
  changes: FieldChange[];
  data: {
    site?: Site | null;
    result?: Result;
  };
  workers: Array<{ id: string; name: string }>;
};

async function main() {
  try {
    const rawMappings = await db.locationMapping.findMany({
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
      include: { location: { select: { isHomeVenue: true } } },
    });
    const mappings = sortVenueMappings(
      rawMappings.map((mapping) => ({
        id: mapping.id,
        pattern: mapping.pattern,
        locationId: mapping.locationId,
        isHomeVenue: mapping.location.isHomeVenue,
        priority: mapping.priority,
        createdAt: mapping.createdAt,
      })),
    );

    const rows = await db.calendarEvent.findMany({
      where: {
        sourceId: { not: null },
        startsAt: { gte: GAME_RECORD_START_DATE },
        rawSummary: { not: null },
      },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        startsAt: true,
        summary: true,
        rawSummary: true,
        rawLocationText: true,
        site: true,
        isHome: true,
        isHomeLocked: true,
        opponent: true,
        result: true,
        shiftGroup: {
          select: {
            shifts: {
              select: {
                assignments: {
                  where: { status: { in: ACTIVE_ASSIGNMENT_STATUSES } },
                  select: { userId: true, user: { select: { name: true } } },
                },
              },
            },
          },
        },
      },
    });

    const plan: BackfillItem[] = [];
    for (const row of rows) {
      const rawSummary = row.rawSummary ?? "";
      if (!rawSummary) continue;

      const rawSearchText = `${row.rawLocationText ?? ""} ${rawSummary}`.toLowerCase();
      const searchText = buildVenueSearchText(row.rawLocationText, rawSummary);
      let mappedIsHomeVenue: boolean | null = null;
      for (const mapping of mappings) {
        if (venueMappingMatches(mapping.pattern, searchText, rawSearchText)) {
          mappedIsHomeVenue = mapping.isHomeVenue ?? null;
          break;
        }
      }

      const classified = classifySourceEvent({
        rawSummary,
        rawLocationText: row.rawLocationText,
        mappedIsHomeVenue,
      });
      const changes: FieldChange[] = [];
      const data: BackfillItem["data"] = {};
      const lockedSite = row.opponent
        ? row.isHome === true ? "HOME" : row.isHome === false ? "AWAY" : null
        : null;
      const expectedSite = row.isHomeLocked ? lockedSite : classified.site;

      if (row.site !== expectedSite) {
        changes.push({ field: "site", before: row.site, after: expectedSite });
        data.site = expectedSite;
      }
      // Sticky, exactly as sync treats it: an explicit marker can set or
      // correct an outcome, but an absent marker never erases one.
      if (classified.result !== null && row.result !== classified.result) {
        changes.push({ field: "result", before: row.result, after: classified.result });
        data.result = classified.result;
      }

      if (changes.length === 0) continue;

      const workers = new Map<string, string>();
      for (const shift of row.shiftGroup?.shifts ?? []) {
        for (const assignment of shift.assignments) workers.set(assignment.userId, assignment.user.name);
      }

      plan.push({
        id: row.id,
        startsAt: row.startsAt.toISOString(),
        summary: row.summary,
        changes,
        data,
        workers: [...workers.entries()].map(([id, name]) => ({ id, name })),
      });
    }

    const tally = plan.reduce(
      (counts, item) => {
        if (item.data.site !== undefined) counts.site += 1;
        if (item.data.result !== undefined) {
          counts.result += 1;
          counts[item.data.result] += 1;
        }
        counts.workerLinks += item.workers.length;
        return counts;
      },
      { site: 0, result: 0, WIN: 0, LOSS: 0, TIE: 0, workerLinks: 0 },
    );

    console.log(`Backfill cutoff: events on or after ${GAME_RECORD_START_DATE.toISOString().slice(0, 10)}`);
    console.log(`Rows inspected: ${rows.length}`);
    console.log(`Rows with schedule metadata to repair: ${plan.length}`);
    console.log(`Site updates: ${tally.site}`);
    console.log(`Outcome updates: ${tally.result}`);
    console.log(`Active worker links already present: ${tally.workerLinks}`);
    console.log(`  WIN  ${tally.WIN}`);
    console.log(`  LOSS ${tally.LOSS}`);
    console.log(`  TIE  ${tally.TIE}`);

    const sampleLimit = 30;
    for (const item of plan.slice(0, sampleLimit)) {
      const workers = item.workers.length > 0 ? item.workers.map((worker) => worker.name).join(", ") : "no active worker";
      const changes = item.changes
        .map((change) => `${change.field} ${JSON.stringify(change.before)} -> ${JSON.stringify(change.after)}`)
        .join(", ");
      console.log(`  ${item.startsAt.slice(0, 10)} ${JSON.stringify(item.summary)} · ${changes} · ${workers}`);
    }
    if (plan.length > sampleLimit) console.log(`  … ${plan.length - sampleLimit} more row(s)`);

    if (!APPLY) {
      console.log("\nDry run — nothing written. Re-run with --apply to repair these schedule fields.");
      return;
    }
    if (plan.length === 0) {
      console.log("\nNothing to apply.");
      return;
    }

    mkdirSync(".tmp", { recursive: true });
    const logPath = `.tmp/profile-scoreboard-backfill-${Date.now()}.json`;
    writeFileSync(logPath, JSON.stringify(plan, null, 2));

    for (let start = 0; start < plan.length; start += WRITE_CHUNK_SIZE) {
      const chunk = plan.slice(start, start + WRITE_CHUNK_SIZE);
      await db.$transaction(async (tx) => {
        await Promise.all(
          chunk.map((item) =>
            tx.calendarEvent.update({
              where: { id: item.id },
              data: item.data,
            }),
          ),
        );
      });
      console.log(`  Applied chunk ${Math.floor(start / WRITE_CHUNK_SIZE) + 1}/${Math.ceil(plan.length / WRITE_CHUNK_SIZE)}`);
    }

    console.log(`\nApplied ${plan.length} schedule update(s). Reversible log: ${logPath}`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
