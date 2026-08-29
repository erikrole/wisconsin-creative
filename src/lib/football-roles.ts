import { z } from "zod";
import { normalizeSportCode } from "@/lib/sports";

/**
 * Football game-day positions are intentionally a small, closed catalog.
 * They describe assignment metadata, not additional ShiftArea segments.
 */
export const FOOTBALL_GAME_DAY_ROLES = [
  "SLOW1",
  "SLOW2",
  "BENCH",
  "ROAM1",
  "ROAM2",
  "ROAM3",
  "ROAM4",
  "PHOTO1",
  "PHOTO2",
  "PHOTO3",
  "PHOTO4",
  "SOCIAL",
] as const;

export type FootballGameDayRole = (typeof FOOTBALL_GAME_DAY_ROLES)[number];

export const footballGameDayRoleSchema = z.enum(FOOTBALL_GAME_DAY_ROLES);

export const footballGameDayRolesSchema = z
  .array(footballGameDayRoleSchema)
  .max(FOOTBALL_GAME_DAY_ROLES.length)
  .superRefine((roles, ctx) => {
    if (new Set(roles).size !== roles.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Football game-day roles must be unique",
      });
    }
  });

/** Store and render selected roles in the catalog's stable order. */
export function canonicalFootballGameDayRoles(
  roles: readonly FootballGameDayRole[],
): FootballGameDayRole[] {
  const selected = new Set(roles);
  return FOOTBALL_GAME_DAY_ROLES.filter((role) => selected.has(role));
}

export function isFootballSportCode(sportCode: string | null | undefined): boolean {
  return sportCode !== null
    && sportCode !== undefined
    && normalizeSportCode(sportCode) === "FB";
}
