export const CHECKOUT_ESCALATION_STAGE_TYPES = [
  "checkout_due_2h",
  "checkout_due_now",
  "checkout_overdue_grace",
  "checkout_overdue_4h",
  "checkout_overdue_24h",
] as const;

export type CheckoutEscalationStageType = typeof CHECKOUT_ESCALATION_STAGE_TYPES[number];
export type CheckoutEscalationRecipientKind = "requester" | "responder" | "admin";

export type CheckoutEscalationConfig = {
  maxRequesterNotificationsPerDueDate: number;
  maxOperationalNotificationsPerDueDate: number;
};

const DEFAULT_CHECKOUT_ESCALATION_CONFIG: CheckoutEscalationConfig = {
  maxRequesterNotificationsPerDueDate: 5,
  maxOperationalNotificationsPerDueDate: 20,
};

export const overdueResponderConfigKey = (locationId: string) => `overdue_responders:${locationId}`;

export function normalizeCheckoutEscalationConfig(raw: unknown): CheckoutEscalationConfig {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const requester = value.maxRequesterNotificationsPerDueDate;
  const operational = value.maxOperationalNotificationsPerDueDate ?? value.maxNotificationsPerBooking;
  return {
    maxRequesterNotificationsPerDueDate: typeof requester === "number" && Number.isInteger(requester)
      ? Math.min(20, Math.max(1, requester))
      : DEFAULT_CHECKOUT_ESCALATION_CONFIG.maxRequesterNotificationsPerDueDate,
    maxOperationalNotificationsPerDueDate: typeof operational === "number" && Number.isInteger(operational)
      ? Math.min(100, Math.max(1, operational))
      : DEFAULT_CHECKOUT_ESCALATION_CONFIG.maxOperationalNotificationsPerDueDate,
  };
}

type CheckoutEscalationRuleLike = {
  hoursFromDue: number;
  type: string;
  enabled?: boolean;
  sortOrder: number;
};

export function isCheckoutEscalationStageType(value: string): value is CheckoutEscalationStageType {
  return CHECKOUT_ESCALATION_STAGE_TYPES.includes(value as CheckoutEscalationStageType);
}

export function isResponderEscalationStage(type: string): boolean {
  return type === "checkout_overdue_4h" || type === "checkout_overdue_24h";
}

export function checkoutEscalationCategory(type: string): "checkoutDue" | "checkoutOverdue" {
  return type.startsWith("checkout_due_") ? "checkoutDue" : "checkoutOverdue";
}

export function checkoutEscalationTriggerAt(
  rule: Pick<CheckoutEscalationRuleLike, "hoursFromDue" | "type">,
  dueAt: Date,
  gracePeriodHours: number,
): Date {
  const graceMs = rule.type === "checkout_overdue_grace"
    ? gracePeriodHours * 3_600_000
    : 0;
  return new Date(dueAt.getTime() + rule.hoursFromDue * 3_600_000 + graceMs);
}

export function highestEligibleCheckoutEscalationRule<T extends CheckoutEscalationRuleLike>(
  rules: readonly T[],
  dueAt: Date,
  gracePeriodHours: number,
  now: Date,
): T | null {
  return rules
    .filter((rule) => rule.enabled !== false)
    .filter((rule) => checkoutEscalationTriggerAt(rule, dueAt, gracePeriodHours) <= now)
    .sort((a, b) => {
      const triggerDelta = checkoutEscalationTriggerAt(b, dueAt, gracePeriodHours).getTime()
        - checkoutEscalationTriggerAt(a, dueAt, gracePeriodHours).getTime();
      return triggerDelta || b.sortOrder - a.sortOrder;
    })[0] ?? null;
}

export function checkoutEscalationDueVersion(dueAt: Date): string {
  return dueAt.toISOString();
}

export function checkoutEscalationDedupeKey(args: {
  bookingId: string;
  dueAt: Date;
  type: string;
  recipientKind: CheckoutEscalationRecipientKind;
  recipientId: string;
}): string {
  return [
    args.bookingId,
    checkoutEscalationDueVersion(args.dueAt),
    args.type,
    args.recipientKind,
    args.recipientId,
  ].join(":");
}

export function checkoutEscalationChannels(
  type: string,
  recipientKind: CheckoutEscalationRecipientKind,
): { push: boolean; email: boolean } {
  if (recipientKind === "admin") return { push: false, email: true };
  if (recipientKind === "responder") return { push: true, email: false };
  return {
    push: true,
    email: type === "checkout_overdue_grace"
      || type === "checkout_overdue_4h"
      || type === "checkout_overdue_24h",
  };
}
