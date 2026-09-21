import { z } from "zod";

export const FOOTBALL_SPORT_CODE = "FB";

export const FOOTBALL_GAMEDAY_KIT_ROLES = [
  "SLOW1",
  "SLOW2",
  "BENCH",
  "ROAM1",
  "ROAM2",
  "ROAM3",
  "ROAM4",
] as const;

export type FootballGamedayKitRole = (typeof FOOTBALL_GAMEDAY_KIT_ROLES)[number];

const FOOTBALL_GAMEDAY_KIT_ROLE_LABELS: Record<FootballGamedayKitRole, string> = {
  SLOW1: "SLOW1",
  SLOW2: "SLOW2",
  BENCH: "BENCH",
  ROAM1: "ROAM1",
  ROAM2: "ROAM2",
  ROAM3: "ROAM3",
  ROAM4: "ROAM4",
};

export const FOOTBALL_GAMEDAY_KIT_ROLE_OPTIONS = FOOTBALL_GAMEDAY_KIT_ROLES.map((role) => ({
  value: role,
  label: FOOTBALL_GAMEDAY_KIT_ROLE_LABELS[role],
}));

const ROLE_SET = new Set<string>(FOOTBALL_GAMEDAY_KIT_ROLES);

function isFootballGamedayKitRole(value: string | null | undefined): value is FootballGamedayKitRole {
  return Boolean(value && ROLE_SET.has(value));
}

export function footballGamedayKitRoleLabel(role: string | null | undefined) {
  if (!isFootballGamedayKitRole(role)) return null;
  return FOOTBALL_GAMEDAY_KIT_ROLE_LABELS[role];
}

function footballGamedayKitRoleOrder(role: string | null | undefined) {
  if (!isFootballGamedayKitRole(role)) return FOOTBALL_GAMEDAY_KIT_ROLES.length;
  return FOOTBALL_GAMEDAY_KIT_ROLES.indexOf(role);
}

export function compareFootballGamedayKits(
  left: { gamedayRole?: string | null; name: string },
  right: { gamedayRole?: string | null; name: string },
) {
  const roleDelta = footballGamedayKitRoleOrder(left.gamedayRole) - footballGamedayKitRoleOrder(right.gamedayRole);
  if (roleDelta !== 0) return roleDelta;
  return left.name.localeCompare(right.name);
}

export function callingKitLabel(kit: { name: string; gamedayRole?: string | null; sportCode?: string | null; contents?: number }) {
  const job = footballGamedayKitRoleLabel(kit.gamedayRole);
  const title = job ?? kit.name;
  const extras: string[] = [];
  if (job && kit.name.trim().toLowerCase() !== job.toLowerCase()) extras.push(kit.name);
  if (kit.contents !== undefined) extras.push(kit.contents > 0 ? String(kit.contents) : "empty");
  return extras.length > 0 ? `${title} · ${extras.join(" · ")}` : title;
}

export const footballGamedayKitRoleSchema = z.enum(FOOTBALL_GAMEDAY_KIT_ROLES);

export const optionalFootballGamedayKitRoleSchema = z.preprocess((value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string" && value.trim() === "") return undefined;
  return value;
}, footballGamedayKitRoleSchema.optional());

export const nullableFootballGamedayKitRoleSchema = z.preprocess((value) => {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  return value;
}, footballGamedayKitRoleSchema.nullable());
