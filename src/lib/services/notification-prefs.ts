import { db } from "@/lib/db";
import { env } from "@/lib/env";
import {
  NOTIFICATION_CATEGORIES,
  PUSH_LEVELS,
  catalogEntry,
  isNotificationCategory,
  type APNsInterruptionLevel,
  type NotificationCategory,
  type PushLevel,
} from "@/lib/notification-catalog";

export { NOTIFICATION_CATEGORIES, type NotificationCategory, type PushLevel };

/**
 * Per-user notification preferences. Stored as JSON on User.notificationPrefs;
 * a null record means "receive everything" (matches the original behavior so
 * users created before this feature don't need a backfill).
 *
 * `pausedUntil` is the canonical "do not disturb" — when set in the future,
 * non-in-app channels skip. In-app delivery (notifications inbox row) always
 * fires regardless of prefs so the user can catch up later.
 *
 * Version 2 stores a per-category push level instead of a boolean, plus
 * recurring quiet hours. Only levels the user chose are stored, so categories
 * they never touched follow the catalog default. Version 1 records (boolean
 * `categories`) are read transparently, and the normalized shape still carries
 * derived `categories` booleans for clients that predate levels.
 */

export type QuietHours = {
  enabled: boolean;
  /** Local "HH:mm" in the app timezone. */
  start: string;
  end: string;
  /** Days the quiet period starts on, 0 = Sunday. An overnight window belongs to its start day. */
  days: number[];
  /** Let urgent categories (overdue gear) alert normally during quiet hours. */
  allowUrgent: boolean;
};

export type NotificationPrefs = {
  version: 2;
  pausedUntil: string | null;
  channels: { email: boolean; push: boolean };
  badges: boolean;
  push: Record<NotificationCategory, PushLevel>;
  /** Derived: a category is enabled unless its level is `off`. */
  categories: Record<NotificationCategory, boolean>;
  quietHours: QuietHours;
};

/** What is actually persisted: sparse levels, no derived booleans. */
type StoredPrefs = {
  version: 2;
  pausedUntil: string | null;
  channels: { email: boolean; push: boolean };
  badges: boolean;
  push: Partial<Record<NotificationCategory, PushLevel>>;
  quietHours: QuietHours;
};

export const DEFAULT_QUIET_HOURS: QuietHours = {
  enabled: false,
  start: "22:00",
  end: "07:00",
  days: [0, 1, 2, 3, 4, 5, 6],
  allowUrgent: true,
};

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function isPushLevel(value: unknown): value is PushLevel {
  return typeof value === "string" && (PUSH_LEVELS as readonly string[]).includes(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function normalizeQuietHours(raw: unknown): QuietHours {
  const q = asRecord(raw);
  const days = Array.isArray(q.days)
    ? [...new Set(q.days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
    : DEFAULT_QUIET_HOURS.days;
  return {
    enabled: q.enabled === true,
    start: typeof q.start === "string" && TIME_PATTERN.test(q.start) ? q.start : DEFAULT_QUIET_HOURS.start,
    end: typeof q.end === "string" && TIME_PATTERN.test(q.end) ? q.end : DEFAULT_QUIET_HOURS.end,
    days,
    allowUrgent: q.allowUrgent === false ? false : true,
  };
}

/** Levels the stored record chose explicitly, reading v1 booleans as well. */
function explicitLevels(raw: Record<string, unknown>): Partial<Record<NotificationCategory, PushLevel>> {
  const levels: Partial<Record<NotificationCategory, PushLevel>> = {};
  // A v1 `true` carries no level (older clients saved every category), so
  // only an explicit `false` counts as a choice.
  const v1 = asRecord(raw.categories);
  for (const category of NOTIFICATION_CATEGORIES) {
    if (v1[category] === false) levels[category] = "off";
  }
  const v2 = asRecord(raw.push);
  for (const category of NOTIFICATION_CATEGORIES) {
    if (isPushLevel(v2[category])) levels[category] = v2[category];
  }
  return levels;
}

function resolveLevels(explicit: Partial<Record<NotificationCategory, PushLevel>>): Record<NotificationCategory, PushLevel> {
  const resolved = {} as Record<NotificationCategory, PushLevel>;
  for (const category of NOTIFICATION_CATEGORIES) {
    resolved[category] = explicit[category] ?? catalogEntry(category).defaultLevel;
  }
  // Categories split out of older ones inherit a mute until set explicitly:
  // the held-license nag used to share the expiry toggle, and admin review
  // pushes used to ride on the schedule and trade toggles.
  if (explicit.licenseHeld === undefined && resolved.licenseExpiry === "off") {
    resolved.licenseHeld = "off";
  }
  if (explicit.reviewQueue === undefined && (resolved.schedule === "off" || resolved.trade === "off")) {
    resolved.reviewQueue = "off";
  }
  return resolved;
}

function toStored(raw: unknown): StoredPrefs {
  const r = asRecord(raw);
  const channels = asRecord(r.channels);
  return {
    version: 2,
    pausedUntil: typeof r.pausedUntil === "string" ? r.pausedUntil : null,
    channels: {
      email: channels.email === false ? false : true,
      push: channels.push === false ? false : true,
    },
    badges: r.badges === false ? false : true,
    push: explicitLevels(r),
    quietHours: normalizeQuietHours(r.quietHours),
  };
}

function fromStored(stored: StoredPrefs): NotificationPrefs {
  const push = resolveLevels(stored.push);
  const categories = {} as Record<NotificationCategory, boolean>;
  for (const category of NOTIFICATION_CATEGORIES) categories[category] = push[category] !== "off";
  return {
    version: 2,
    pausedUntil: stored.pausedUntil,
    channels: stored.channels,
    badges: stored.badges,
    push,
    categories,
    quietHours: stored.quietHours,
  };
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = fromStored(toStored(null));

/** Defensive parse — old shapes or partial writes fall back to defaults. */
export function normalizePrefs(raw: unknown): NotificationPrefs {
  return fromStored(toStored(raw));
}

export type NotificationPrefsPatch = {
  pausedUntil?: string | null;
  channels?: Partial<NotificationPrefs["channels"]>;
  badges?: boolean;
  push?: Partial<Record<NotificationCategory, PushLevel>>;
  /** Boolean form from clients that predate levels. */
  categories?: Partial<Record<NotificationCategory, boolean>>;
  quietHours?: Partial<QuietHours>;
};

/**
 * Applies a partial update over the stored prefs and returns the record to
 * persist. Fields the caller omits keep their stored value, so an older client
 * that doesn't know a newer category can never silently reset it.
 */
export function mergePrefs(stored: unknown, patch: NotificationPrefsPatch): StoredPrefs {
  const current = toStored(stored);
  const resolved = resolveLevels(current.push);
  const push = { ...current.push };

  for (const [key, enabled] of Object.entries(patch.categories ?? {})) {
    if (!isNotificationCategory(key) || typeof enabled !== "boolean") continue;
    if (!enabled) push[key] = "off";
    // Turning a boolean back on restores the default; an enabled category
    // keeps whatever level it already has.
    else if (resolved[key] === "off") push[key] = catalogEntry(key).defaultLevel;
  }
  for (const [key, level] of Object.entries(patch.push ?? {})) {
    if (isNotificationCategory(key) && isPushLevel(level)) push[key] = level;
  }

  return {
    version: 2,
    pausedUntil: patch.pausedUntil !== undefined ? patch.pausedUntil : current.pausedUntil,
    channels: { ...current.channels, ...patch.channels },
    badges: patch.badges ?? current.badges,
    push,
    quietHours: normalizeQuietHours({ ...current.quietHours, ...patch.quietHours }),
  };
}

export function shouldDeliverCategory(prefs: NotificationPrefs, category: NotificationCategory): boolean {
  return prefs.push[category] !== "off";
}

export async function loadUserPrefs(userId: string): Promise<NotificationPrefs> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { notificationPrefs: true },
  });
  return normalizePrefs(user?.notificationPrefs);
}

/** Merges `patch` over the stored prefs and returns the normalized result. */
export async function updateUserPrefs(userId: string, patch: NotificationPrefsPatch): Promise<NotificationPrefs> {
  return db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { notificationPrefs: true },
    });
    const next = mergePrefs(user?.notificationPrefs, patch);
    await tx.user.update({
      where: { id: userId },
      data: { notificationPrefs: next as unknown as object },
    });
    return fromStored(next);
  });
}

function isPaused(prefs: NotificationPrefs, now = new Date()): boolean {
  if (!prefs.pausedUntil) return false;
  const until = new Date(prefs.pausedUntil);
  if (Number.isNaN(until.getTime())) return false;
  return until.getTime() > now.getTime();
}

export function shouldDeliverEmail(prefs: NotificationPrefs): boolean {
  if (isPaused(prefs)) return false;
  return prefs.channels.email;
}

export function shouldDeliverPush(prefs: NotificationPrefs): boolean {
  if (isPaused(prefs)) return false;
  return prefs.channels.push;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function localClock(now: Date, timeZone: string): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const hour = Number(get("hour")) % 24;
  return { day: WEEKDAYS.indexOf(get("weekday")), minutes: hour * 60 + Number(get("minute")) };
}

function toMinutes(time: string): number {
  const [h = 0, m = 0] = time.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Whether `now` falls in the user's quiet hours, evaluated in the app
 * timezone. A window whose end is at or before its start runs overnight and
 * belongs to the day it starts on; equal start and end cover the whole day.
 */
export function isInQuietHours(
  quietHours: QuietHours,
  now: Date = new Date(),
  timeZone: string = env.appTimezone,
): boolean {
  if (!quietHours.enabled || quietHours.days.length === 0) return false;
  const { day, minutes } = localClock(now, timeZone);
  const start = toMinutes(quietHours.start);
  const end = toMinutes(quietHours.end);
  const onDay = (d: number) => quietHours.days.includes((d + 7) % 7);

  if (start === end) return onDay(day);
  if (start < end) return onDay(day) && minutes >= start && minutes < end;
  return (onDay(day) && minutes >= start) || (onDay(day - 1) && minutes < end);
}

/**
 * Why a push was not sent, for the delivery ledger. Mirrors the checks in
 * `resolvePushPresentation`; null means it would be sent.
 */
export function pushSuppressionReason(
  prefs: NotificationPrefs,
  category: NotificationCategory | undefined,
  now: Date = new Date(),
): "paused" | "push_off" | "category_off" | "no_push_channel" | null {
  if (isPaused(prefs, now)) return "paused";
  if (!prefs.channels.push) return "push_off";
  if (category) {
    if (prefs.push[category] === "off") return "category_off";
    if (!catalogEntry(category).push) return "no_push_channel";
  }
  return null;
}

export type PushPresentation = {
  interruptionLevel: APNsInterruptionLevel;
  sound: boolean;
};

const SILENT: PushPresentation = { interruptionLevel: "passive", sound: false };

/**
 * Resolves whether a push goes out and how it is presented. Returns null when
 * pause, the push channel, or an `off` category suppresses it. Quiet hours
 * never drop a push; they deliver it silently, except urgent categories at
 * `standard` when the user lets urgent alerts through.
 */
export function resolvePushPresentation(
  prefs: NotificationPrefs,
  category: NotificationCategory | undefined,
  now: Date = new Date(),
): PushPresentation | null {
  if (!shouldDeliverPush(prefs)) return null;

  let presentation: PushPresentation = { interruptionLevel: "passive", sound: true };
  let urgent = false;
  if (category) {
    const entry = catalogEntry(category);
    const level = prefs.push[category];
    if (level === "off" || !entry.push) return null;
    presentation = level === "silent"
      ? SILENT
      : { interruptionLevel: entry.standardInterruption, sound: true };
    urgent = entry.urgent && level === "standard";
  }

  if (isInQuietHours(prefs.quietHours, now) && !(urgent && prefs.quietHours.allowUrgent)) {
    return SILENT;
  }
  return presentation;
}
