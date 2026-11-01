// Seed for the end-to-end flow tests. Runs against the disposable cluster
// scripts/test-e2e-flows.mjs owns and writes the ids the specs need to
// E2E_FLOWS_SEED_FILE. Standard pg driver, never Neon.
import { writeFileSync } from "node:fs";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const connectionString = process.env.DATABASE_URL ?? "";
if (!connectionString || connectionString.includes(".neon.tech")) throw new Error("Seed only runs against the disposable flow cluster.");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 4 }) });

export const PASSWORD = "E2eFlows!2026";
const passwordHash = await bcrypt.hash(PASSWORD, 10);
// Snoozing the profile prompt keeps the "Add your phone number" dialog out of
// flows that are not about onboarding (the setup wizard has its own browser test).
const person = (name, email, role, extra = {}) => ({ name, email, passwordHash, role, active: true, profilePromptSnoozedUntil: new Date("2099-01-01T00:00:00Z"), ...extra });

try {
  const location = await db.location.create({ data: { name: "Camp Randall Stadium", isHomeVenue: true } });
  const [admin, staff, student, teammate] = await Promise.all([
    db.user.create({ data: person("Erin Admin", "admin@e2e.test", "ADMIN", { staffingType: "FT", locationId: location.id }) }),
    db.user.create({ data: person("Sam Staff", "staff@e2e.test", "STAFF", { staffingType: "FT", locationId: location.id }) }),
    db.user.create({ data: person("Avery Student", "student@e2e.test", "STUDENT", { staffingType: "ST", primaryArea: "VIDEO", locationId: location.id, wiscardCardNumber: "0123456789", wiscardIssueCode: "1" }) }),
    db.user.create({ data: person("Blake Teammate", "teammate@e2e.test", "STUDENT", { staffingType: "ST", primaryArea: "VIDEO", locationId: location.id, wiscardCardNumber: "9876543210", wiscardIssueCode: "2" }) }),
  ]);

  const category = await db.category.create({ data: { name: "Cameras" } });
  const asset = (assetTag, name, extra = {}) => db.asset.create({
    data: { assetTag, name, type: "Camera", brand: "Sony", model: "FX6", qrCodeValue: `qr-e2e-${assetTag.toLowerCase()}`, locationId: location.id, categoryId: category.id, ...extra },
  });
  const [roam1, roam2, lens1, broken] = await Promise.all([
    asset("ROAM1", "Roaming camera 1"),
    asset("ROAM2", "Roaming camera 2"),
    asset("LENS1", "24-70 zoom"),
    asset("FIX1", "Camera in the shop", { status: "MAINTENANCE" }),
  ]);

  // Tomorrow evening in Madison: 23:00Z is 17:00 CST or 18:00 CDT.
  const gameStart = new Date(); gameStart.setUTCDate(gameStart.getUTCDate() + 1); gameStart.setUTCHours(23, 0, 0, 0);
  const gameEnd = new Date(gameStart.getTime() + 3 * 3600_000);
  const event = await db.calendarEvent.create({
    data: { externalId: "e2e-football-home", summary: "Football vs. Minnesota", startsAt: gameStart, endsAt: gameEnd, sportCode: "FB", opponent: "Minnesota", isHome: true, locationId: location.id },
  });
  const group = await db.shiftGroup.create({ data: { eventId: event.id, publishedAt: new Date(), publishedById: admin.id, publishedVersion: 1 } });
  // Two slots that do not overlap: the open pregame slot and the held game slot.
  // The teammate ends up holding both, so a shared window would make the trade
  // claim a time conflict instead of a hand-off.
  const shift = (notes, startsAt, endsAt) => db.shift.create({ data: { shiftGroupId: group.id, area: "VIDEO", workerType: "ST", startsAt, endsAt, notes } });
  const [openShift, heldShift] = await Promise.all([
    shift("Open camera slot", new Date(gameStart.getTime() - 4 * 3600_000), new Date(gameStart.getTime() - 3600_000)),
    shift("Held camera slot", new Date(gameStart.getTime() - 3600_000), gameEnd),
  ]);
  const heldAssignment = await db.shiftAssignment.create({ data: { shiftId: heldShift.id, userId: student.id, status: "APPROVED", assignedBy: admin.id, crewLabel: "SLOW1" } });

  writeFileSync(process.env.E2E_FLOWS_SEED_FILE, JSON.stringify({
    password: PASSWORD,
    location: { id: location.id, name: location.name },
    users: {
      admin: { id: admin.id, email: admin.email, name: admin.name },
      staff: { id: staff.id, email: staff.email, name: staff.name },
      student: { id: student.id, email: student.email, name: student.name, wiscard: "0123456789" },
      teammate: { id: teammate.id, email: teammate.email, name: teammate.name, wiscard: "9876543210" },
    },
    assets: { roam1: { id: roam1.id, tag: roam1.assetTag }, roam2: { id: roam2.id, tag: roam2.assetTag }, lens1: { id: lens1.id, tag: lens1.assetTag }, broken: { id: broken.id, tag: broken.assetTag } },
    event: { id: event.id, summary: event.summary, startsAt: gameStart.toISOString(), endsAt: gameEnd.toISOString() },
    shifts: { open: openShift.id, held: heldShift.id, heldAssignment: heldAssignment.id },
  }, null, 2));
  console.log("Flow seed complete.");
} finally {
  await db.$disconnect();
}
