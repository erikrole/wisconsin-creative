#!/usr/bin/env node
// Rebuild sport, opponent, home/away, and outcome on synced events that ICS
// sync can no longer reach.
//
// Why: classification improved after these rows were imported, and sync only
// re-derives rows still present in the feed. A finished game eventually drops
// out of the feed, so those rows keep whatever they were first given —
// typically a raw title, a null sportCode, and no result. Every input needed to
// redo the work is already stored on the row (rawSummary, rawLocationText), so
// this recomputes them through `classifySourceEvent`, the exact function sync
// uses. No second copy of the parsing rules.
//
// Requires migration 0124 (the `site` column) to be applied first — the script
// reads and writes it, and will fail with Prisma P2022 against a database that
// predates it.
//
// Usage:
//   node --env-file=.env.preview.local --import ./scripts/lib/register-ts.mjs \
//     scripts/reclassify-legacy-events.ts            # dry run
//   ... scripts/reclassify-legacy-events.ts --apply  # execute
//
// Respects manual locks: a locked title, a locked home/away, and every
// locationId are left alone. Outcome is sticky like sync — a marker can set or
// correct a result, never erase one. With --apply, per-field before/after is
// written to .tmp/reclassify-legacy-<ts>.json so the change is reversible.

import { mkdirSync, writeFileSync } from "node:fs";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "@prisma/client";

import { buildVenueSearchText, classifySourceEvent } from "@/lib/schedule-event-identity";
import { sortVenueMappings, venueMappingMatches } from "@/lib/venue-mapping-contract";
import { resolvedEventSite } from "@/lib/venue-tone";

const APPLY = process.argv.includes("--apply");

/**
 * Agreed backfill cutoff. Events on or after this date are still in the ICS
 * feed, so sync re-derives them; rewriting them here would fight the live
 * pipeline over rows it already owns.
 */
const BACKFILL_CUTOFF = new Date("2026-07-01T00:00:00.000Z");

type FieldChange = { field: string; before: unknown; after: unknown };

async function main() {
  const db = new PrismaClient({
    adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }),
  });

  try {
    const rawMappings = await db.locationMapping.findMany({
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
      include: { location: { select: { isHomeVenue: true } } },
    });
    const mappings = sortVenueMappings(
      rawMappings.map((m) => ({
        id: m.id,
        pattern: m.pattern,
        locationId: m.locationId,
        isHomeVenue: m.location.isHomeVenue,
        priority: m.priority,
        createdAt: m.createdAt,
      })),
    );

    const rows = await db.calendarEvent.findMany({
      where: {
        sourceId: { not: null },
        rawSummary: { not: null },
        OR: [
          { startsAt: { lt: BACKFILL_CUTOFF } },
          // A locked row with no site is reachable by nobody else. Sync repairs
          // one only while the game is still in the feed, and a finished game
          // drops out -- which is exactly when the Scoreboard starts counting
          // it. The cutoff exists to stop this script fighting sync over rows
          // sync owns; it does not own a locked row's classification, so these
          // are pulled in at any date and only ever have `site` staged.
          { isHomeLocked: true, site: null },
        ],
      },
      select: {
        id: true, summary: true, rawSummary: true, rawLocationText: true,
        sportCode: true, opponent: true, isHome: true, site: true, result: true,
        summaryLocked: true, isHomeLocked: true, startsAt: true,
      },
      orderBy: { startsAt: "desc" },
    });

    const plan: Array<{ id: string; title: string; changes: FieldChange[]; data: Record<string, unknown> }> = [];
    const siteTally = new Map<string, number>([["HOME", 0], ["AWAY", 0], ["NEUTRAL", 0], ["UNKNOWN", 0]]);

    for (const row of rows) {
      const rawSummary = row.rawSummary ?? "";
      const rawSearchText = `${row.rawLocationText ?? ""} ${rawSummary}`.toLowerCase();
      const searchText = buildVenueSearchText(row.rawLocationText, rawSummary);
      let mappedIsHomeVenue: boolean | null = null;
      for (const mapping of mappings) {
        if (venueMappingMatches(mapping.pattern, searchText, rawSearchText)) {
          mappedIsHomeVenue = mapping.isHomeVenue ?? null;
          break;
        }
      }

      const next = classifySourceEvent({
        rawSummary,
        rawLocationText: row.rawLocationText,
        mappedIsHomeVenue,
      });
      const siteKey = next.site ?? "UNKNOWN";
      siteTally.set(siteKey, (siteTally.get(siteKey) ?? 0) + 1);

      const changes: FieldChange[] = [];
      const data: Record<string, unknown> = {};
      const stage = (field: string, before: unknown, after: unknown) => {
        if (before !== after) {
          changes.push({ field, before, after });
          data[field] = after;
        }
      };

      // Past the cutoff, sync is the owner of everything except a locked
      // classification, so those rows are here for their missing site alone.
      const withinCutoff = row.startsAt < BACKFILL_CUTOFF;

      if (withinCutoff && !row.summaryLocked) stage("summary", row.summary, next.summary);
      if (withinCutoff && !row.isHomeLocked) {
        stage("sportCode", row.sportCode, next.sportCode);
        stage("opponent", row.opponent, next.opponent);
        stage("isHome", row.isHome, next.isHome);
        stage("site", row.site, next.site);
      } else if (row.site === null) {
        // A locked row keeps its operator-chosen sport, opponent, and
        // home/away. It does not get to keep a missing site: `site` was added
        // after these rows were written, the lock kept every writer away from
        // them, and the result is a locked neutral game reading as an unknown
        // one on the Scoreboard while Schedule shows it as neutral. This
        // records the choice already stored in `isHome` + `opponent`; it never
        // overrides one.
        stage("site", row.site, resolvedEventSite(row));
      }
      // Sticky, exactly as sync treats it: set or correct, never erase.
      if (withinCutoff && next.result !== null) stage("result", row.result, next.result);

      if (changes.length > 0) plan.push({ id: row.id, title: row.summary, changes, data });
    }

    const byField = new Map<string, number>();
    for (const item of plan) {
      for (const c of item.changes) byField.set(c.field, (byField.get(c.field) ?? 0) + 1);
    }

    const strandedSites = rows.filter((row) => row.isHomeLocked && row.site === null).length;
    console.log(`Backfill cutoff: events before ${BACKFILL_CUTOFF.toISOString().slice(0, 10)}`);
    console.log(`Synced rows with stored raw evidence in scope: ${rows.length}`);
    console.log(`Locked rows with no site (site repair only, any date): ${strandedSites}`);
    console.log(`Rows needing repair: ${plan.length}\n`);
    console.log("Field changes:");
    for (const [field, count] of [...byField].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${field.padEnd(10)} ${count}`);
    }
    console.log("\nSite classification across all synced rows:");
    for (const [site, count] of siteTally) console.log(`  ${site.padEnd(8)} ${count}`);

    console.log("\nSample:");
    for (const item of plan.slice(0, 6)) {
      console.log(`  ${JSON.stringify(item.title)}`);
      for (const c of item.changes) {
        console.log(`    ${c.field}: ${JSON.stringify(c.before)} -> ${JSON.stringify(c.after)}`);
      }
    }

    if (!APPLY) {
      console.log(`\nDry run — nothing written. Re-run with --apply to update ${plan.length} row(s).`);
      return;
    }
    if (plan.length === 0) {
      console.log("\nNothing to apply.");
      return;
    }

    mkdirSync(".tmp", { recursive: true });
    const logPath = `.tmp/reclassify-legacy-${Date.now()}.json`;
    writeFileSync(logPath, JSON.stringify(plan, null, 2));

    for (const item of plan) {
      await db.calendarEvent.update({ where: { id: item.id }, data: item.data });
    }
    console.log(`\nApplied ${plan.length} update(s). Reversible log: ${logPath}`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
