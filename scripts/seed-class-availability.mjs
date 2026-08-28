#!/usr/bin/env node

/**
 * Seed weekly class blocks into student availability.
 *
 * Class schedules arrive once a semester as screenshots, get transcribed into a
 * JSON file, and then have to reach `StudentAvailabilityBlock` so scheduling
 * stops proposing people who are in class. This is that last step.
 *
 * It is deliberately conservative:
 *   - dry run by default; `--apply` is required to write anything
 *   - a name that matches zero or more than one active user is reported and
 *     skipped, never guessed at
 *   - a block identical to one already stored is skipped, so re-running is safe
 *   - anything the transcription marked `needsReview` is skipped unless
 *     `--include-review` is passed
 *
 * Usage:
 *   node scripts/seed-class-availability.mjs data.json --validate
 *   DATABASE_URL=... node scripts/seed-class-availability.mjs data.json
 *   DATABASE_URL=... node scripts/seed-class-availability.mjs data.json --apply
 */

import { readFileSync } from "node:fs";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "@prisma/client";

const args = process.argv.slice(2);
const dataPath = args.find((arg) => !arg.startsWith("--"));
const apply = args.includes("--apply");
const includeReview = args.includes("--include-review");
const validateOnly = args.includes("--validate");

if (!dataPath) {
  console.error("Usage: node scripts/seed-class-availability.mjs <data.json> [--validate] [--apply] [--include-review]");
  process.exit(1);
}

const payload = JSON.parse(readFileSync(dataPath, "utf8"));
const { semesterLabel, semesterStartsOn, semesterEndsOn, people } = payload;
if (!semesterLabel || !Array.isArray(people)) {
  console.error("Data file must contain semesterLabel and a people array.");
  process.exit(1);
}

/**
 * Check the file against the same rules the availability API enforces, so a bad
 * transcription is caught here rather than halfway through a write.
 */
function validate() {
  const problems = [];
  const seen = new Set();
  for (const person of people) {
    if (!person.name?.trim()) problems.push("a person entry has no name");
    for (const block of person.blocks ?? []) {
      const where = `${person.name} ${block.label ?? "(unlabelled)"}`;
      if (!Number.isInteger(block.dayOfWeek) || block.dayOfWeek < 0 || block.dayOfWeek > 6) {
        problems.push(`${where}: dayOfWeek must be an integer 0-6`);
      }
      for (const field of ["startsAt", "endsAt"]) {
        if (!/^\d{2}:\d{2}$/.test(block[field] ?? "")) problems.push(`${where}: ${field} must be HH:mm`);
      }
      if (block.startsAt >= block.endsAt) problems.push(`${where}: startsAt must be before endsAt`);
      const key = `${person.name}|${block.dayOfWeek}|${block.startsAt}|${block.endsAt}`;
      if (seen.has(key)) problems.push(`${where}: duplicate block in the data file`);
      seen.add(key);
    }
  }
  return problems;
}

const problems = validate();
if (problems.length > 0) {
  console.error(`Data file has ${problems.length} problem${problems.length === 1 ? "" : "s"}:`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

const confident = people.reduce((sum, p) => sum + (p.blocks ?? []).filter((b) => !b.needsReview).length, 0);
const review = people.reduce((sum, p) => sum + (p.blocks ?? []).filter((b) => b.needsReview).length, 0);
console.log(`${semesterLabel}: ${people.length} people, ${confident} confident blocks, ${review} held for review.`);

if (validateOnly) {
  console.log("Data file is valid. Re-run without --validate (and with DATABASE_URL) to seed.");
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required to seed class availability. Use --validate to check the file alone.");
  process.exit(1);
}

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });

/** Compare names the way a human would: case and inner spacing do not matter. */
function normalizeName(value) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

const summary = { matched: 0, unmatched: [], ambiguous: [], created: 0, duplicates: 0, skippedForReview: 0 };

try {
  const users = await db.user.findMany({
    where: { active: true, role: { not: "COLLABORATOR" } },
    select: { id: true, name: true, email: true },
  });
  const byName = new Map();
  for (const user of users) {
    const key = normalizeName(user.name);
    byName.set(key, [...(byName.get(key) ?? []), user]);
  }

  for (const person of people) {
    const candidates = byName.get(normalizeName(person.name)) ?? [];
    if (candidates.length === 0) {
      summary.unmatched.push(person.name);
      continue;
    }
    if (candidates.length > 1) {
      summary.ambiguous.push(`${person.name} (${candidates.map((c) => c.email).join(", ")})`);
      continue;
    }
    const user = candidates[0];
    summary.matched += 1;

    const existing = await db.studentAvailabilityBlock.findMany({
      where: { userId: user.id, kind: "WEEKLY" },
      select: { dayOfWeek: true, startsAt: true, endsAt: true, semesterLabel: true },
    });
    const existingKeys = new Set(
      existing.map((block) => `${block.dayOfWeek}|${block.startsAt}|${block.endsAt}|${block.semesterLabel ?? ""}`),
    );

    const pending = [];
    for (const block of person.blocks ?? []) {
      if (block.needsReview && !includeReview) {
        summary.skippedForReview += 1;
        continue;
      }
      const key = `${block.dayOfWeek}|${block.startsAt}|${block.endsAt}|${semesterLabel}`;
      if (existingKeys.has(key)) {
        summary.duplicates += 1;
        continue;
      }
      existingKeys.add(key);
      pending.push({
        userId: user.id,
        kind: "WEEKLY",
        intent: "CANNOT_WORK",
        status: "APPROVED",
        dayOfWeek: block.dayOfWeek,
        startsAt: block.startsAt,
        endsAt: block.endsAt,
        label: block.label?.slice(0, 80),
        semesterLabel,
        semesterStartsOn: semesterStartsOn ? new Date(`${semesterStartsOn}T00:00:00.000Z`) : null,
        semesterEndsOn: semesterEndsOn ? new Date(`${semesterEndsOn}T00:00:00.000Z`) : null,
      });
    }

    console.log(`${user.name}: ${pending.length} new block${pending.length === 1 ? "" : "s"}`);
    if (apply && pending.length > 0) {
      await db.studentAvailabilityBlock.createMany({ data: pending });
    }
    summary.created += pending.length;
  }

  console.log("\n--- summary ---");
  console.log(`people matched:      ${summary.matched}`);
  console.log(`blocks ${apply ? "created" : "to create"}:  ${summary.created}`);
  console.log(`already present:     ${summary.duplicates}`);
  console.log(`held for review:     ${summary.skippedForReview}`);
  if (summary.unmatched.length > 0) console.log(`no user match:       ${summary.unmatched.join(", ")}`);
  if (summary.ambiguous.length > 0) console.log(`ambiguous name:      ${summary.ambiguous.join("; ")}`);
  if (!apply) console.log("\nDry run. Re-run with --apply to write these blocks.");
} catch (error) {
  console.error(`\nSeeding failed: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
