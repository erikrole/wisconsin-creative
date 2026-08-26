import { captureBadgeError } from "@/lib/observability";

import * as evaluator from "./evaluator";
import { listEarnedBadgesSince, type EarnedBadge } from "./queries";
import type { BadgeService } from "./types";

export function badgesEnabled(): boolean {
  return process.env.BADGES_ENABLED === "true";
}

function safeCall<Args extends unknown[]>(fn: (...args: Args) => Promise<void>): (...args: Args) => Promise<void> {
  return async (...args: Args) => {
    if (!badgesEnabled()) return;

    try {
      const result = await fn(...args);
      if (result !== undefined) {
        throw new Error(`Badge evaluator ${fn.name} returned a value`);
      }
    } catch (error) {
      if (process.env.NODE_ENV !== "production") {
        throw error;
      }
      captureBadgeError(error, { evaluator: fn.name });
    }
  };
}

export const badges: BadgeService = {
  onCheckoutOpened: safeCall(evaluator.onCheckoutOpened),
  onCheckoutReturned: safeCall(evaluator.onCheckoutReturned),
  onAppOpened: safeCall(evaluator.onAppOpened),
  onTradeCompleted: safeCall(evaluator.onTradeCompleted),
  onShiftsWorked: safeCall(evaluator.onShiftsWorked),
};

export async function earnedBadgesSince(userId: string, after: Date): Promise<EarnedBadge[]> {
  if (!badgesEnabled()) return [];

  try {
    return await listEarnedBadgesSince({
      userId,
      after,
      through: new Date(),
    });
  } catch (error) {
    // Celebration is additive. A read failure must never turn a successful
    // custody mutation into a failed checkout, pickup, or return.
    captureBadgeError(error, { reader: "earnedBadgesSince", userId });
    return [];
  }
}

export type {
  AppOpenedBadgeEvent,
  BadgeEventSource,
  BadgeService,
  CheckoutOpenedBadgeEvent,
  CheckoutReturnedBadgeEvent,
  ShiftsWorkedBadgeOptions,
  ShiftsWorkedBadgeEvent,
  TradeCompletedBadgeEvent,
} from "./types";
export type { EarnedBadge } from "./queries";
