#!/usr/bin/env node

// Read-only Creative Wrapped dry run. Builds every eligible person's recap from
// the database in DATABASE_URL, exactly as the preview would, and prints a
// report of odd cases. It never writes: it calls buildWrappedRecap, not the
// freezing getWrappedRecap.
//
// Usage:
//   node --env-file=.env.preview.local --import ./scripts/lib/register-ts.mjs \
//     scripts/wrapped-dry-run.ts [--json]

import { db } from "@/lib/db";
import { buildWrappedRecap } from "@/lib/services/wrapped";

const JSON_OUT = process.argv.includes("--json");
const BAD_TEXT = /undefined|null|NaN|\[object/;

function flags(recap: NonNullable<Awaited<ReturnType<typeof buildWrappedRecap>>>): string[] {
  const out: string[] = [];
  const ids = recap.cards.map((card) => card.id);
  if (recap.cards.length === 0) out.push("no personal cards");
  if (ids.includes("events") && !ids.includes("hours")) out.push("events but no hours");
  if (!ids.includes("sport") && ids.includes("events")) out.push("events but no sport");
  for (const card of [...recap.cards, ...recap.team]) {
    const text = [card.eyebrow, card.value, card.sentence, ...(card.items ?? []).flatMap((item) => [item.label, item.value])].join(" | ");
    if (BAD_TEXT.test(text)) out.push(`odd text in ${card.id}: ${text.slice(0, 80)}`);
    if (card.value.length > 40) out.push(`long value in ${card.id}: ${card.value}`);
  }
  return out;
}

async function main() {
  const users = await db.user.findMany({
    where: { active: true, role: { not: "COLLABORATOR" } },
    select: { id: true, name: true, role: true },
    orderBy: { name: "asc" },
  });
  const now = new Date();
  const rows: { name: string; role: string; cards: string[]; hours: string | null; flags: string[] }[] = [];
  let team: string[] = [];
  for (const user of users) {
    const recap = await buildWrappedRecap(user.id, now);
    if (!recap) continue;
    team = recap.team.map((card) => `${card.id}=${card.value}`);
    rows.push({
      name: user.name,
      role: user.role,
      cards: recap.cards.map((card) => card.id),
      hours: recap.cards.find((card) => card.id === "hours")?.value ?? null,
      flags: flags(recap),
    });
  }
  if (JSON_OUT) {
    console.log(JSON.stringify({ team, rows }, null, 2));
    return;
  }
  console.log(`Wrapped dry run: ${rows.length} people, ${rows.filter((row) => row.cards.length > 0).length} with a story`);
  console.log(`Team cards: ${team.join(", ") || "none"}`);
  for (const row of rows) {
    console.log(`${row.name} (${row.role}): ${row.cards.length} cards, hours ${row.hours ?? "-"}${row.flags.length ? `  !! ${row.flags.join("; ")}` : ""}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
