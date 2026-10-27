import { z } from "zod";
import { FOOTBALL_GAMEDAY_KIT_ROLES } from "@/lib/football-gameday-kits";

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
