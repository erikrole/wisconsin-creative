import { db } from "@/lib/db";
import { buildNotificationEmail } from "@/lib/email";
import { loadCheckoutPolicies } from "@/lib/services/checkout-policies";
import { formatAppTime } from "@/lib/app-time";
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
import { displayBookingTitle } from "@/lib/booking-display-title";
import {
  deferPush,
  sendPushToUser,
  sendEmailToUser,
  DEFAULT_SCHEDULE,
  formatRelative,
} from "./notification-delivery";

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
          bookingTitle: displayBookingTitle(args.checkout.title),
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
      // Gear due after a night event crosses +4h around 2-4 AM. The holder
      // still hears it; staff follow-ups wait silently for the morning.
      quietOvernight: args.recipientKind !== "requester",
    }));
  }
  if (channels.email && args.recipient.email) {
    await sendEmailToUser(args.recipient.id, {
      to: args.recipient.email,
      // Email has no subtitle line, so the subject names the checkout.
      subject: `${args.title}: ${args.checkout.title}`,
      ...buildNotificationEmail({
        kind: "checkout",
        title: args.title,
        body: args.body,
        bookingTitle: displayBookingTitle(args.checkout.title),
        dueAt: args.checkout.endsAt.toISOString(),
        href: `/checkouts/${args.checkout.id}`,
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
      checkoutTitle: displayBookingTitle(args.checkout.title),
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
