import { sportLabel } from "@/lib/sports";

const SHARED_SPORT_FAMILIES = [
  { label: "Cross Country", codes: ["MXC", "WXC"] },
  { label: "Golf", codes: ["MGOLF", "WGOLF"] },
  { label: "Rowing", codes: ["MROW", "WROW", "LROW"] },
  { label: "Soccer", codes: ["MSOC", "WSOC"] },
  { label: "Swimming & Diving", codes: ["MSWIM", "WSWIM"] },
  { label: "Tennis", codes: ["MTEN", "WTEN"] },
  { label: "Track & Field", codes: ["MTRACK", "WTRACK"] },
] as const;

export function scheduleSportFamily(code: string | null | undefined) {
  if (!code) return null;
  const normalized = code.trim().toUpperCase();
  const shared = SHARED_SPORT_FAMILIES.find((family) => family.codes.some((candidate) => candidate === normalized));
  return shared?.label ?? sportLabel(normalized);
}

export function shareScheduleSportFamily(
  left: string | null | undefined,
  right: string | null | undefined,
) {
  const leftFamily = scheduleSportFamily(left);
  return Boolean(leftFamily && leftFamily === scheduleSportFamily(right));
}
