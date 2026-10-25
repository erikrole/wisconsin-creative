import type { UserDetail } from "../types";

/** Birthday is stored as month and day only; the field reads and writes MM/DD. */
export function formatBirthdayInput(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 4);
  if (!digits) return "";
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

export function birthdayDisplay(user: Pick<UserDetail, "birthdayMonth" | "birthdayDay">): string {
  if (!user.birthdayMonth || !user.birthdayDay) return "";
  return `${String(user.birthdayMonth).padStart(2, "0")}/${String(user.birthdayDay).padStart(2, "0")}`;
}

export function parseBirthdayInput(value: string): { month: number; day: number } | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = /^(\d{1,2})\/(\d{1,2})$/.exec(formatBirthdayInput(trimmed));
  if (!match) throw new Error("Enter birthday as MM/DD");
  const month = Number(match[1]);
  const day = Number(match[2]);
  const daysInMonth = new Date(Date.UTC(2000, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth) {
    throw new Error("Enter a valid birthday");
  }
  return { month, day };
}


export type ApiEnvelope<T = unknown> = {
  data?: T;
  error?: string;
};

/** Fields a user can edit on their own profile (mirrors updateProfileSchema). */
const SELF_EDITABLE_FIELDS = new Set([
  "name", "locationId", "phone", "personalPhone", "workPhone", "slackHandle", "slackProfileUrl",
  "wiscardNumber", "wiscardCardNumber", "wiscardIssueCode",
  "title", "athleticsEmail", "startDate", "gradYear", "graduationTerm", "studentYearOverride",
  "topSizeFit", "topSize", "bottomSize", "shoeSizeSystem", "shoeSize",
  "birthdayMonth", "birthdayDay", "birthYear",
]);

/**
 * Where a profile edit goes. A person editing only their own self-service
 * fields uses /api/profile; anything else needs the staff users route and its
 * permission checks.
 */
export function userPatchUrl(userId: string, payload: Record<string, unknown>, isSelf: boolean): string {
  const isSelfProfileField = isSelf && Object.keys(payload).every((key) => SELF_EDITABLE_FIELDS.has(key));
  return isSelfProfileField ? "/api/profile" : `/api/users/${userId}`;
}

/** The patch cached user lists apply: a location change also carries its name. */
export function userListCachePatch(
  payload: Record<string, unknown>,
  locations: readonly { id: string; name: string }[],
): Record<string, unknown> {
  const cachePatch = { ...payload };
  if (Object.prototype.hasOwnProperty.call(payload, "locationId")) {
    const locationId = typeof payload.locationId === "string" ? payload.locationId : null;
    cachePatch.location = locations.find((location) => location.id === locationId)?.name ?? null;
  }
  return cachePatch;
}
