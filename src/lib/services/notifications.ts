import { after } from "next/server";
import { db } from "@/lib/db";
import { sendEmail, buildNotificationEmail } from "@/lib/email";
import { sendPush } from "@/lib/push/apns";
import { sendWebPushToUsers } from "@/lib/push/web";
import { ACTIVE_ASSIGNMENT_STATUSES } from "@/lib/shift-constants";
import { loadUserPrefs, normalizePrefs, shouldDeliverEmail, shouldDeliverPush, shouldDeliverCategory, type NotificationCategory } from "@/lib/services/notification-prefs";
import { loadCheckoutPolicies } from "@/lib/services/checkout-policies";
import { shiftWorkerLabel } from "@/lib/shift-display";
import { formatAppDateTime } from "@/lib/app-time";
import { primaryChange, type ScheduleWorkerChange } from "@/lib/services/schedule-notification-diff";
import { scheduleChangeCopy } from "@/lib/services/schedule-notification-copy";
import {
  categoryForScheduleNotificationType,
  scheduleNotificationPayload,
  scheduleMyShiftsNotificationPayload,
  shouldNotifyGearPrep,
  shouldNotifyWorkerForScheduleEvent,
  type GearPrepNotificationSource,
} from "@/lib/services/schedule-notification-policy";
import { visibleActiveUserWhere } from "@/lib/user-visibility";
import {
  checkoutEscalationCategory,
  checkoutEscalationChannels,
  checkoutEscalationDedupeKey,
  checkoutEscalationDueVersion,
  checkoutEscalationTriggerAt,
  highestEligibleCheckoutEscalationRule,
  isCheckoutEscalationStageType,
  isResponderEscalationStage,
  normalizeCheckoutEscalationConfig,
  overdueResponderConfigKey,
  type CheckoutEscalationConfig,
  type CheckoutEscalationRecipientKind,
  type CheckoutEscalationStageType,
} from "@/lib/checkout-escalation-policy";

/**
 * Defers a push send past the response without letting the serverless
 * function freeze mid-send. A bare `void promise` races the APNs round-trip
 * against Vercel suspending the lambda once the response is written — pushes
 * were silently dropped whenever APNs lost that race. `after()` keeps the
 * function alive until the promise settles.
 */
export function deferPush(task: Promise<void>): void {
  try {
    after(task);
  } catch {
    // Outside a request scope (tests, scripts) — detach; the task never rejects.
    void task;
  }
}

/**
 * Preference category -> the native client's registered action set.
 *
 * These are grouped by what the reader can usefully *do*, not by what the
 * notification is about: everything gear-custody-shaped offers the same two
 * actions, everything schedule-shaped offers one. `licenseExpiry` is absent on
 * purpose — there is no action a phone can take on an expiring license, and a
 * menu with only "View" in it is worse than a plain tap.
 */
const APNS_ACTION_CATEGORY: Partial<Record<NotificationCategory, string>> = {
  checkoutDue: "GT_BOOKING",
  checkoutOverdue: "GT_BOOKING",
  reservation: "GT_BOOKING",
  gearPrep: "GT_BOOKING",
  schedule: "GT_SCHEDULE",
  trade: "GT_SCHEDULE",
};

export async function sendPushToUser(
  userId: string,
  opts: { title: string; body?: string | null; payload?: Record<string, unknown>; category?: NotificationCategory }
): Promise<void> {
  // Never throws: callers fire-and-forget with `void`, and an unhandled
  // rejection is fatal in modern Node — push is best-effort by design.
  try {
    const prefs = await loadUserPrefs(userId);
    if (!shouldDeliverPush(prefs)) return;
    if (opts.category && !shouldDeliverCategory(prefs, opts.category)) return;

    // Keep native APNs tokens and browser subscriptions on their own delivery
    // paths. The web sender is best-effort and has its own failure boundary, so
    // missing VAPID configuration never suppresses iOS delivery.
    const [tokens] = await Promise.all([
      db.deviceToken.findMany({
        where: {
          userId,
          platform: "IOS",
          revokedAt: null,
          user: { active: true },
        },
        select: { token: true },
      }),
      sendWebPushToUsers([userId], opts),
    ]);
    if (tokens.length === 0) return;

    const { revoked } = await sendPush(
      tokens.map((t) => t.token),
      {
        title: opts.title,
        body: opts.body ?? "",
        payload: opts.payload,
        category: opts.category ? APNS_ACTION_CATEGORY[opts.category] : undefined,
      }
    );

    if (revoked.length > 0) {
      await db.deviceToken.updateMany({
        where: { token: { in: revoked } },
        data: { revokedAt: new Date() },
      });
    }
  } catch (err) {
    console.error(`[NOTIFY] Push to user ${userId} failed:`, err);
  }
}

/**
 * Email wrapper that consults the user's notification prefs.
 * Pass null `userId` for system emails that should always send (e.g. password reset).
 */
async function sendEmailToUser(
  userId: string | null,
  args: Parameters<typeof sendEmail>[0],
  category?: NotificationCategory
): Promise<boolean> {
  if (userId) {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { active: true, notificationPrefs: true },
    });
    if (!user?.active) return false;
    const prefs = normalizePrefs(user.notificationPrefs);
    if (!shouldDeliverEmail(prefs)) return false;
    if (category && !shouldDeliverCategory(prefs, category)) return false;
  }
  return sendEmail(args);
}

/**
 * Fallback escalation schedule used when no DB rules exist.
 */
const DEFAULT_SCHEDULE = [
  { hoursFromDue: -2, type: "checkout_due_2h", title: "Due back in 2 hours", notifyRequester: true, notifyAdmins: false, enabled: true, sortOrder: 0 },
  { hoursFromDue: 0, type: "checkout_due_now", title: "Due back now", notifyRequester: true, notifyAdmins: false, enabled: true, sortOrder: 1 },
  { hoursFromDue: 0, type: "checkout_overdue_grace", title: "Checkout overdue", notifyRequester: true, notifyAdmins: false, enabled: true, sortOrder: 2 },
  { hoursFromDue: 4, type: "checkout_overdue_4h", title: "4 hours overdue", notifyRequester: true, notifyAdmins: false, enabled: true, sortOrder: 3 },
  { hoursFromDue: 24, type: "checkout_overdue_24h", title: "1 day overdue", notifyRequester: true, notifyAdmins: true, enabled: true, sortOrder: 4 },
];

async function getEscalationRules() {
  const rules = await db.escalationRule.findMany({
    where: { enabled: true },
    orderBy: { sortOrder: "asc" },
  });
  return rules.length > 0 ? rules : DEFAULT_SCHEDULE;
}

async function getCheckoutEscalationConfig(): Promise<CheckoutEscalationConfig> {
  const config = await db.systemConfig.findUnique({ where: { key: "escalation" } });
  return normalizeCheckoutEscalationConfig(config?.value);
}

type EscalationRule = Awaited<ReturnType<typeof getEscalationRules>>[number];
type OperationsUser = {
  id: string;
  name: string;
  email: string | null;
  role: string;
};
type EscalationCheckout = {
  id: string;
  kind: string;
  status: string;
  title: string;
  requesterUserId: string;
  locationId: string;
  createdBy: string;
  endsAt: Date;
  requester: { id: string; name: string; email: string | null };
};
type ExistingEscalationNotification = { dedupeKey: string | null; payload: unknown };

function responderUserIds(raw: unknown): string[] {
  if (!raw || typeof raw !== "object") return [];
  const ids = (raw as { userIds?: unknown }).userIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

function isUniqueConflict(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}

function requesterEscalationBody(args: {
  type: string;
  checkoutTitle: string;
  dueAt: Date;
  gracePeriodHours: number;
  now: Date;
}): string {
  if (args.type === "checkout_due_2h") {
    return `"${args.checkoutTitle}" is due ${formatRelative(args.dueAt, args.now)}. Plan your return.`;
  }
  if (args.type === "checkout_due_now") {
    const graceMinutes = Math.round(args.gracePeriodHours * 60);
    return graceMinutes > 0
      ? `"${args.checkoutTitle}" is due now. The ${graceMinutes}-minute return grace period has started.`
      : `"${args.checkoutTitle}" is due now. Please return the gear.`;
  }
  if (args.type === "checkout_overdue_grace") {
    return `"${args.checkoutTitle}" is now overdue. Please return the gear.`;
  }
  return `"${args.checkoutTitle}" was due ${formatRelative(args.dueAt, args.now)}. Please return the gear.`;
}

function operationalEscalationBody(checkout: EscalationCheckout, rule: EscalationRule): string {
  const timing = rule.type === "checkout_overdue_24h" ? "1 day" : "4 hours";
  return `${checkout.requester.name}'s checkout "${checkout.title}" is ${timing} overdue.`;
}

function existingCounts(
  existing: ExistingEscalationNotification[],
  dueVersion: string,
): { requester: number; operational: number } {
  let requester = 0;
  let operational = 0;
  for (const row of existing) {
    const payload = row.payload && typeof row.payload === "object"
      ? row.payload as Record<string, unknown>
      : null;
    if (payload?.dueVersion !== dueVersion) continue;
    if (payload.recipientKind === "requester") requester += 1;
    if (payload.recipientKind === "responder" || payload.recipientKind === "admin") operational += 1;
  }
  return { requester, operational };
}

async function persistCheckoutEscalation(args: {
  checkout: EscalationCheckout;
  rule: EscalationRule;
  recipient: OperationsUser | EscalationCheckout["requester"];
  recipientKind: CheckoutEscalationRecipientKind;
  title: string;
  body: string;
  now: Date;
  existingKeys: Set<string>;
}): Promise<boolean> {
  const dueVersion = checkoutEscalationDueVersion(args.checkout.endsAt);
  const dedupeKey = checkoutEscalationDedupeKey({
    bookingId: args.checkout.id,
    dueAt: args.checkout.endsAt,
    type: args.rule.type,
    recipientKind: args.recipientKind,
    recipientId: args.recipient.id,
  });
  if (args.existingKeys.has(dedupeKey)) return false;

  try {
    await db.notification.create({
      data: {
        userId: args.recipient.id,
        type: args.rule.type,
        title: args.title,
        body: args.body,
        payload: {
          bookingId: args.checkout.id,
          bookingTitle: args.checkout.title,
          requesterName: args.checkout.requester.name,
          dueAt: args.checkout.endsAt.toISOString(),
          dueVersion,
          recipientKind: args.recipientKind,
        },
        channel: "IN_APP",
        sentAt: args.now,
        dedupeKey,
      },
    });
    args.existingKeys.add(dedupeKey);
  } catch (error) {
    if (isUniqueConflict(error)) return false;
    throw error;
  }

  const category = checkoutEscalationCategory(args.rule.type);
  const channels = checkoutEscalationChannels(args.rule.type, args.recipientKind);
  if (channels.push) {
    deferPush(sendPushToUser(args.recipient.id, {
      title: args.title,
      body: args.body,
      payload: { bookingId: args.checkout.id },
      category,
    }));
  }
  if (channels.email && args.recipient.email) {
    await sendEmailToUser(args.recipient.id, {
      to: args.recipient.email,
      subject: args.title,
      html: buildNotificationEmail({
        title: args.title,
        body: args.body,
        bookingTitle: args.checkout.title,
        dueAt: args.checkout.endsAt.toISOString(),
      }),
    }, category);
  }
  return true;
}

async function deliverCheckoutEscalation(args: {
  checkout: EscalationCheckout;
  rule: EscalationRule;
  gracePeriodHours: number;
  config: CheckoutEscalationConfig;
  operationsUsers: OperationsUser[];
  configuredResponderIds: string[];
  existing: ExistingEscalationNotification[];
  now: Date;
}): Promise<number> {
  const existingKeys = new Set(args.existing.map((row) => row.dedupeKey).filter((key): key is string => Boolean(key)));
  const dueVersion = checkoutEscalationDueVersion(args.checkout.endsAt);
  const counts = existingCounts(args.existing, dueVersion);
  let created = 0;

  if (args.rule.notifyRequester && counts.requester < args.config.maxRequesterNotificationsPerDueDate) {
    const body = requesterEscalationBody({
      type: args.rule.type,
      checkoutTitle: args.checkout.title,
      dueAt: args.checkout.endsAt,
      gracePeriodHours: args.gracePeriodHours,
      now: args.now,
    });
    if (await persistCheckoutEscalation({
      checkout: args.checkout,
      rule: args.rule,
      recipient: args.checkout.requester,
      recipientKind: "requester",
      title: args.rule.title,
      body,
      now: args.now,
      existingKeys,
    })) created += 1;
  }

  if (!isResponderEscalationStage(args.rule.type)) return created;

  const operationsById = new Map(args.operationsUsers.map((person) => [person.id, person]));
  const admins = args.operationsUsers.filter((person) => person.role === "ADMIN");
  let responders = args.configuredResponderIds
    .map((id) => operationsById.get(id))
    .filter((person): person is OperationsUser => Boolean(person))
    .filter((person) => person.id !== args.checkout.requesterUserId);

  if (responders.length === 0) {
    const creator = operationsById.get(args.checkout.createdBy);
    responders = creator && creator.id !== args.checkout.requesterUserId ? [creator] : [];
  }
  if (responders.length === 0) {
    responders = admins.filter((admin) => admin.id !== args.checkout.requesterUserId);
  }

  const operationalRecipients = new Map<string, { user: OperationsUser; kind: CheckoutEscalationRecipientKind }>();
  for (const responder of responders) operationalRecipients.set(responder.id, { user: responder, kind: "responder" });
  if (args.rule.notifyAdmins) {
    for (const admin of admins) {
      if (admin.id === args.checkout.requesterUserId || operationalRecipients.has(admin.id)) continue;
      operationalRecipients.set(admin.id, { user: admin, kind: "admin" });
    }
  }

  let operationalCount = counts.operational;
  for (const { user, kind } of operationalRecipients.values()) {
    if (operationalCount >= args.config.maxOperationalNotificationsPerDueDate) break;
    const title = `Overdue: ${args.checkout.title}`;
    const body = operationalEscalationBody(args.checkout, args.rule);
    if (await persistCheckoutEscalation({
      checkout: args.checkout,
      rule: args.rule,
      recipient: user,
      recipientKind: kind,
      title,
      body,
      now: args.now,
      existingKeys,
    })) {
      operationalCount += 1;
      created += 1;
    }
  }

  return created;
}

async function loadOperationsUsers(): Promise<OperationsUser[]> {
  return db.user.findMany({
    where: visibleActiveUserWhere({ role: { in: ["ADMIN", "STAFF"] } }),
    select: { id: true, name: true, email: true, role: true },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });
}

export async function getCheckoutEscalationStageTiming(args: {
  bookingId: string;
  expectedEndsAt: Date;
  stageType: CheckoutEscalationStageType;
}) {
  const [booking, rules, policies] = await Promise.all([
    db.booking.findUnique({
      where: { id: args.bookingId },
      select: { kind: true, status: true, endsAt: true },
    }),
    getEscalationRules(),
    loadCheckoutPolicies(),
  ]);
  if (!booking || booking.kind !== "CHECKOUT" || booking.status !== "OPEN") {
    return { status: "closed" as const };
  }
  if (booking.endsAt.getTime() !== args.expectedEndsAt.getTime()) {
    return { status: "superseded" as const };
  }
  const rule = rules.find((candidate) => candidate.enabled && candidate.type === args.stageType);
  if (!rule) return { status: "disabled" as const };
  return {
    status: "scheduled" as const,
    triggerAt: checkoutEscalationTriggerAt(rule, booking.endsAt, policies.gracePeriodHours).toISOString(),
  };
}

export async function processCheckoutEscalationStage(args: {
  bookingId: string;
  expectedEndsAt: Date;
  stageType: CheckoutEscalationStageType;
  now?: Date;
}) {
  const now = args.now ?? new Date();
  const [checkout, rules, policies, config, operationsUsers] = await Promise.all([
    db.booking.findUnique({
      where: { id: args.bookingId },
      select: {
        id: true,
        kind: true,
        status: true,
        title: true,
        requesterUserId: true,
        locationId: true,
        createdBy: true,
        endsAt: true,
        requester: { select: { id: true, name: true, email: true } },
      },
    }),
    getEscalationRules(),
    loadCheckoutPolicies(),
    getCheckoutEscalationConfig(),
    loadOperationsUsers(),
  ]);
  if (!checkout || checkout.kind !== "CHECKOUT" || checkout.status !== "OPEN") {
    return { status: "closed" as const, notificationsCreated: 0 };
  }
  if (checkout.endsAt.getTime() !== args.expectedEndsAt.getTime()) {
    return { status: "superseded" as const, notificationsCreated: 0 };
  }
  const rule = rules.find((candidate) => candidate.enabled && candidate.type === args.stageType);
  if (!rule) return { status: "disabled" as const, notificationsCreated: 0 };
  const triggerAt = checkoutEscalationTriggerAt(rule, checkout.endsAt, policies.gracePeriodHours);
  if (triggerAt > now) {
    return { status: "not_eligible" as const, triggerAt: triggerAt.toISOString(), notificationsCreated: 0 };
  }
  const highest = highestEligibleCheckoutEscalationRule(rules, checkout.endsAt, policies.gracePeriodHours, now);
  if (highest?.type !== args.stageType) {
    return { status: "collapsed" as const, collapsedInto: highest?.type ?? null, notificationsCreated: 0 };
  }

  const [existing, locationResponderConfig] = await Promise.all([
    db.notification.findMany({
      where: { dedupeKey: { startsWith: `${checkout.id}:` } },
      select: { dedupeKey: true, payload: true },
    }),
    db.systemConfig.findUnique({ where: { key: overdueResponderConfigKey(checkout.locationId) } }),
  ]);
  const notificationsCreated = await deliverCheckoutEscalation({
    checkout,
    rule,
    gracePeriodHours: policies.gracePeriodHours,
    config,
    operationsUsers,
    configuredResponderIds: responderUserIds(locationResponderConfig?.value),
    existing,
    now,
  });
  return { status: notificationsCreated > 0 ? "sent" as const : "deduped" as const, notificationsCreated };
}

/** Daily repair sweep. Durable per-checkout workflows own normal delivery. */
export async function processOverdueNotifications(): Promise<{ scanned: number; notificationsCreated: number }> {
  const now = new Date();
  const [openCheckouts, rules, policies, config, operationsUsers, responderConfigs] = await Promise.all([
    db.booking.findMany({
      where: { kind: "CHECKOUT", status: "OPEN" },
      select: {
        id: true,
        kind: true,
        status: true,
        title: true,
        requesterUserId: true,
        locationId: true,
        createdBy: true,
        endsAt: true,
        requester: { select: { id: true, name: true, email: true } },
      },
      take: 500,
      orderBy: { endsAt: "asc" },
    }),
    getEscalationRules(),
    loadCheckoutPolicies(),
    getCheckoutEscalationConfig(),
    loadOperationsUsers(),
    db.systemConfig.findMany({
      where: { key: { startsWith: "overdue_responders:" } },
      select: { key: true, value: true },
    }),
  ]);
  if (openCheckouts.length === 0) return { scanned: 0, notificationsCreated: 0 };

  const bookingIds = openCheckouts.map((checkout) => checkout.id);
  const existingRows = await db.notification.findMany({
    where: { OR: bookingIds.map((id) => ({ dedupeKey: { startsWith: `${id}:` } })) },
    select: { dedupeKey: true, payload: true },
  });
  const existingByBooking = new Map<string, ExistingEscalationNotification[]>();
  for (const row of existingRows) {
    const bookingId = row.payload && typeof row.payload === "object"
      ? (row.payload as Record<string, unknown>).bookingId
      : null;
    if (typeof bookingId !== "string") continue;
    const rows = existingByBooking.get(bookingId) ?? [];
    rows.push(row);
    existingByBooking.set(bookingId, rows);
  }
  const respondersByLocation = new Map(
    responderConfigs.map((row) => [row.key.slice("overdue_responders:".length), responderUserIds(row.value)]),
  );

  let notificationsCreated = 0;
  for (const checkout of openCheckouts) {
    const rule = highestEligibleCheckoutEscalationRule(rules, checkout.endsAt, policies.gracePeriodHours, now);
    if (!rule || !isCheckoutEscalationStageType(rule.type)) continue;
    notificationsCreated += await deliverCheckoutEscalation({
      checkout,
      rule,
      gracePeriodHours: policies.gracePeriodHours,
      config,
      operationsUsers,
      configuredResponderIds: respondersByLocation.get(checkout.locationId) ?? [],
      existing: existingByBooking.get(checkout.id) ?? [],
      now,
    });
  }
  return { scanned: openCheckouts.length, notificationsCreated };
}

/**
 * Creates a "Gear Up" notification for a student when they are assigned/approved for a shift.
 * Skips if a notification for this assignment already exists (deduped).
 */
export async function createShiftGearUpNotification(
  assignmentId: string,
  opts: { source?: GearPrepNotificationSource } = {},
): Promise<void> {
  const assignment = await db.shiftAssignment.findUnique({
    where: { id: assignmentId },
    include: {
      user: { select: { id: true, email: true, active: true } },
      shift: {
        include: {
          shiftGroup: {
            include: {
              event: {
                select: {
                  id: true,
                  summary: true,
                  startsAt: true,
                  sportCode: true,
                  opponent: true,
                  isHome: true,
                  locationId: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!assignment?.user.active) return;

  const event = assignment.shift.shiftGroup.event;
  const source = opts.source ?? "manual_nudge";
  if (!shouldNotifyGearPrep({ source, publishedAt: assignment.shift.shiftGroup.publishedAt })) return;

  const dedupeKey = `shift:${assignmentId}:gear_up`;

  const existing = await db.notification.findUnique({ where: { dedupeKey } });
  if (existing) return;

  const eventTitle = event.opponent
    ? `${event.isHome === false ? "at" : "vs"} ${event.opponent}`
    : event.summary;

  const shiftTime = formatAppDateTime(assignment.shift.startsAt);

  const title = "Gear up for your shift";
  const body = `You're assigned to ${assignment.shift.area} for ${eventTitle} at ${shiftTime}. Reserve your gear now.`;
  const pushPayload = scheduleNotificationPayload({
    assignmentId: assignment.id,
    shiftId: assignment.shiftId,
    eventId: event.id,
  });

  try {
    await db.notification.create({
      data: {
        userId: assignment.userId,
        type: "shift_gear_up",
        title,
        body,
        payload: {
          ...pushPayload,
          eventSummary: event.summary,
          area: assignment.shift.area,
          startsAt: assignment.shift.startsAt.toISOString(),
          sportCode: event.sportCode,
          locationId: event.locationId,
        },
        channel: "IN_APP",
        sentAt: new Date(),
        dedupeKey,
      },
    });

    deferPush(sendPushToUser(assignment.userId, {
      title,
      body,
      payload: pushPayload,
      category: categoryForScheduleNotificationType("shift_gear_up") ?? undefined,
    }));

    // Also send email notification
    if (assignment.user.email) {
      await sendEmailToUser(assignment.userId, {
        to: assignment.user.email,
        subject: title,
        html: buildNotificationEmail({
          title,
          body,
          bookingTitle: event.summary,
          dueAt: assignment.shift.startsAt.toISOString(),
        }),
      }, categoryForScheduleNotificationType("shift_gear_up") ?? undefined);
    }
  } catch (err) {
    console.error(`[NOTIFY] Failed to create shift gear-up notification for assignment ${assignmentId}:`, err);
  }
}

type ShiftScheduleEvent =
  | "assigned"
  | "requested"
  | "approved"
  | "declined"
  | "removed"
  | "shift_time_changed"
  | "personal_call_time_changed";

function formatShiftNotifyTime(dt: Date): string {
  return formatAppDateTime(dt);
}

function shiftScheduleNotificationCopy(args: {
  event: ShiftScheduleEvent;
  eventTitle: string;
  area: string;
  workerType: string;
  callStartsAt: Date;
  callEndsAt: Date;
  callNote: string | null;
}) {
  const role = shiftWorkerLabel(args.workerType);
  const callWindow = args.callStartsAt.getTime() === args.callEndsAt.getTime()
    ? formatShiftNotifyTime(args.callStartsAt)
    : `${formatShiftNotifyTime(args.callStartsAt)} - ${formatShiftNotifyTime(args.callEndsAt)}`;
  const note = args.callNote ? ` ${args.callNote}` : "";
  const timing = args.workerType === "ST" ? ` Call time: ${callWindow}.` : "";

  switch (args.event) {
    case "requested":
      // A request holds no slot. Saying anything warmer than "waiting" is how
      // someone treats a pending claim as a shift they have.
      return {
        type: "shift_request_pending",
        title: "Shift request sent",
        body: `Your request for the ${args.area} ${role} slot for ${args.eventTitle} is waiting for Admin approval. You're not on the schedule until it's approved.${timing}${note}`,
      };
    case "approved":
      return {
        type: "shift_request_approved",
        title: "Shift request approved",
        body: `You're approved for the ${args.area} ${role} slot for ${args.eventTitle}.${timing}${note}`,
      };
    case "declined":
      return {
        type: "shift_request_declined",
        title: "Shift request declined",
        body: `Your request for the ${args.area} ${role} slot for ${args.eventTitle} was declined.`,
      };
    case "removed":
      return {
        type: "shift_assignment_removed",
        title: "Shift assignment removed",
        body: `You're no longer assigned to the ${args.area} ${role} slot for ${args.eventTitle}.`,
      };
    case "shift_time_changed":
      return {
        type: "shift_time_changed",
        title: "Shift time updated",
        body: args.workerType === "ST"
          ? `Your ${args.area} ${role} slot for ${args.eventTitle} has an updated call time: ${callWindow}.${note}`
          : `The event time changed for your ${args.area} ${role} slot for ${args.eventTitle}.${note}`,
      };
    case "personal_call_time_changed":
      return {
        type: "shift_personal_call_time_changed",
        title: "Your call time changed",
        body: `Your call time for the ${args.area} ${role} slot for ${args.eventTitle} is now ${callWindow}.${note}`,
      };
    default:
      return {
        type: "shift_assigned",
        title: "Shift assigned",
        body: `You're assigned to the ${args.area} ${role} slot for ${args.eventTitle}.${timing}${note}`,
      };
  }
}

/**
 * Everything a schedule notification needs, detached from the assignment row.
 *
 * A removal caused by deleting the shift cannot look the assignment up
 * afterwards -- it cascades away with the shift -- so the caller captures this
 * before the delete and sends it after the transaction commits.
 */
export type ShiftScheduleNotificationSnapshot = {
  assignmentId: string;
  shiftId: string;
  userId: string;
  userEmail: string | null;
  userActive: boolean;
  publishedAt: Date | null;
  area: string;
  workerType: string;
  shiftStartsAt: Date;
  callStartsAt: Date;
  callEndsAt: Date;
  callNote: string | null;
  calendarEvent: {
    id: string;
    summary: string;
    startsAt: Date;
    sportCode: string | null;
    opponent: string | null;
    isHome: boolean | null;
    locationId: string | null;
  };
};

export async function createShiftScheduleNotification(
  assignmentId: string,
  event: ShiftScheduleEvent,
): Promise<void> {
  const assignment = await db.shiftAssignment.findUnique({
    where: { id: assignmentId },
    include: {
      user: { select: { id: true, email: true, active: true } },
      shift: {
        include: {
          shiftGroup: {
            include: {
              event: {
                select: {
                  id: true,
                  summary: true,
                  startsAt: true,
                  sportCode: true,
                  opponent: true,
                  isHome: true,
                  locationId: true,
                },
              },
            },
          },
        },
      },
    },
  });
  if (!assignment) return;

  return createShiftScheduleNotificationFromSnapshot({
    assignmentId: assignment.id,
    shiftId: assignment.shiftId,
    userId: assignment.userId,
    userEmail: assignment.user.email,
    userActive: assignment.user.active,
    publishedAt: assignment.shift.shiftGroup.publishedAt,
    area: assignment.shift.area,
    workerType: assignment.shift.workerType,
    shiftStartsAt: assignment.shift.startsAt,
    callStartsAt: assignment.callStartsAt ?? assignment.shift.callStartsAt ?? assignment.shift.startsAt,
    callEndsAt: assignment.callEndsAt ?? assignment.shift.callEndsAt ?? assignment.shift.endsAt,
    callNote: assignment.callNote,
    calendarEvent: assignment.shift.shiftGroup.event,
  }, event);
}

export async function createShiftScheduleNotificationFromSnapshot(
  assignment: ShiftScheduleNotificationSnapshot,
  event: ShiftScheduleEvent,
): Promise<void> {
  const assignmentId = assignment.assignmentId;
  if (!assignment.userActive) return;
  if (!shouldNotifyWorkerForScheduleEvent({
    event,
    publishedAt: assignment.publishedAt,
  })) return;

  const calendarEvent = assignment.calendarEvent;
  const eventTitle = calendarEvent.opponent
    ? `${calendarEvent.isHome === false ? "at" : "vs"} ${calendarEvent.opponent}`
    : calendarEvent.summary;
  const callStartsAt = assignment.callStartsAt;
  const callEndsAt = assignment.callEndsAt;
  const copy = shiftScheduleNotificationCopy({
    event,
    eventTitle,
    area: assignment.area,
    workerType: assignment.workerType,
    callStartsAt,
    callEndsAt,
    callNote: assignment.callNote,
  });
  const dedupeKey = `shift:${assignmentId}:${copy.type}:${callStartsAt.toISOString()}:${callEndsAt.toISOString()}:${assignment.callNote ?? ""}`;
  const pushPayload = scheduleNotificationPayload({
    assignmentId: assignment.assignmentId,
    shiftId: assignment.shiftId,
    eventId: calendarEvent.id,
  });
  const category = categoryForScheduleNotificationType(copy.type) ?? undefined;

  const existing = await db.notification.findUnique({ where: { dedupeKey } });
  if (existing) return;

  try {
    await db.notification.create({
      data: {
        userId: assignment.userId,
        type: copy.type,
        title: copy.title,
        body: copy.body,
        payload: {
          ...pushPayload,
          eventSummary: calendarEvent.summary,
          area: assignment.area,
          workerType: shiftWorkerLabel(assignment.workerType),
          startsAt: assignment.shiftStartsAt.toISOString(),
          ...(assignment.workerType === "ST" ? {
            callStartsAt: callStartsAt.toISOString(),
            callEndsAt: callEndsAt.toISOString(),
          } : {}),
          sportCode: calendarEvent.sportCode,
          locationId: calendarEvent.locationId,
        },
        channel: "IN_APP",
        sentAt: new Date(),
        dedupeKey,
      },
    });

    deferPush(sendPushToUser(assignment.userId, {
      title: copy.title,
      body: copy.body,
      payload: pushPayload,
      category,
    }));

    if (assignment.userEmail) {
      await sendEmailToUser(assignment.userId, {
        to: assignment.userEmail,
        subject: copy.title,
        html: buildNotificationEmail({
          title: copy.title,
          body: copy.body,
          bookingTitle: calendarEvent.summary,
          dueAt: assignment.workerType === "ST" ? callStartsAt.toISOString() : undefined,
        }),
      }, category);
    }
  } catch (err) {
    console.error(`[NOTIFY] Failed to create shift schedule notification for assignment ${assignmentId}:`, err);
  }
}

export async function dispatchScheduleAssignmentNotifications(
  assignmentId: string,
  event: ShiftScheduleEvent,
): Promise<void> {
  await Promise.allSettled([
    // A pending request holds no slot, so telling the student to prep gear for
    // it would be telling them to prep for a shift they may not get. The nudge
    // waits for the approval, which dispatches "approved" and fires it then.
    ...(event === "requested" || event === "declined"
      ? []
      : [createShiftGearUpNotification(assignmentId, { source: "assignment" })]),
    createShiftScheduleNotification(assignmentId, event),
  ]);
}

/**
 * Tell admins a student is waiting on a decision for an open slot. Runs after
 * the request commits; the per-reviewer dedupe key makes a retry idempotent.
 */
export async function notifyPickupRequestReviewers(assignmentId: string): Promise<void> {
  const assignment = await db.shiftAssignment.findUnique({
    where: { id: assignmentId },
    select: {
      id: true,
      shiftId: true,
      user: { select: { name: true } },
      shift: {
        select: {
          area: true,
          shiftGroup: {
            select: { publishedAt: true, event: { select: { id: true, summary: true } } },
          },
        },
      },
    },
  });
  if (!assignment?.shift.shiftGroup.publishedAt) return;

  const reviewers = await db.user.findMany({
    where: visibleActiveUserWhere({ role: "ADMIN" }),
    select: { id: true },
  });
  if (reviewers.length === 0) return;

  const eventSummary = assignment.shift.shiftGroup.event.summary;
  const title = "Shift request needs review";
  const body = `${assignment.user.name} requested the ${assignment.shift.area} slot for ${eventSummary}.`;
  const payload = scheduleNotificationPayload({
    assignmentId: assignment.id,
    shiftId: assignment.shiftId,
    eventId: assignment.shift.shiftGroup.event.id,
  });
  const category = categoryForScheduleNotificationType("shift_request_review") ?? undefined;
  const now = new Date();

  try {
    await db.notification.createMany({
      data: reviewers.map((reviewer) => ({
        userId: reviewer.id,
        type: "shift_request_review",
        title,
        body,
        payload: JSON.parse(JSON.stringify(payload)),
        channel: "IN_APP" as const,
        sentAt: now,
        dedupeKey: `shift_request_review_${assignment.id}_${reviewer.id}`,
      })),
      skipDuplicates: true,
    });

    for (const reviewer of reviewers) {
      deferPush(sendPushToUser(reviewer.id, { title, body, payload, category }));
    }
  } catch (err) {
    console.error(`[NOTIFY] Failed to notify reviewers for shift request ${assignmentId}:`, err);
  }
}

export async function createPublishedShiftGroupNotifications(shiftGroupId: string): Promise<void> {
  const group = await db.shiftGroup.findUnique({
    where: { id: shiftGroupId },
    select: {
      publishedAt: true,
      publishedVersion: true,
      event: { select: { id: true, summary: true, startsAt: true } },
      shifts: {
        select: {
          workerType: true,
          startsAt: true,
          callStartsAt: true,
          assignments: {
            where: {
              status: { in: ["DIRECT_ASSIGNED", "APPROVED"] },
              user: { active: true },
            },
            select: {
              userId: true,
              callStartsAt: true,
              user: { select: { email: true } },
            },
          },
        },
      },
    },
  });

  if (!group?.publishedAt) return;
  const assignmentsByUser = new Map<string, { count: number; email: string | null; studentCallStartsAt: Date | null }>();
  for (const shift of group.shifts) for (const assignment of shift.assignments) {
    const current = assignmentsByUser.get(assignment.userId);
    assignmentsByUser.set(assignment.userId, {
      count: (current?.count ?? 0) + 1,
      email: assignment.user.email,
      studentCallStartsAt: shift.workerType === "ST"
        ? [current?.studentCallStartsAt, assignment.callStartsAt ?? shift.callStartsAt ?? shift.startsAt]
            .filter((value): value is Date => Boolean(value))
            .sort((a, b) => a.getTime() - b.getTime())[0] ?? null
        : current?.studentCallStartsAt ?? null,
    });
  }

  const title = "Schedule ready";
  const payload = scheduleNotificationPayload({ eventId: group.event.id });

  await Promise.allSettled(
    [...assignmentsByUser.entries()].map(async ([userId, assignment]) => {
      const shiftLabel = assignment.count === 1 ? "shift" : "shifts";
      const callCopy = assignment.studentCallStartsAt
        ? ` Student call time: ${formatShiftNotifyTime(assignment.studentCallStartsAt)}.`
        : "";
      const body = `You're scheduled for ${assignment.count} ${shiftLabel} on ${group.event.summary}.${callCopy} Review your gear details.`;
      const dedupeKey = `shift_group_publish:${shiftGroupId}:v${group.publishedVersion}:${userId}`;
      try {
        await db.notification.create({
          data: {
            userId,
            type: "shift_schedule_published",
            title,
            body,
            payload,
            channel: "IN_APP",
            sentAt: new Date(),
            dedupeKey,
          },
        });
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "P2002") return;
        throw error;
      }

      deferPush(sendPushToUser(userId, { title, body, payload, category: "schedule" }));
      if (assignment.email) {
        await sendEmailToUser(userId, {
          to: assignment.email,
          subject: title,
          html: buildNotificationEmail({
            title,
            body,
            bookingTitle: group.event.summary,
            dueAt: assignment.studentCallStartsAt?.toISOString(),
          }),
        }, "schedule");
      }
    }),
  );
}

type BulkAssignmentProposalRecord = { shiftId: string; userId: string };

function parseBulkAssignmentProposals(value: unknown): BulkAssignmentProposalRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const proposal = item as { shiftId?: unknown; userId?: unknown };
    return typeof proposal.shiftId === "string" && typeof proposal.userId === "string"
      ? [{ shiftId: proposal.shiftId, userId: proposal.userId }]
      : [];
  });
}

/**
 * A bulk release publishes many event schedules at once. Keep the worker
 * experience to one inbox row, one push, and one email for the whole batch.
 */
export async function createBulkScheduleAssignmentNotifications(batchId: string): Promise<void> {
  const batch = await db.scheduleBulkAssignment.findUnique({
    where: { id: batchId },
    select: {
      id: true,
      sportCode: true,
      rangeStartsAt: true,
      rangeEndsAt: true,
      items: {
        where: { status: "RELEASED" },
        select: { shiftGroupId: true, proposalPayload: true },
      },
    },
  });
  if (!batch) return;

  const pairs = batch.items.flatMap((item) => parseBulkAssignmentProposals(item.proposalPayload).map((proposal) => ({
    ...proposal,
    shiftGroupId: item.shiftGroupId,
  })));
  const uniquePairs = [...new Map(pairs.map((pair) => [`${pair.shiftId}:${pair.userId}`, pair])).values()];
  if (uniquePairs.length === 0) return;

  const assignments = await db.shiftAssignment.findMany({
    where: {
      status: { in: ACTIVE_ASSIGNMENT_STATUSES },
      OR: uniquePairs.map(({ shiftId, userId }) => ({ shiftId, userId })),
    },
    select: {
      shiftId: true,
      userId: true,
      user: { select: { email: true } },
      shift: { select: { shiftGroupId: true } },
    },
  });

  const byUser = new Map<string, { email: string | null; shiftIds: Set<string>; eventIds: Set<string> }>();
  for (const assignment of assignments) {
    const current = byUser.get(assignment.userId) ?? {
      email: assignment.user.email,
      shiftIds: new Set<string>(),
      eventIds: new Set<string>(),
    };
    current.shiftIds.add(assignment.shiftId);
    current.eventIds.add(assignment.shift.shiftGroupId);
    byUser.set(assignment.userId, current);
  }

  const body = "Click to review your upcoming shifts";
  await Promise.allSettled([...byUser.entries()].map(async ([userId, assignment]) => {
    const count = assignment.shiftIds.size;
    const title = `You were assigned ${count} ${count === 1 ? "shift" : "shifts"}`;
    const payload = scheduleMyShiftsNotificationPayload({
      rangeStartsAt: batch.rangeStartsAt,
      rangeEndsAt: batch.rangeEndsAt,
      sportCode: batch.sportCode,
      extra: {
        bulkAssignmentId: batch.id,
        shiftCount: count,
        eventCount: assignment.eventIds.size,
      },
    });
    const dedupeKey = `schedule_bulk_assignment:${batch.id}:${userId}`;
    try {
      await db.notification.create({
        data: {
          userId,
          type: "shift_schedule_bulk_assigned",
          title,
          body,
          payload,
          channel: "IN_APP",
          sentAt: new Date(),
          dedupeKey,
        },
      });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") return;
      throw error;
    }

    deferPush(sendPushToUser(userId, { title, body, payload, category: "schedule" }));
    if (assignment.email) {
      await sendEmailToUser(userId, {
        to: assignment.email,
        subject: title,
        html: buildNotificationEmail({
          title,
          body,
          bookingTitle: batch.sportCode ? `${batch.sportCode} schedule` : "Upcoming shifts",
        }),
      }, "schedule");
    }
  }));
}

export async function notifyPublishedShiftGroupWorkers(
  shiftGroupId: string,
  userIds: string[],
): Promise<void> {
  const uniqueUserIds = [...new Set(userIds)];
  if (uniqueUserIds.length === 0) return;
  const [group, users] = await Promise.all([
    db.shiftGroup.findUnique({
      where: { id: shiftGroupId },
      select: {
        publishedAt: true,
        publishedVersion: true,
        event: { select: { id: true, summary: true, startsAt: true } },
        shifts: {
          select: {
            workerType: true,
            startsAt: true,
            callStartsAt: true,
            assignments: {
              where: {
                userId: { in: uniqueUserIds },
                status: { in: ["DIRECT_ASSIGNED", "APPROVED"] },
              },
              select: { userId: true, callStartsAt: true },
            },
          },
        },
      },
    }),
    db.user.findMany({
      where: { id: { in: uniqueUserIds }, active: true },
      select: { id: true, email: true },
    }),
  ]);
  if (!group?.publishedAt) return;

  const assignmentsByUser = new Map<string, { count: number; studentCallStartsAt: Date | null }>();
  for (const shift of group.shifts) for (const assignment of shift.assignments) {
    const current = assignmentsByUser.get(assignment.userId);
    assignmentsByUser.set(assignment.userId, {
      count: (current?.count ?? 0) + 1,
      studentCallStartsAt: shift.workerType === "ST"
        ? [current?.studentCallStartsAt, assignment.callStartsAt ?? shift.callStartsAt ?? shift.startsAt]
            .filter((value): value is Date => Boolean(value))
            .sort((a, b) => a.getTime() - b.getTime())[0] ?? null
        : current?.studentCallStartsAt ?? null,
    });
  }
  const title = "Schedule updated";
  const payload = scheduleNotificationPayload({ eventId: group.event.id });

  await Promise.allSettled(users.map(async (user) => {
    const assignment = assignmentsByUser.get(user.id);
    const count = assignment?.count ?? 0;
    const body = count === 0
      ? `You are no longer scheduled for ${group.event.summary}.`
      : `Your schedule changed for ${group.event.summary}. You now have ${count} ${count === 1 ? "shift" : "shifts"}.${assignment?.studentCallStartsAt ? ` Student call time: ${formatShiftNotifyTime(assignment.studentCallStartsAt)}.` : ""} Review your gear details.`;
    const dedupeKey = `shift_group_update:${shiftGroupId}:v${group.publishedVersion}:${user.id}`;
    try {
      await db.notification.create({
        data: {
          userId: user.id,
          type: "shift_schedule_updated",
          title,
          body,
          payload,
          channel: "IN_APP",
          sentAt: new Date(),
          dedupeKey,
        },
      });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") return;
      throw error;
    }

    deferPush(sendPushToUser(user.id, { title, body, payload, category: "schedule" }));
    if (user.email) {
      await sendEmailToUser(user.id, {
        to: user.email,
        subject: title,
        html: buildNotificationEmail({
          title,
          body,
          bookingTitle: group.event.summary,
          dueAt: assignment?.studentCallStartsAt?.toISOString(),
        }),
      }, "schedule");
    }
  }));
}

export async function notifyPublishedScheduleFollowers(shiftGroupId: string): Promise<void> {
  const group = await db.shiftGroup.findUnique({
    where: { id: shiftGroupId },
    select: {
      publishedAt: true,
      publishedVersion: true,
      event: {
        select: {
          id: true,
          summary: true,
          startsAt: true,
          follows: {
            where: {
              mutedAt: null,
              user: {
                active: true,
                role: "COLLABORATOR",
                collaboratorPolicy: {
                  is: {
                    status: "ACTIVE",
                    grants: { some: { capabilityKey: "PUBLISHED_SCHEDULE_VIEW" } },
                  },
                },
              },
            },
            select: {
              user: { select: { id: true, email: true } },
            },
          },
        },
      },
    },
  });
  if (!group?.publishedAt || group.event.follows.length === 0) return;

  const title = "Published schedule updated";
  const body = `${group.event.summary} has an updated published crew schedule.`;
  const payload = { eventId: group.event.id };

  await Promise.allSettled(group.event.follows.map(async ({ user }) => {
    const dedupeKey = `published_schedule:${group.event.id}:v${group.publishedVersion}:${user.id}`;
    try {
      await db.notification.create({
        data: {
          userId: user.id,
          type: "published_schedule_updated",
          title,
          body,
          payload,
          channel: "IN_APP",
          sentAt: new Date(),
          dedupeKey,
        },
      });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") return;
      throw error;
    }

    deferPush(sendPushToUser(user.id, { title, body, payload, category: "schedule" }));
    if (user.email) {
      await sendEmailToUser(user.id, {
        to: user.email,
        subject: title,
        html: buildNotificationEmail({
          title,
          body,
          bookingTitle: group.event.summary,
        }),
      }, "schedule");
    }
  }));
}

type ReservationLifecycleEvent = "booked" | "pickup_ready" | "cancelled";

/**
 * Sends an in-app notification to the requester for reservation lifecycle events.
 * For "cancelled", skips the notification if the actor is the requester (self-cancel).
 */
export async function createReservationLifecycleNotification(args: {
  bookingId: string;
  bookingTitle: string;
  requesterUserId: string;
  actorUserId: string;
  event: ReservationLifecycleEvent;
}): Promise<void> {
  const { bookingId, bookingTitle, requesterUserId, actorUserId, event } = args;

  // Don't notify users when they cancel their own reservation
  if (event === "cancelled" && requesterUserId === actorUserId) return;

  const dedupeKey = `${bookingId}:reservation_${event}`;

  const existing = await db.notification.findUnique({ where: { dedupeKey } });
  if (existing) return;

  const configs: Record<ReservationLifecycleEvent, { type: string; title: string; body: string }> = {
    booked: {
      type: "reservation_booked",
      title: "Reservation confirmed",
      body: `Your reservation "${bookingTitle}" has been created.`,
    },
    pickup_ready: {
      type: "reservation_pickup_ready",
      title: "Gear ready for pickup",
      body: `Your reservation "${bookingTitle}" is ready. Pick up your gear at the kiosk.`,
    },
    cancelled: {
      type: "reservation_cancelled",
      title: "Reservation cancelled",
      body: `Your reservation "${bookingTitle}" was cancelled.`,
    },
  };

  const { type, title, body } = configs[event];

  try {
    await db.notification.create({
      data: {
        userId: requesterUserId,
        type,
        title,
        body,
        payload: { bookingId },
        channel: "IN_APP",
        sentAt: new Date(),
        dedupeKey,
      },
    });

    deferPush(sendPushToUser(requesterUserId, { title, body, payload: { bookingId }, category: "reservation" }));
  } catch (err) {
    console.error(`[NOTIFY] Failed to create reservation_${event} notification for booking ${bookingId}:`, err);
  }
}

/**
 * Notifies all ADMIN and STAFF users when a student reports an item as damaged or lost
 * during check-in scanning.
 */
export async function notifyItemReport(args: {
  bookingId: string;
  bookingTitle: string;
  assetId: string;
  assetTag: string;
  itemDescription: string;
  reportType: "DAMAGED" | "LOST";
  damageDescription?: string;
  evidenceImageUrl?: string;
  reporterName: string;
}): Promise<void> {
  const supervisors = await db.user.findMany({
    where: visibleActiveUserWhere({ role: { in: ["ADMIN", "STAFF"] } }),
    select: { id: true, email: true },
  });

  const now = new Date();
  const typeLower = args.reportType.toLowerCase();
  const notifType = `checkin_item_${typeLower}`;
  const title = `Item reported ${typeLower}: ${args.assetTag}`;
  const body = args.reportType === "DAMAGED"
    ? `${args.reporterName} reported ${args.itemDescription} (${args.assetTag}) as damaged during check-in of "${args.bookingTitle}".${args.damageDescription ? ` Description: ${args.damageDescription}` : ""}`
    : `${args.reporterName} reported ${args.itemDescription} (${args.assetTag}) as lost during check-in of "${args.bookingTitle}".`;

  // Batch-create all notifications in one INSERT
  const notifData = supervisors.map((s) => ({
    userId: s.id,
    type: notifType,
    title,
    body,
    payload: {
      bookingId: args.bookingId,
      bookingTitle: args.bookingTitle,
      assetId: args.assetId,
      assetTag: args.assetTag,
      reportType: args.reportType,
      reporterName: args.reporterName,
      ...(args.evidenceImageUrl ? { evidenceImageUrl: args.evidenceImageUrl } : {}),
    },
    channel: "IN_APP" as const,
    sentAt: now,
    dedupeKey: `${args.bookingId}:item_report:${args.assetId}:${s.id}`,
  }));

  try {
    await db.notification.createMany({ data: notifData, skipDuplicates: true });
  } catch (err) {
    console.error(`[NOTIFY] Failed to batch-create item report notifications:`, err);
  }

  // Send emails concurrently (fire-and-forget, failures don't block)
  const emailPromises = supervisors
    .filter((s) => s.email)
    .map((s) =>
      sendEmailToUser(s.id, {
        to: s.email!,
        subject: title,
        html: buildNotificationEmail({
          title,
          body,
          bookingTitle: args.bookingTitle,
          dueAt: now.toISOString(),
        }),
      }).catch((err) =>
        console.error(`[NOTIFY] Failed to send item report email to ${s.email}:`, err)
      )
    );
  await Promise.allSettled(emailPromises);
}

/**
 * Notifies all ADMIN users when a bulk SKU stock drops to or below its min threshold.
 * Deduped: only one notification per SKU per 24 hours.
 */
export async function notifyLowStock(args: {
  bulkSkuId: string;
  skuName: string;
  onHandQuantity: number;
  minThreshold: number;
}) {
  const admins = await db.user.findMany({
    where: visibleActiveUserWhere({ role: "ADMIN" }),
    select: { id: true },
  });

  if (admins.length === 0) return;

  const now = new Date();
  const title = `Low stock: ${args.skuName}`;
  const body = `${args.onHandQuantity} remaining (threshold: ${args.minThreshold}). Restock soon.`;

  // dedupeKey is globally unique, so the key must carry a time bucket — a
  // constant key plus skipDuplicates silences every future re-alert after
  // the first one, not just re-alerts within the 24h window.
  const dayStamp = now.toISOString().slice(0, 10);

  // 24h re-alert window: prefix match covers both day-stamped keys and
  // legacy un-stamped ones, per admin.
  const recentNotifs = await db.notification.findMany({
    where: {
      dedupeKey: { startsWith: `low_stock:${args.bulkSkuId}:` },
      createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
    },
    select: { dedupeKey: true },
  });
  const recentlyNotifiedAdminIds = new Set(
    recentNotifs
      .map((n) => n.dedupeKey?.split(":")[2])
      .filter((id): id is string => Boolean(id)),
  );

  // Batch-create notifications for admins that haven't been notified recently
  const notifData = admins
    .filter((a) => !recentlyNotifiedAdminIds.has(a.id))
    .map((a) => ({
      userId: a.id,
      type: "low_stock",
      title,
      body,
      payload: {
        bulkSkuId: args.bulkSkuId,
        skuName: args.skuName,
        onHandQuantity: args.onHandQuantity,
        minThreshold: args.minThreshold,
      },
      channel: "IN_APP" as const,
      sentAt: now,
      dedupeKey: `low_stock:${args.bulkSkuId}:${a.id}:${dayStamp}`,
    }));

  if (notifData.length > 0) {
    try {
      await db.notification.createMany({ data: notifData, skipDuplicates: true });
    } catch (err) {
      console.error(`[NOTIFY] Failed to batch-create low-stock notifications:`, err);
    }
  }
}

function formatRelative(dueAt: Date, now: Date): string {
  const diffMs = now.getTime() - dueAt.getTime();
  if (diffMs < 0) {
    const hours = Math.round(-diffMs / 3600_000);
    return hours <= 1 ? "in less than an hour" : `in ${hours} hours`;
  }
  const hours = Math.round(diffMs / 3600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days > 1 ? "s" : ""} ago`;
}

/**
 * Deliver one message per worker for a flushed batch of schedule changes.
 *
 * Callers hand over a diff that has already been reduced to net effect, so a
 * worker whose assignment churned and landed back where it started is simply
 * absent from it. Everyone present gets exactly one row, one push, and one
 * email, keyed to the flush so a retry cannot double-send.
 */
export async function notifyScheduleChanges(args: {
  shiftGroupId: string;
  eventId: string;
  eventTitle: string;
  flushVersion: number;
  byUser: Map<string, ScheduleWorkerChange[]>;
}): Promise<{ notified: string[] }> {
  const userIds = [...args.byUser.keys()].sort();
  if (userIds.length === 0) return { notified: [] };

  const users = await db.user.findMany({
    where: { id: { in: userIds }, active: true },
    select: { id: true, email: true },
  });

  const notified: string[] = [];

  await Promise.allSettled(users.map(async (user) => {
    const changes = args.byUser.get(user.id) ?? [];
    const lead = primaryChange(changes);
    if (!lead) return;

    const copy = scheduleChangeCopy({
      eventTitle: args.eventTitle,
      change: lead,
      alsoCount: changes.length - 1,
    });
    const category = categoryForScheduleNotificationType(copy.type) ?? "schedule";
    const payload = scheduleNotificationPayload({
      eventId: args.eventId,
      shiftId: lead.kind === "removed" ? lead.before.shiftId : lead.after.shiftId,
    });
    const dedupeKey = `schedule_flush:${args.shiftGroupId}:v${args.flushVersion}:${user.id}`;

    try {
      await db.notification.create({
        data: {
          userId: user.id,
          type: copy.type,
          title: copy.title,
          body: copy.body,
          payload,
          channel: "IN_APP",
          sentAt: new Date(),
          dedupeKey,
        },
      });
    } catch (error) {
      // A duplicate means an earlier attempt already told this person.
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") return;
      throw error;
    }

    notified.push(user.id);
    deferPush(sendPushToUser(user.id, {
      title: copy.title,
      body: copy.body,
      payload,
      category,
    }));

    if (user.email) {
      await sendEmailToUser(user.id, {
        to: user.email,
        subject: `${copy.title} - schedule update`,
        html: buildNotificationEmail({
          title: copy.title,
          body: copy.body,
          bookingTitle: args.eventTitle,
        }),
      }, category);
    }
  }));

  return { notified };
}
