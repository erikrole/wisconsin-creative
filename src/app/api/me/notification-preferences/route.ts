import { z } from "zod";
import { withAuth } from "@/lib/api";
import { HttpError, ok } from "@/lib/http";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import {
  NOTIFICATION_CATEGORIES,
  PUSH_LEVELS,
  catalogForRole,
  type NotificationCategory,
  type PushLevel,
} from "@/lib/notification-catalog";
import {
  DEFAULT_NOTIFICATION_PREFS,
  loadUserPrefs,
  updateUserPrefs,
  type NotificationPrefs,
} from "@/lib/services/notification-prefs";
import { analyticsTag, recordServerProductEvents } from "@/lib/services/product-event-log";

/** Which categories or quiet-hours settings a save actually changed. */
function preferenceChanges(before: NotificationPrefs, after: NotificationPrefs) {
  const changes: Array<{ source: string; mode: string }> = [];
  for (const category of NOTIFICATION_CATEGORIES) {
    if (before.push[category] !== after.push[category]) {
      changes.push({ source: analyticsTag(category), mode: `${before.push[category]}_to_${after.push[category]}` });
    }
  }
  if (before.quietHours.enabled !== after.quietHours.enabled) {
    changes.push({ source: "quiet_hours", mode: after.quietHours.enabled ? "on" : "off" });
  }
  if (before.channels.push !== after.channels.push) {
    changes.push({ source: "push_channel", mode: after.channels.push ? "on" : "off" });
  }
  return changes;
}

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm");
const level = z.enum(PUSH_LEVELS as [PushLevel, ...PushLevel[]]);

// Boolean categories from clients that predate levels. Every known category is
// accepted so a shipped client's full-record save never fails.
const legacyCategories = z.object(
  Object.fromEntries(NOTIFICATION_CATEGORIES.map((c) => [c, z.boolean().optional()])) as Record<
    NotificationCategory,
    z.ZodOptional<z.ZodBoolean>
  >,
);

// Every field is optional and nothing defaults: an omitted field keeps its
// stored value. Older clients that send a full record without the newer
// categories therefore can't reset them.
const patchSchema = z.object({
  pausedUntil: z.string().datetime({ offset: true }).nullable().optional(),
  channels: z.object({
    email: z.boolean().optional(),
    push: z.boolean().optional(),
  }).optional(),
  badges: z.boolean().optional(),
  categories: legacyCategories.optional(),
  push: z.record(z.string(), level).optional(),
  quietHours: z.object({
    enabled: z.boolean().optional(),
    start: time.optional(),
    end: time.optional(),
    days: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    allowUrgent: z.boolean().optional(),
  }).optional(),
});

/**
 * GET /api/me/notification-preferences — the caller's prefs (or defaults) and
 * the categories their role can receive, in display order.
 */
export const GET = withAuth(async (_req, { user }) => {
  const prefs = await loadUserPrefs(user.id);
  return ok({ data: prefs, defaults: DEFAULT_NOTIFICATION_PREFS, catalog: catalogForRole(user.role) });
});

const update = withAuth(async (req, { user }) => {
  await enforceRateLimit(`notif-prefs:${user.id}`, SETTINGS_MUTATION_LIMIT);
  const body = patchSchema.parse(await req.json());

  if (body.push) {
    const allowed = new Set<string>(catalogForRole(user.role).map((entry) => entry.id));
    const unknown = Object.keys(body.push).filter((key) => !allowed.has(key));
    if (unknown.length > 0) {
      throw new HttpError(400, `Unknown notification category: ${unknown.join(", ")}`);
    }
  }

  const before = await loadUserPrefs(user.id);
  const data = await updateUserPrefs(user.id, {
    ...body,
    push: body.push as Partial<Record<NotificationCategory, PushLevel>> | undefined,
  });

  const platform = /WisconsinApp\//.test(req.headers.get("user-agent") ?? "") ? "ios" : "web";
  await recordServerProductEvents(preferenceChanges(before, data).map((change) => ({
    userId: user.id,
    eventName: "notification_pref_changed",
    platform,
    surface: "settings",
    properties: change,
  })));

  return ok({ data, catalog: catalogForRole(user.role) });
});

/** PATCH /api/me/notification-preferences — merges the supplied fields over the stored prefs. */
export const PATCH = update;

/**
 * PUT /api/me/notification-preferences — kept for shipped iOS builds, which
 * send the whole record. Same merge semantics as PATCH.
 */
export const PUT = update;
