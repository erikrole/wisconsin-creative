import { AREAS } from "@/types/areas";
import type { Area } from "@/types/areas";

export type ShiftConfig = {
  area: Area;
  homeCount: number;
  awayCount: number;
  homeStaffCount: number;
  homeStudentCount: number;
  awayStaffCount: number;
  awayStudentCount: number;
};

export type SportConfig = {
  id: string;
  sportCode: string;
  active: boolean;
  shiftStartOffset: number;
  shiftEndOffset: number;
  shiftConfigs: ShiftConfig[];
};

export type NonGameScheduleDefaults = {
  shiftStartOffset: number;
  shiftEndOffset: number;
  shiftConfigs: Array<{
    area: Area;
    staffCount: number;
    studentCount: number;
  }>;
};

export { AREAS, AREA_LABELS } from "@/types/areas";
export type { Area };

export function defaultShiftConfigs(): ShiftConfig[] {
  return AREAS.map((area) => ({
    area,
    homeCount: 0,
    awayCount: 0,
    homeStaffCount: 0,
    homeStudentCount: 0,
    awayStaffCount: 0,
    awayStudentCount: 0,
  }));
}

/** Big 6 sports that are NOT grouped by gender */
export type SportGroup = {
  label: string;
  codes: string[];
};

/**
 * Big 6 get their own card. Everything else is grouped by sport
 * (men's/women's share the same defaults).
 */
export const SPORT_GROUPS: SportGroup[] = [
  { label: "Football", codes: ["FB"] },
  { label: "Men's Basketball", codes: ["MBB"] },
  { label: "Women's Basketball", codes: ["WBB"] },
  { label: "Men's Hockey", codes: ["MHKY"] },
  { label: "Women's Hockey", codes: ["WHKY"] },
  { label: "Volleyball", codes: ["VB"] },
  { label: "Cross Country", codes: ["MXC", "WXC"] },
  { label: "Golf", codes: ["MGOLF", "WGOLF"] },
  { label: "Rowing", codes: ["MROW", "WROW", "LROW"] },
  { label: "Soccer", codes: ["MSOC", "WSOC"] },
  { label: "Softball", codes: ["SB"] },
  { label: "Swimming & Diving", codes: ["MSWIM", "WSWIM"] },
  { label: "Tennis", codes: ["MTEN", "WTEN"] },
  { label: "Track & Field", codes: ["MTRACK", "WTRACK"] },
  { label: "Wrestling", codes: ["WRES"] },
];
