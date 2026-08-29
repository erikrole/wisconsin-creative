import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FOOTBALL_GAME_DAY_ROLES,
  canonicalFootballGameDayRoles,
  footballGameDayRolesSchema,
  isFootballSportCode,
} from "@/lib/football-roles";
import {
  applyWorkingScheduleCommand,
  workingSchedulePayloadSchema,
} from "@/lib/schedule-working-copy";

const eventStartsAt = "2026-10-06T18:00:00.000Z";
const eventEndsAt = "2026-10-06T21:00:00.000Z";

function payload(footballRoles?: string[]) {
  return {
    eventStartsAt,
    eventEndsAt,
    slots: [{
      key: "shift-1",
      sourceShiftId: "shift-1",
      area: "VIDEO",
      workerType: "ST",
      startsAt: eventStartsAt,
      endsAt: eventEndsAt,
      callStartsAt: null,
      callEndsAt: null,
      notes: null,
      assignmentHistoryCount: 1,
      assignment: {
        sourceAssignmentId: "assignment-1",
        userId: "student-1",
        status: "DIRECT_ASSIGNED",
        callStartsAt: null,
        callEndsAt: null,
        callNote: null,
        activeTradeId: null,
        bookingCount: 0,
        ...(footballRoles ? { footballRoles } : {}),
      },
    }],
  };
}

describe("Football game-day role contract", () => {
  it("keeps the first-release catalog exact and stable", () => {
    expect(FOOTBALL_GAME_DAY_ROLES).toEqual([
      "SLOW1", "SLOW2", "BENCH", "ROAM1", "ROAM2", "ROAM3", "ROAM4",
      "PHOTO1", "PHOTO2", "PHOTO3", "PHOTO4", "SOCIAL",
    ]);
    expect(footballGameDayRolesSchema.safeParse(["SLOW3"]).success).toBe(false);
    expect(footballGameDayRolesSchema.safeParse(["SLOW1", "SLOW1"]).success).toBe(false);
  });

  it("recognizes only normalized Football sport codes", () => {
    expect(isFootballSportCode("FB")).toBe(true);
    expect(isFootballSportCode("fb")).toBe(true);
    expect(isFootballSportCode("VB")).toBe(false);
    expect(isFootballSportCode(null)).toBe(false);
  });

  it("accepts legacy assignments without role metadata", () => {
    const parsed = workingSchedulePayloadSchema.parse(payload());
    expect(parsed.slots[0]?.assignment?.footballRoles).toBeUndefined();
  });

  it("stores multiple selected roles in canonical catalog order", () => {
    const before = workingSchedulePayloadSchema.parse(payload([]));
    const after = applyWorkingScheduleCommand(
      before,
      { type: "setFootballRoles", slotKey: "shift-1", roles: ["SOCIAL", "SLOW1", "ROAM2"] },
      () => "unused",
    );

    expect(after.slots[0]?.assignment?.footballRoles).toEqual(["SLOW1", "ROAM2", "SOCIAL"]);
    expect(canonicalFootballGameDayRoles(["PHOTO4", "PHOTO1"])).toEqual(["PHOTO1", "PHOTO4"]);
  });

  it("persists a non-null empty-array default in the forward migration", () => {
    const sql = readFileSync("prisma/migrations/0139_football_game_day_roles/migration.sql", "utf8");
    expect(sql).toContain("CREATE TYPE \"FootballGameDayRole\" AS ENUM");
    expect(sql).toContain(
      "ADD COLUMN \"football_roles\" \"FootballGameDayRole\"[] NOT NULL DEFAULT ARRAY[]::\"FootballGameDayRole\"[]",
    );
  });

  it("keeps role mutation behind the working-copy permission and publication boundaries", () => {
    const route = readFileSync("src/app/api/shift-groups/[id]/working-copy/route.ts", "utf8");
    const workingService = readFileSync("src/lib/services/schedule-working-copy.ts", "utf8");
    const publicationService = readFileSync("src/lib/services/schedule-publication.ts", "utf8");

    expect(route).toContain('requirePermission(user.role, "shift_assignment", "manage_roles")');
    expect(route).toContain("await enforceRateLimit(`shift:working-copy:${user.id}`");
    expect(workingService).toContain("Only Admins can edit Football game-day roles.");
    expect(workingService).toContain("isolationLevel: Prisma.TransactionIsolationLevel.Serializable");
    expect(workingService).toContain("footballRoleChange");
    expect(publicationService).toContain("Football game-day roles can only be used on Football events.");
    expect(publicationService).toContain("footballRoles: workingFootballRoles");
    expect(publicationService).toContain("footballRoles: canonicalFootballGameDayRoles");
  });

  it("renders quiet assignment metadata without exposing controls to other sports", () => {
    const editor = readFileSync("src/app/(app)/schedule/_components/WorkingCrewEditor.tsx", "utf8");
    const shiftCard = readFileSync("src/components/shift-detail/ShiftSlotCard.tsx", "utf8");

    expect(editor).toContain("canEditFootballRoles");
    expect(editor).toContain("Add role");
    expect(editor).toContain("Metadata on this shift; it does not create a coverage segment.");
    expect(editor).toContain('className="pl-8 text-[11px] text-muted-foreground"');
    expect(shiftCard).toContain("isFootballSportCode(sportCode)");
    expect(shiftCard).toContain('footballRoles!.join(" · ")');
  });
});
