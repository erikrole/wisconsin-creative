#!/usr/bin/env node
// Seed the UA staff gear pick roster for one cycle.
//
//   node scripts/seed-gear-pick-participants.mjs            # dry run (default)
//   node scripts/seed-gear-pick-participants.mjs --apply    # write participants
//
// Idempotent: the cycle row is created only if missing, and an existing
// participant row is never changed, so a later admin edit to fit or allowance
// from /gear/admin survives a re-run. People are matched by exact, active
// `users.name`; anyone not found is reported and skipped.
import { neon } from "@neondatabase/serverless";
import "dotenv/config";
import { resolvePrismaDirectUrl } from "./lib/prisma-direct-url.mjs";

const CYCLE = {
  id: "2027-28",
  title: "2027–28 Under Armour staff gear",
};

// Allowance in whole cents by fit. Mirrors `allowances` in
// src/lib/gear-picks/catalog-2027-28.json (MEN $185, WOMEN $350).
const ALLOWANCE_CENTS = { MEN: 18_500, WOMEN: 35_000 };

// The 2027-28 roster, as decided by the equipment owner. Laurie Digman also
// picks this cycle but has no site account, so she is handled off-site.
const PARTICIPANTS = [
  { name: "Jerry Mao", fit: "MEN" },
  { name: "Ryan Dean", fit: "MEN" },
  { name: "Erik Role", fit: "MEN" },
  { name: "Cole Ahlgren", fit: "MEN" },
  { name: "Usman Syed", fit: "MEN" },
  { name: "Nolan Kromke", fit: "MEN" },
  { name: "Maddy Pehler", fit: "WOMEN" },
  { name: "Emma Hansen", fit: "WOMEN" },
];

const OFF_SITE = ["Laurie Digman"];

const apply = process.argv.includes("--apply");

const { connectionString } = resolvePrismaDirectUrl();
const sql = neon(connectionString);

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  const names = PARTICIPANTS.map((participant) => participant.name);
  const users = await sql`
    SELECT id, name
    FROM users
    WHERE active = true AND role <> 'COLLABORATOR' AND name = ANY(${names})
    ORDER BY name, id
  `;

  const byName = new Map();
  for (const user of users) {
    byName.set(user.name, [...(byName.get(user.name) ?? []), user]);
  }

  const planned = [];
  const skipped = [];
  for (const participant of PARTICIPANTS) {
    const matches = byName.get(participant.name) ?? [];
    if (matches.length === 0) {
      skipped.push({ ...participant, reason: "no active user with this exact name" });
    } else if (matches.length > 1) {
      skipped.push({ ...participant, reason: `${matches.length} active users share this name; add them from /gear/admin` });
    } else {
      planned.push({ ...participant, userId: matches[0].id, allowanceCents: ALLOWANCE_CENTS[participant.fit] });
    }
  }

  let inserted = 0;
  if (apply) {
    await sql`
      INSERT INTO gear_pick_cycles (id, title, deadline, created_at, updated_at)
      VALUES (${CYCLE.id}, ${CYCLE.title}, NULL, now(), now())
      ON CONFLICT (id) DO NOTHING
    `;
    for (const row of planned) {
      const result = await sql`
        INSERT INTO gear_pick_participants (id, cycle_id, user_id, fit, allowance_cents, created_at, updated_at)
        VALUES (gen_random_uuid()::text, ${CYCLE.id}, ${row.userId}, ${row.fit}::"GearPickFit", ${row.allowanceCents}, now(), now())
        ON CONFLICT (cycle_id, user_id) DO NOTHING
        RETURNING id
      `;
      inserted += result.length;
    }
  }

  console.log(apply ? `Applied gear pick roster for ${CYCLE.id}.` : `Dry run for ${CYCLE.id}. Pass --apply to write participants.`);
  console.log("\nParticipants:");
  for (const row of planned) {
    console.log(`- ${row.name} (${row.fit}, $${(row.allowanceCents / 100).toFixed(2)})`);
  }
  if (apply) console.log(`\n${inserted} new participant row(s); existing rows were left unchanged.`);
  console.log("\nSkipped:");
  for (const row of skipped) console.log(`- ${row.name}: ${row.reason}`);
  for (const name of OFF_SITE) console.log(`- ${name}: not a site user; handle off-site`);
}
