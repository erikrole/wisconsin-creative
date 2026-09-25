import { after } from "next/server";
import { db } from "@/lib/db";
import { sendEmail, buildNotificationEmail } from "@/lib/email";
import { sendPush } from "@/lib/push/apns";
import { sendWebPushToUsers } from "@/lib/push/web";
import { withNotificationHref } from "@/lib/notification-destination";
import { ACTIVE_ASSIGNMENT_STATUSES } from "@/lib/shift-constants";
import { isInQuietHours, loadUserPrefs, normalizePrefs, pushSuppressionReason, resolvePushPresentation, shouldDeliverEmail, shouldDeliverCategory, type NotificationCategory } from "@/lib/services/notification-prefs";
import { latencyBucket, recordDeliveries, type DeliveryRecord } from "@/lib/services/notification-deliveries";
import { analyticsTag } from "@/lib/services/product-event-log";
import { catalogEntry } from "@/lib/notification-catalog";
import { loadCheckoutPolicies } from "@/lib/services/checkout-policies";
import { shiftWorkerLabel } from "@/lib/shift-display";
import { formatAppDateTime, formatAppTime } from "@/lib/app-time";
import { studentCallTimeAppliesToEvent } from "@/lib/shift-call-windows";
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
import { unique } from "@/lib/utils";

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

export type PushMessage = {
  title: string;
  /** The booking, event, or item the alert is about, shown under the title. */
  subtitle?: string | null;
  /**
   * The push body. With a subtitle this should be the short next step; the
   * inbox row keeps its own self-contained body for clients without subtitles.
   */
  body?: string | null;
  payload?: Record<string, unknown>;
  category?: NotificationCategory;
  /** The inbox row this push announces, so the device can clear or mark it. */
  notificationId?: string;
  /**
   * A later push with the same key replaces this one on the device instead of
   * stacking, e.g. one alert per checkout as reminders escalate. Defaults to
   * the inbox row id, so unrelated alerts never replace each other.
   */
  collapseId?: string;
  /** Overrides the category's action set, e.g. no Approve on a decided review. */
  apnsCategory?: string;
};

/** One Notification Center stack per checkout or event; otherwise per category. */
function pushThreadId(payload: Record<string, unknown> | undefined, category: NotificationCategory | undefined): string {
  const bookingId = typeof payload?.bookingId === "string" ? payload.bookingId : null;
  if (bookingId) return `booking-${bookingId}`;
  const eventId = typeof payload?.eventId === "string" ? payload.eventId : null;
  if (eventId) return `event-${eventId}`;
  return category ?? "general";
}

export async function sendPushToUser(userId: string, opts: PushMessage): Promise<void> {
  // Never throws: callers fire-and-forget with `void`, and an unhandled
  // rejection is fatal in modern Node — push is best-effort by design.
  // Every outcome for an inbox row lands in the delivery ledger.
  const ledger: DeliveryRecord[] = [];
  const record = (entry: Omit<DeliveryRecord, "notificationId" | "category">) => {
    if (opts.notificationId) {
      ledger.push({ notificationId: opts.notificationId, category: opts.category ?? null, ...entry });
    }
  };
  try {
    const prefs = await loadUserPrefs(userId);
    const now = new Date();
    const presentation = resolvePushPresentation(prefs, opts.category, now);
    if (!presentation) {
      record({ channel: "apns", outcome: "suppressed", reason: pushSuppressionReason(prefs, opts.category, now) });
      return;
    }
    const silentReason = presentation.sound
      ? null
      : isInQuietHours(prefs.quietHours, now) ? "quiet_hours" : "level_silent";

    // Keep native APNs tokens and browser subscriptions on their own delivery
    // paths. The web sender is best-effort and has its own failure boundary, so
    // missing VAPID configuration never suppresses iOS delivery.
    const payloadType = typeof opts.payload?.type === "string" ? opts.payload.type : undefined;
    const payload = withNotificationHref(
      {
        ...opts.payload,
        ...(opts.notificationId ? { notificationId: opts.notificationId } : {}),
        // Lets the device tag its open/action telemetry without the title.
        ...(opts.category ? { category: analyticsTag(opts.category) } : {}),
      },
      payloadType,
    );
    const [tokens, webDeliveries] = await Promise.all([
      db.deviceToken.findMany({
        where: {
          userId,
          platform: "IOS",
          revokedAt: null,
          user: { active: true },
        },
        select: { token: true },
      }),
      // Browser notifications have no subtitle line; lead the body with it.
      sendWebPushToUsers([userId], {
        title: opts.title,
        body: opts.subtitle ? [opts.subtitle, opts.body].filter(Boolean).join(" · ") : opts.body,
        payload,
        silent: !presentation.sound,
        // Same replace-in-place key as iOS; re-alert only when it's urgent.
        tag: opts.collapseId ?? opts.notificationId,
        renotify: opts.category === "checkoutOverdue",
      }),
    ]);
    const web = webDeliveries.get(userId);
    if (web && web.devices > 0) {
      record(web.delivered > 0
        ? { channel: "web", outcome: silentReason ? "sent_silent" : "sent", reason: silentReason }
        : { channel: "web", outcome: web.revoked > 0 ? "bad_token" : "error", reason: web.revoked > 0 ? "expired" : null });
    }
    if (tokens.length === 0) {
      if (!web || web.devices === 0) record({ channel: "apns", outcome: "no_device" });
      return;
    }

    // Producers write the inbox row before pushing, so this count includes it.
    const unreadCount = await db.notification.count({ where: { userId, readAt: null } });
    const entry = opts.category ? catalogEntry(opts.category) : null;

    const dispatchStartedAt = Date.now();
    const { revoked, ok: accepted } = await sendPush(
      tokens.map((t) => t.token),
      {
        title: opts.title,
        subtitle: opts.subtitle ?? undefined,
        body: opts.body ?? "",
        payload,
        // Selects the native long-press action set (Mark as Read everywhere,
        // plus snooze, acknowledge, or Approve/Decline where they apply).
        category: opts.apnsCategory ?? entry?.apnsCategory,
        interruptionLevel: presentation.interruptionLevel,
        sound: presentation.sound,
        threadId: pushThreadId(opts.payload, opts.category),
        badge: unreadCount,
        relevanceScore: entry?.relevance,
        collapseId: opts.collapseId ?? opts.notificationId,
      }
    );
    const latency = latencyBucket(Date.now() - dispatchStartedAt);
    if (accepted > 0) {
      record({ channel: "apns", outcome: silentReason ? "sent_silent" : "sent", reason: silentReason, latencyBucket: latency });
    } else if (revoked.length === tokens.length) {
      record({ channel: "apns", outcome: "bad_token", latencyBucket: latency });
    } else {
      record({ channel: "apns", outcome: "error", latencyBucket: latency });
    }

    if (revoked.length > 0) {
      await db.deviceToken.updateMany({
        where: { token: { in: revoked } },
        data: { revokedAt: new Date() },
      });
    }
  } catch (err) {
    console.error(`[NOTIFY] Push to user ${userId} failed:`, err);
    record({ channel: "apns", outcome: "error", reason: "exception" });
  } finally {
    await recordDeliveries(ledger);
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
  custodyScope: "PERSON" | "SHARED";
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

/** Push body under a "Checkout name" subtitle: the next step only. */
function requesterEscalationPushBody(type: string, gracePeriodHours: number, dueAt: Date): string {
  if (type === "checkout_due_2h") return `Return it by ${formatAppTime(dueAt)}.`;
  if (type === "checkout_due_now") {
    const graceMinutes = Math.round(gracePeriodHours * 60);
    return graceMinutes > 0 ? `Return it within ${graceMinutes} minutes.` : "Return it now.";
  }
  return "Return it as soon as you can.";
}

function operationalEscalationTiming(rule: EscalationRule): string {
  return rule.type === "checkout_overdue_24h" ? "1 day" : "4 hours";
}

function operationalEscalationPushBody(checkout: EscalationCheckout): string {
  return checkout.custodyScope === "SHARED"
    ? "This shared checkout isn't back. Follow up to get it returned."
    : `${checkout.requester.name} hasn't returned it. Follow up with them.`;
}

function operationalEscalationBody(checkout: EscalationCheckout, rule: EscalationRule): string {
  const timing = operationalEscalationTiming(rule);
  return checkout.custodyScope === "SHARED"
    ? `Shared checkout "${checkout.title}" is ${timing} overdue.`
    : `${checkout.requester.name}'s checkout "${checkout.title}" is ${timing} overdue.`;
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
  /** Shorter push body; the subtitle carries the checkout name. */
  pushBody: string;
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

  let notificationId: string;
  try {
    const row = await db.notification.create({
      data: {
        userId: args.recipient.id,
        bookingId: args.checkout.id,
        type: args.rule.type,
        title: args.title,
        body: args.body,
        payload: {
          bookingId: args.checkout.id,
          bookingTitle: args.checkout.title,
          requesterName: args.checkout.custodyScope === "SHARED"
            ? "Shared checkout"
            : args.checkout.requester.name,
          dueAt: args.checkout.endsAt.toISOString(),
          dueVersion,
          recipientKind: args.recipientKind,
          href: `/checkouts/${args.checkout.id}`,
        },
        channel: "IN_APP",
        sentAt: args.now,
        dedupeKey,
      },
      select: { id: true },
    });
    notificationId = row.id;
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
      subtitle: args.checkout.title,
      body: args.pushBody,
      payload: { bookingId: args.checkout.id, href: `/checkouts/${args.checkout.id}` },
      category,
      notificationId,
      // Each stage replaces the last, so a checkout never stacks "due soon"
      // under "overdue". Staff follow-ups replace each other separately.
      collapseId: args.recipientKind === "requester"
        ? `checkout-${args.checkout.id}`
        : `checkout-${args.checkout.id}-followup`,
    }));
  }
  if (channels.email && args.recipient.email) {
    await sendEmailToUser(args.recipient.id, {
      to: args.recipient.email,
      // Email has no subtitle line, so the subject names the checkout.
      subject: `${args.title}: ${args.checkout.title}`,
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

  if (args.checkout.custodyScope !== "SHARED" && args.rule.notifyRequester && counts.requester < args.config.maxRequesterNotificationsPerDueDate) {
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
      pushBody: requesterEscalationPushBody(args.rule.type, args.gracePeriodHours, args.checkout.endsAt),
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
    .filter((person) => args.checkout.custodyScope === "SHARED" || person.id !== args.checkout.requesterUserId);

  if (responders.length === 0) {
    const creator = operationsById.get(args.checkout.createdBy);
    responders = creator && (args.checkout.custodyScope === "SHARED" || creator.id !== args.checkout.requesterUserId) ? [creator] : [];
  }
  if (responders.length === 0) {
    responders = admins.filter((admin) => args.checkout.custodyScope === "SHARED" || admin.id !== args.checkout.requesterUserId);
  }

  const operationalRecipients = new Map<string, { user: OperationsUser; kind: CheckoutEscalationRecipientKind }>();
  for (const responder of responders) operationalRecipients.set(responder.id, { user: responder, kind: "responder" });
  if (args.rule.notifyAdmins) {
    for (const admin of admins) {
      if ((args.checkout.custodyScope !== "SHARED" && admin.id === args.checkout.requesterUserId) || operationalRecipients.has(admin.id)) continue;
      operationalRecipients.set(admin.id, { user: admin, kind: "admin" });
    }
  }

  let operationalCount = counts.operational;
  for (const { user, kind } of operationalRecipients.values()) {
    if (operationalCount >= args.config.maxOperationalNotificationsPerDueDate) break;
    // The checkout name is the subtitle; repeating it in the title read
    // "Overdue: Kit A" over "Kit A is 4 hours overdue".
    const title = `Checkout ${operationalEscalationTiming(args.rule)} overdue`;
    const body = operationalEscalationBody(args.checkout, args.rule);
    if (await persistCheckoutEscalation({
      checkout: args.checkout,
      rule: args.rule,
      recipient: user,
      recipientKind: kind,
      title,
      body,
      pushBody: operationalEscalationPushBody(args.checkout),
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
      select: { kind: true, status: true, custodyScope: true, endsAt: true },
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
        custodyScope: true,
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
      where: { bookingId: checkout.id },
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

/** How many open checkouts one repair sweep will look at. */
const OVERDUE_SWEEP_LIMIT = 500;

/**
 * Daily repair sweep. Durable per-checkout workflows own normal delivery.
 *
 * Scans at most `OVERDUE_SWEEP_LIMIT` open checkouts, oldest due date first.
 * `remaining` is how many open checkouts the cap left unscanned this run, and
 * `truncated` is simply `remaining > 0` — callers surface both so a
 * backlog is visible instead of silently dropped.
 */
export async function processOverdueNotifications(): Promise<{
  scanned: number;
  notificationsCreated: number;
  remaining: number;
  truncated: boolean;
}> {
  const now = new Date();
  const [openCheckouts, rules, policies, config, operationsUsers, responderConfigs, openCheckoutCount] = await Promise.all([
    db.booking.findMany({
      where: { kind: "CHECKOUT", status: "OPEN" },
      select: {
        id: true,
        kind: true,
        status: true,
        title: true,
        requesterUserId: true,
        custodyScope: true,
        locationId: true,
        createdBy: true,
        endsAt: true,
        requester: { select: { id: true, name: true, email: true } },
      },
      take: OVERDUE_SWEEP_LIMIT,
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
    db.booking.count({ where: { kind: "CHECKOUT", status: "OPEN" } }),
  ]);
  const remaining = Math.max(0, openCheckoutCount - openCheckouts.length);
  const truncated = remaining > 0;
  if (openCheckouts.length === 0) return { scanned: 0, notificationsCreated: 0, remaining, truncated };

  const bookingIds = openCheckouts.map((checkout) => checkout.id);
  const existingRows = await db.notification.findMany({
    where: { bookingId: { in: bookingIds } },
    select: { bookingId: true, dedupeKey: true, payload: true },
  });
  const existingByBooking = new Map<string, ExistingEscalationNotification[]>();
  for (const row of existingRows) {
    if (typeof row.bookingId !== "string") continue;
    const rows = existingByBooking.get(row.bookingId) ?? [];
    rows.push(row);
    existingByBooking.set(row.bookingId, rows);
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
  return { scanned: openCheckouts.length, notificationsCreated, remaining, truncated };
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

  const shiftTime = formatAppDateTime(assignment.shift.startsAt);

  const title = "Gear up for your shift";
  const body = `You're on ${assignment.shift.area} at ${event.summary}, ${shiftTime}. Reserve your gear now.`;
  const pushBody = `${assignment.shift.area}, ${shiftTime}. Reserve your gear now.`;
  const pushPayload = scheduleNotificationPayload({
    assignmentId: assignment.id,
    shiftId: assignment.shiftId,
    eventId: event.id,
  });

  try {
    const row = await db.notification.create({
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
      subtitle: event.summary,
      body: pushBody,
      payload: pushPayload,
      category: categoryForScheduleNotificationType("shift_gear_up") ?? undefined,
      notificationId: row.id,
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
  callStartsAt: Date | null;
  callEndsAt: Date | null;
  callNote: string | null;
}) {
  const hasCallWindow = args.workerType === "ST" && args.callStartsAt && args.callEndsAt;
  const callWindow = hasCallWindow
    ? args.callStartsAt!.getTime() === args.callEndsAt!.getTime()
      ? formatShiftNotifyTime(args.callStartsAt!)
      : `${formatShiftNotifyTime(args.callStartsAt!)} - ${formatShiftNotifyTime(args.callEndsAt!)}`
    : null;
  const note = hasCallWindow && args.callNote ? ` ${args.callNote}` : "";
  const timing = callWindow ? ` Call time: ${callWindow}.` : "";

  // The recipient's own role ("Student") adds nothing; name the area only.
  const shift = args.area;

  // `body` is the self-contained inbox sentence; `pushBody` sits under the
  // event-name subtitle, so it leaves the event out.
  switch (args.event) {
    case "requested":
      // A request holds no shift. Saying anything warmer than "waiting" is how
      // someone treats a pending claim as a shift they have.
      return {
        type: "shift_request_pending",
        title: "Shift request sent",
        body: `Your request for the ${shift} shift at ${args.eventTitle} is waiting for Admin approval. You're not on the schedule until it's approved.${timing}${note}`,
        pushBody: `You're not on the ${shift} shift until an Admin approves.`,
      };
    case "approved":
      return {
        type: "shift_request_approved",
        title: "Shift request approved",
        body: `You're on the schedule for the ${shift} shift at ${args.eventTitle}.${timing}${note}`,
        pushBody: `You're on the ${shift} shift.${timing}${note}`,
      };
    case "declined":
      return {
        type: "shift_request_declined",
        title: "Shift request declined",
        body: `Your request for the ${shift} shift at ${args.eventTitle} was declined.`,
        pushBody: `You won't be on the ${shift} shift.`,
      };
    case "removed":
      return {
        type: "shift_assignment_removed",
        title: "Removed from a shift",
        body: `You're no longer on the ${shift} shift at ${args.eventTitle}.`,
        pushBody: `You're no longer on the ${shift} shift.`,
      };
    case "shift_time_changed":
      return {
        type: "shift_time_changed",
        title: "Call time changed",
        body: callWindow
          ? `Your call time for the ${shift} shift at ${args.eventTitle} is now ${callWindow}.${note}`
          : `The event time changed for your ${shift} shift at ${args.eventTitle}.${note}`,
        pushBody: callWindow ? `${shift}: now ${callWindow}.${note}` : `The event time changed for your ${shift} shift.`,
      };
    case "personal_call_time_changed":
      return {
        type: "shift_personal_call_time_changed",
        title: "Your call time changed",
        body: callWindow
          ? `Your call time for the ${shift} shift at ${args.eventTitle} is now ${callWindow}.${note}`
          : `Your ${shift} shift at ${args.eventTitle} was updated.`,
        pushBody: callWindow ? `${shift}: now ${callWindow}.${note}` : `Your ${shift} shift was updated.`,
      };
    default:
      return {
        type: "shift_assigned",
        title: "Shift assigned",
        body: `You're on the ${shift} shift at ${args.eventTitle}.${timing}${note}`,
        pushBody: `You're on the ${shift} shift.${timing}${note}`,
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
  callStartsAt: Date | null;
  callEndsAt: Date | null;
  callNote: string | null;
  calendarEvent: {
    id: string;
    summary: string;
    startsAt: Date;
    endsAt: Date;
    allDay: boolean;
    sportCode: string | null;
    opponent: string | null;
    isHome: boolean | null;
    site: "HOME" | "AWAY" | "NEUTRAL" | null;
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
                  endsAt: true,
                  allDay: true,
                  sportCode: true,
                  opponent: true,
                  isHome: true,
                  site: true,
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
  if (event === "assigned" || event === "approved") {
    await enqueueShiftReminders([{
      assignmentId,
      callStartsAt: assignment.callStartsAt ?? assignment.shiftStartsAt,
    }]);
  }
  // The full event name, never a bare "vs Iowa" that loses the sport.
  const eventTitle = calendarEvent.summary;
  const hasStudentCallTime = assignment.workerType === "ST"
    && !calendarEvent.allDay
    && studentCallTimeAppliesToEvent(calendarEvent);
  const callStartsAt = hasStudentCallTime ? assignment.callStartsAt : null;
  const callEndsAt = hasStudentCallTime ? assignment.callEndsAt : null;
  const copy = shiftScheduleNotificationCopy({
    event,
    eventTitle,
    area: assignment.area,
    workerType: assignment.workerType,
    callStartsAt,
    callEndsAt,
    callNote: assignment.callNote,
  });
  const dedupeKey = `shift:${assignmentId}:${copy.type}:${callStartsAt?.toISOString() ?? ""}:${callEndsAt?.toISOString() ?? ""}:${hasStudentCallTime ? assignment.callNote ?? "" : ""}`;
  const pushPayload = scheduleNotificationPayload({
    assignmentId: assignment.assignmentId,
    shiftId: assignment.shiftId,
    eventId: calendarEvent.id,
  });
  const category = categoryForScheduleNotificationType(copy.type) ?? undefined;

  const existing = await db.notification.findUnique({ where: { dedupeKey } });
  if (existing) return;

  try {
    const row = await db.notification.create({
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
          startsAt: callStartsAt?.toISOString() ?? (assignment.workerType === "ST" ? calendarEvent.startsAt.toISOString() : assignment.shiftStartsAt.toISOString()),
          ...(callStartsAt && callEndsAt ? {
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
      subtitle: calendarEvent.summary,
      body: copy.pushBody,
      payload: pushPayload,
      category,
      notificationId: row.id,
    }));

    if (assignment.userEmail) {
      await sendEmailToUser(assignment.userId, {
        to: assignment.userEmail,
        subject: copy.title,
        html: buildNotificationEmail({
          title: copy.title,
          body: copy.body,
          bookingTitle: calendarEvent.summary,
          dueAt: callStartsAt?.toISOString(),
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
  const body = `${assignment.user.name} requested the ${assignment.shift.area} shift at ${eventSummary}.`;
  const pushBody = `${assignment.user.name} wants the ${assignment.shift.area} shift.`;
  const payload = scheduleNotificationPayload({
    assignmentId: assignment.id,
    shiftId: assignment.shiftId,
    eventId: assignment.shift.shiftGroup.event.id,
  });
  const category = categoryForScheduleNotificationType("shift_request_review") ?? undefined;
  const now = new Date();

  try {
    // Only reviewers whose row is new get a push, so a retry stays silent.
    const created = await db.notification.createManyAndReturn({
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
      select: { id: true, userId: true },
    });

    for (const row of created) {
      deferPush(sendPushToUser(row.userId, {
        title,
        subtitle: eventSummary,
        body: pushBody,
        payload,
        category,
        notificationId: row.id,
      }));
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
      event: {
        select: {
          id: true,
          summary: true,
          startsAt: true,
          endsAt: true,
          allDay: true,
          sportCode: true,
          opponent: true,
          isHome: true,
          site: true,
        },
      },
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
              id: true,
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
  await enqueueShiftReminders(group.shifts.flatMap((shift) => shift.assignments.map((assignment) => ({
    assignmentId: assignment.id,
    callStartsAt: assignment.callStartsAt ?? shift.callStartsAt ?? shift.startsAt,
  }))));
  const assignmentsByUser = new Map<string, { count: number; email: string | null; studentCallStartsAt: Date | null }>();
  for (const shift of group.shifts) for (const assignment of shift.assignments) {
    const current = assignmentsByUser.get(assignment.userId);
    assignmentsByUser.set(assignment.userId, {
      count: (current?.count ?? 0) + 1,
      email: assignment.user.email,
      studentCallStartsAt: shift.workerType === "ST"
        && !group.event.allDay
        && studentCallTimeAppliesToEvent(group.event)
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
        ? ` Call time: ${formatShiftNotifyTime(assignment.studentCallStartsAt)}.`
        : "";
      const body = `You're on ${assignment.count} ${shiftLabel} at ${group.event.summary}.${callCopy}`;
      const pushBody = `You're on ${assignment.count} ${shiftLabel}.${callCopy}`;
      const dedupeKey = `shift_group_publish:${shiftGroupId}:v${group.publishedVersion}:${userId}`;
      let notificationId: string;
      try {
        const row = await db.notification.create({
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
          select: { id: true },
        });
        notificationId = row.id;
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "P2002") return;
        throw error;
      }

      deferPush(sendPushToUser(userId, {
        title,
        subtitle: group.event.summary,
        body: pushBody,
        payload,
        category: "schedule",
        notificationId,
      }));
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

  const body = "Tap to see them.";
  await Promise.allSettled([...byUser.entries()].map(async ([userId, assignment]) => {
    const count = assignment.shiftIds.size;
    const title = `You have ${count} new ${count === 1 ? "shift" : "shifts"}`;
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
    let notificationId: string;
    try {
      const row = await db.notification.create({
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
        select: { id: true },
      });
      notificationId = row.id;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") return;
      throw error;
    }

    deferPush(sendPushToUser(userId, { title, body, payload, category: "schedule", notificationId }));
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
  const uniqueUserIds = unique(userIds);
  if (uniqueUserIds.length === 0) return;
  const [group, users] = await Promise.all([
    db.shiftGroup.findUnique({
      where: { id: shiftGroupId },
      select: {
        publishedAt: true,
        publishedVersion: true,
        event: {
          select: {
            id: true,
            summary: true,
            startsAt: true,
            endsAt: true,
            allDay: true,
            sportCode: true,
            opponent: true,
            isHome: true,
            site: true,
          },
        },
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
              select: { id: true, userId: true, callStartsAt: true },
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
  // A changed schedule re-keys each affected worker's reminder to the new
  // call time; the run for the old time finds itself superseded.
  await enqueueShiftReminders(group.shifts.flatMap((shift) => shift.assignments.map((assignment) => ({
    assignmentId: assignment.id,
    callStartsAt: assignment.callStartsAt ?? shift.callStartsAt ?? shift.startsAt,
  }))));

  const assignmentsByUser = new Map<string, { count: number; studentCallStartsAt: Date | null }>();
  for (const shift of group.shifts) for (const assignment of shift.assignments) {
    const current = assignmentsByUser.get(assignment.userId);
    assignmentsByUser.set(assignment.userId, {
      count: (current?.count ?? 0) + 1,
      studentCallStartsAt: shift.workerType === "ST"
        && !group.event.allDay
        && studentCallTimeAppliesToEvent(group.event)
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
    const shiftCount = `${count} ${count === 1 ? "shift" : "shifts"}`;
    const callCopy = assignment?.studentCallStartsAt
      ? ` Call time: ${formatShiftNotifyTime(assignment.studentCallStartsAt)}.`
      : "";
    const body = count === 0
      ? `You're no longer on the schedule for ${group.event.summary}.`
      : `Your schedule for ${group.event.summary} changed. You now have ${shiftCount}.${callCopy}`;
    const pushBody = count === 0
      ? "You're no longer on the schedule."
      : `You now have ${shiftCount}.${callCopy}`;
    const dedupeKey = `shift_group_update:${shiftGroupId}:v${group.publishedVersion}:${user.id}`;
    let notificationId: string;
    try {
      const row = await db.notification.create({
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
        select: { id: true },
      });
      notificationId = row.id;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") return;
      throw error;
    }

    deferPush(sendPushToUser(user.id, {
      title,
      subtitle: group.event.summary,
      body: pushBody,
      payload,
      category: "schedule",
      notificationId,
    }));
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

  const title = "Crew schedule updated";
  const body = `The crew schedule for ${group.event.summary} changed.`;
  const pushBody = "Tap to see who's working.";
  const payload = { eventId: group.event.id };

  await Promise.allSettled(group.event.follows.map(async ({ user }) => {
    const dedupeKey = `published_schedule:${group.event.id}:v${group.publishedVersion}:${user.id}`;
    let notificationId: string;
    try {
      const row = await db.notification.create({
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
        select: { id: true },
      });
      notificationId = row.id;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") return;
      throw error;
    }

    deferPush(sendPushToUser(user.id, {
      title,
      subtitle: group.event.summary,
      body: pushBody,
      payload,
      category: "schedule",
      notificationId,
    }));
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

type ReservationLifecycleEvent = "booked" | "updated" | "pickup_ready" | "cancelled";

/**
 * Sends an in-app notification to the requester for reservation lifecycle events.
 * For "cancelled", skips the notification if the actor is the requester (self-cancel).
 * For "booked" by the requester, the inbox row is the receipt; no push.
 * "updated" can happen many times, so callers pass the booking's `updatedAt`
 * as `version` to give each update its own row.
 */
export async function createReservationLifecycleNotification(args: {
  bookingId: string;
  bookingTitle: string;
  requesterUserId: string;
  actorUserId: string;
  event: ReservationLifecycleEvent;
  version?: Date;
}): Promise<void> {
  const { bookingId, bookingTitle, requesterUserId, actorUserId, event, version } = args;

  // Don't notify users when they cancel their own reservation
  if (event === "cancelled" && requesterUserId === actorUserId) return;

  const dedupeKey = version
    ? `${bookingId}:reservation_${event}:${version.toISOString()}`
    : `${bookingId}:reservation_${event}`;

  const configs: Record<ReservationLifecycleEvent, { type: string; title: string; body: string; pushBody: string }> = {
    booked: {
      type: "reservation_booked",
      title: "Reservation confirmed",
      body: `Your reservation "${bookingTitle}" is confirmed.`,
      pushBody: "Staff made this reservation for you.",
    },
    updated: {
      type: "reservation_updated",
      title: "Gear added to your reservation",
      body: `More gear was added to your "${bookingTitle}" reservation.`,
      pushBody: "Tap to see the updated gear list.",
    },
    pickup_ready: {
      type: "reservation_pickup_ready",
      title: "Ready for pickup",
      body: `Your "${bookingTitle}" gear is ready. Pick it up at the kiosk.`,
      pushBody: "Pick it up at the kiosk.",
    },
    cancelled: {
      type: "reservation_cancelled",
      title: "Reservation cancelled",
      body: `Your reservation "${bookingTitle}" was cancelled. The gear is no longer held.`,
      pushBody: "Your gear is no longer held.",
    },
  };

  const { type, title, body, pushBody } = configs[event];

  try {
    const [row] = await db.notification.createManyAndReturn({
      data: [{
        userId: requesterUserId,
        bookingId,
        type,
        title,
        body,
        payload: { bookingId, href: `/reservations/${bookingId}` },
        channel: "IN_APP",
        sentAt: new Date(),
        dedupeKey,
      }],
      skipDuplicates: true,
      select: { id: true },
    });
    if (!row) return;
    if (event === "booked" && requesterUserId === actorUserId) return;

    deferPush(sendPushToUser(requesterUserId, {
      title,
      subtitle: bookingTitle,
      body: pushBody,
      payload: { bookingId, href: `/reservations/${bookingId}` },
      category: "reservation",
      notificationId: row.id,
      collapseId: `reservation-${bookingId}`,
    }));
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
    bookingId: args.bookingId,
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
      href: `/checkouts/${args.bookingId}`,
      ...(args.evidenceImageUrl ? { evidenceImageUrl: args.evidenceImageUrl } : {}),
    },
    channel: "IN_APP" as const,
    sentAt: now,
    dedupeKey: `${args.bookingId}:item_report:${args.assetId}:${s.id}`,
  }));

  // A repeat report of the same asset on the same booking dedupes to the
  // existing rows; only supervisors with a new row are emailed. If the insert
  // itself fails, email everyone so the report is not lost.
  let recipients = supervisors;
  try {
    const created = await db.notification.createManyAndReturn({
      data: notifData,
      skipDuplicates: true,
      select: { userId: true },
    });
    const createdIds = new Set(created.map((row) => row.userId));
    recipients = supervisors.filter((s) => createdIds.has(s.id));
  } catch (err) {
    console.error(`[NOTIFY] Failed to batch-create item report notifications:`, err);
  }

  // Send emails concurrently (fire-and-forget, failures don't block)
  const emailPromises = recipients
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
      }, "itemReports").catch((err) =>
        console.error(`[NOTIFY] Failed to send item report email to ${s.email}:`, err)
      )
    );
  await Promise.allSettled(emailPromises);
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

// ── Shift reminders ─────────────────────────────────────────────────────────

/** How long before the effective call time a worker is reminded. */
export const SHIFT_REMINDER_LEAD_MS = 2 * 60 * 60 * 1000;

type ShiftReminderAssignment = {
  id: string;
  userId: string;
  status: string;
  callStartsAt: Date | null;
  user: { active: boolean };
  shift: {
    id: string;
    area: string;
    workerType: string;
    startsAt: Date;
    callStartsAt: Date | null;
    shiftGroup: {
      publishedAt: Date | null;
      event: { id: string; summary: string; startsAt: Date; allDay: boolean; status: string };
    };
  };
};

async function loadShiftReminderAssignment(assignmentId: string): Promise<ShiftReminderAssignment | null> {
  return db.shiftAssignment.findUnique({
    where: { id: assignmentId },
    select: {
      id: true,
      userId: true,
      status: true,
      callStartsAt: true,
      user: { select: { active: true } },
      shift: {
        select: {
          id: true,
          area: true,
          workerType: true,
          startsAt: true,
          callStartsAt: true,
          shiftGroup: {
            select: {
              publishedAt: true,
              event: { select: { id: true, summary: true, startsAt: true, allDay: true, status: true } },
            },
          },
        },
      },
    },
  }) as Promise<ShiftReminderAssignment | null>;
}

/** When the worker actually needs to be there: their call time, else the shift start. */
export function effectiveShiftCallStart(assignment: {
  callStartsAt: Date | null;
  shift: { callStartsAt: Date | null; startsAt: Date };
}): Date {
  return assignment.callStartsAt ?? assignment.shift.callStartsAt ?? assignment.shift.startsAt;
}

type ShiftReminderState =
  | { status: "scheduled"; remindAt: string }
  | { status: "superseded" | "inactive" | "passed" };

/**
 * Whether the reminder for this exact call time is still wanted, and when.
 * A run keyed to an older call time is superseded: a newer run owns it.
 */
export async function getShiftReminderTiming(args: {
  assignmentId: string;
  expectedCallStartsAt: Date;
  now?: Date;
}): Promise<ShiftReminderState> {
  const assignment = await loadShiftReminderAssignment(args.assignmentId);
  if (!assignment || !assignment.user.active) return { status: "inactive" };
  if (!(ACTIVE_ASSIGNMENT_STATUSES as string[]).includes(assignment.status)) {
    return { status: "inactive" };
  }
  const group = assignment.shift.shiftGroup;
  if (!group.publishedAt || group.event.allDay || group.event.status === "CANCELLED") return { status: "inactive" };
  const callStart = effectiveShiftCallStart(assignment);
  if (callStart.getTime() !== args.expectedCallStartsAt.getTime()) return { status: "superseded" };
  const now = args.now ?? new Date();
  if (callStart.getTime() <= now.getTime()) return { status: "passed" };
  return { status: "scheduled", remindAt: new Date(callStart.getTime() - SHIFT_REMINDER_LEAD_MS).toISOString() };
}

/** Sends the reminder if the shift still matches; idempotent per call time. */
export async function sendShiftReminder(args: {
  assignmentId: string;
  expectedCallStartsAt: Date;
  now?: Date;
}): Promise<"sent" | "duplicate" | ShiftReminderState["status"]> {
  const timing = await getShiftReminderTiming(args);
  if (timing.status !== "scheduled") return timing.status;
  const assignment = (await loadShiftReminderAssignment(args.assignmentId))!;
  const event = assignment.shift.shiftGroup.event;
  const callStart = effectiveShiftCallStart(assignment);
  const isStudent = assignment.shift.workerType === "ST";
  const time = formatAppTime(callStart);

  const title = "Shift in 2 hours";
  const pushBody = isStudent
    ? `You're on ${assignment.shift.area}. Call time ${time}.`
    : `You're on ${assignment.shift.area}. Starts ${time}.`;
  const body = isStudent
    ? `You're on the ${assignment.shift.area} shift at ${event.summary}. Call time ${time}.`
    : `You're on the ${assignment.shift.area} shift at ${event.summary}. Starts ${time}.`;
  const payload = scheduleNotificationPayload({
    assignmentId: assignment.id,
    shiftId: assignment.shift.id,
    eventId: event.id,
  });

  const [row] = await db.notification.createManyAndReturn({
    data: [{
      userId: assignment.userId,
      type: "shift_reminder",
      title,
      body,
      payload: JSON.parse(JSON.stringify(payload)),
      channel: "IN_APP",
      sentAt: args.now ?? new Date(),
      dedupeKey: `shift_reminder:${assignment.id}:${callStart.toISOString()}`,
    }],
    skipDuplicates: true,
    select: { id: true },
  });
  if (!row) return "duplicate";

  await sendPushToUser(assignment.userId, {
    title,
    subtitle: event.summary,
    body: pushBody,
    payload,
    category: "shiftReminder",
    notificationId: row.id,
  });
  return "sent";
}

/**
 * Starts reminder runs; loaded lazily because the workflow module imports this
 * one. Best-effort and never throws.
 */
async function enqueueShiftReminders(rows: Array<{ assignmentId: string; callStartsAt: Date }>): Promise<void> {
  if (rows.length === 0) return;
  try {
    const { enqueueShiftReminder } = await import("@/lib/shift-reminder-workflow");
    await Promise.allSettled(rows.map((row) => enqueueShiftReminder(row)));
  } catch (error) {
    console.error("[Schedule] failed to enqueue shift reminders", error);
  }
}
