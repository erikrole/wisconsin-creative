#!/usr/bin/env node
// Synthetic records only. This refuses any populated application database.
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neon } from "@neondatabase/serverless";
import bcrypt from "bcryptjs";
import { readInfrastructureConfig, identitySql } from "./lib/migration-baseline.mjs";
import { resolvePrismaDirectUrl } from "./lib/prisma-direct-url.mjs";

const config = readInfrastructureConfig();
const { connectionString } = resolvePrismaDirectUrl();
const sql = neon(connectionString);
const [identity] = await sql.query(identitySql);
if (identity.branch !== config.preview.templateBranchId || identity.database !== config.preview.database) throw new Error("Only the configured empty template can be seeded.");
const counts = await sql.query(`SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relname <> '_prisma_migrations'`);
for (const { name } of counts) {
  const [row] = await sql.query(`SELECT EXISTS(SELECT 1 FROM public."${name.replaceAll('"', '""')}") AS populated`);
  if (row.populated) throw new Error(`Template is not empty: ${name}; seed refuses a reset.`);
}
const password = randomBytes(32).toString("base64url");
// Existing catalog seed contains only repository-authored venue/badge metadata.
const seed = spawnSync(process.execPath, ["prisma/seed.mjs"], { env: { ...process.env, DATABASE_URL: connectionString, SEED_ADMIN_PASSWORD: password }, encoding: "utf8" });
if (seed.status !== 0) throw new Error("Repository catalog seed failed; inspect the isolated template before retrying.");
const db = new PrismaClient({ adapter: new PrismaNeon({ connectionString }) });
try {
  const passwordHash = await bcrypt.hash(password, 10);
  const when = (days, hours = 15) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + days); d.setUTCHours(hours, 0, 0, 0); return d; };
  await db.$transaction(async (tx) => {
    const location = await tx.location.findFirstOrThrow({ where: { name: "Camp Randall Stadium" } });
    const admin = await tx.user.findUniqueOrThrow({ where: { email: "admin@creative.local" } });
    const affiliation = await tx.collaboratorAffiliation.create({ data: { key: "preview-partner", displayName: "Preview Broadcast Partner", badgeLabel: "DEMO" } });
    const policy = await tx.collaboratorPolicy.create({ data: { affiliationId: affiliation.id, status: "ACTIVE", grants: { create: [{ capabilityKey: "GEAR_CATALOG_VIEW" }] } } });
    const users = Array.from({ length: 32 }, (_, i) => ({ id: `preview-person-${i}`, name: `Preview ${i < 8 ? "Staff" : "Student"} ${i + 1}`, email: `person-${i}@preview.invalid`, passwordHash, role: i < 8 ? "STAFF" : "STUDENT", staffingType: i < 8 ? "FT" : "ST", primaryArea: i % 2 ? "PHOTO" : "VIDEO", locationId: location.id }));
    users.push({ id: "preview-collaborator", name: "Preview Partner", email: "partner@preview.invalid", passwordHash, role: "COLLABORATOR", staffingType: "FT", primaryArea: "VIDEO", locationId: location.id, collaboratorPolicyId: policy.id });
    await tx.user.createMany({ data: users });
    await tx.category.createMany({ data: [{ id: "preview-cameras", name: "Cameras" }, { id: "preview-support", name: "Support" }] });
    await tx.asset.createMany({ data: Array.from({ length: 160 }, (_, i) => ({ id: `preview-asset-${i}`, assetTag: `CAM ${i + 1}`, name: `${i % 2 ? "Sony FX6" : "Canon R5"} Preview ${i + 1}`, type: "Camera", brand: i % 2 ? "Sony" : "Canon", model: i % 2 ? "FX6" : "R5", qrCodeValue: `preview:asset:${i}`, locationId: location.id, categoryId: "preview-cameras" })) });
    await tx.bulkSku.create({ data: { id: "preview-battery", name: "Sony Battery", category: "Batteries", unit: "battery", locationId: location.id, categoryId: "preview-support", binQrCodeValue: "preview:battery", trackByNumber: true, balances: { create: { locationId: location.id, onHandQuantity: 20 } }, units: { create: Array.from({ length: 20 }, (_, i) => ({ unitNumber: i + 1 })) } } });
    for (const [i, gamedayRole] of ["SLOW1", "SLOW2", "BENCH", "ROAM1", "ROAM2", "ROAM3", "ROAM4"].entries()) {
      await tx.kit.create({ data: { name: `Preview Football ${gamedayRole}`, locationId: location.id, sportCode: "FB", gamedayRole, members: { create: { assetId: `preview-asset-${100 + i}` } }, bulkMembers: { create: { bulkSkuId: "preview-battery", quantity: 2 } } } });
    }
    await tx.calendarSource.create({ data: { id: "preview-calendar", name: "Synthetic calendar", url: "https://example.invalid/preview.ics", enabled: false } });
    for (const sportCode of ["FB", "VB"]) {
      await tx.sportConfig.create({ data: { sportCode, shiftConfigs: { create: [{ area: "VIDEO", homeStaffCount: 1, homeStudentCount: 2, homeCount: 3 }, { area: "PHOTO", homeStudentCount: 1 }] } } });
    }
    for (let i = 0; i < 30; i += 1) {
      const startsAt = when(i - 10), endsAt = when(i - 10, 19);
      const event = await tx.calendarEvent.create({ data: { id: `preview-event-${i}`, sourceId: "preview-calendar", externalId: `synthetic-${i}`, summary: `${i % 2 ? "Volleyball" : "Football"} vs Preview State ${i + 1}`, sportCode: i % 2 ? "VB" : "FB", locationId: location.id, startsAt, endsAt, rawStartsAt: startsAt, rawEndsAt: endsAt, rawAllDay: false, site: "HOME", isHome: true, opponent: `Preview State ${i + 1}` } });
      const group = await tx.shiftGroup.create({ data: { eventId: event.id, generatedAt: new Date() } });
      await tx.shift.create({ data: { shiftGroupId: group.id, area: "VIDEO", workerType: "ST", startsAt, endsAt, callStartsAt: startsAt, callEndsAt: endsAt, assignments: { create: { userId: `preview-person-${8 + i % 24}`, status: "DIRECT_ASSIGNED", assignedBy: admin.id } } } });
    }
    for (let i = 0; i < 20; i += 1) {
      const completed = i < 5; const open = i >= 5 && i < 10; const startsAt = when(completed ? -5 : open ? -1 : 3), endsAt = when(completed ? -4 : open ? 1 : 4);
      const booking = await tx.booking.create({ data: { title: `Preview ${completed ? "Completed" : open ? "Open" : "Reservation"} ${i + 1}`, kind: i < 10 ? "CHECKOUT" : "RESERVATION", status: completed ? "COMPLETED" : open ? "OPEN" : "BOOKED", custodyScope: i === 9 ? "SHARED" : "PERSON", requesterUserId: `preview-person-${i}`, createdBy: admin.id, locationId: location.id, startsAt, endsAt, completedAt: completed ? endsAt : null, serializedItems: { create: { assetId: `preview-asset-${i}`, allocationStatus: completed ? "returned" : "active" } } } });
      await tx.assetAllocation.create({ data: { bookingId: booking.id, assetId: `preview-asset-${i}`, startsAt, endsAt, active: !completed, kind: i < 10 ? "CHECKOUT" : "RESERVATION" } });
    }
  }, { timeout: 60_000, maxWait: 10_000 });
  console.log("Synthetic template seeded: 34 people, 160 assets, numbered batteries, seven kits, 30 events and 20 bookings. No production personal data or integration tokens.");
} finally { await db.$disconnect(); }
