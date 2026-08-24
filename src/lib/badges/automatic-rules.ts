import { ON_TIME_GRACE_MS } from "./types";

export const automaticCheckoutRuleKeys = [
  "checkout_family_batteries",
  "checkout_family_lenses",
  "checkout_family_audio",
  "checkout_support",
  "checkout_family_lighting",
  "checkout_families_5",
  "checkout_full_rig",
  "checkout_items_15",
  "checkout_distinct_assets",
  "checkout_weeks",
  "checkout_from_kit",
  "checkout_same_asset",
  "checkout_batteries_only",
  "checkout_event_linked",
  "checkout_multiple_events",
  "checkout_from_reservation",
  "checkout_for_shift",
  "checkout_week_burst",
  "checkout_months",
  "checkout_categories_4",
  "checkout_distinct_families",
  "checkout_full_rig_heavy",
  "checkout_item_volume",
  "checkout_mixed_inventory",
  "checkout_distinct_kits",
  "checkout_consecutive_months",
  "checkout_reserved_event",
  "checkout_distinct_events",
  "checkout_full_context",
  "checkout_for_shift_heavy",
] as const;

export const automaticTradeRuleKeys = [
  "trade_short_notice",
  "trade_both_sides",
] as const;

export const automaticReturnRuleKeys = [
  "return_long_haul",
  "return_same_day",
  "return_buzzer_beater",
  "return_reported",
  "return_damaged",
  "return_missing",
  "return_late",
  "return_due_date_changed",
  "return_on_time_clean",
  "return_clean_streak",
  "return_no_intervention",
] as const;

export const automaticShiftRuleKeys = [
  "shift_away_completed",
  "shift_before_7",
  "shift_sports",
  "shift_areas",
  "shift_doubleheader_days",
  "shift_after_22",
  "shift_wins",
  "shift_losses",
  "shift_home",
  "shift_neutral",
  "shift_venues",
  "shift_same_venue",
  "shift_opponents",
  "shift_same_opponent",
  "shift_conflicts",
  "shift_sport_area_pairs",
  "shift_months",
  "shift_home_and_away",
  "shift_spectrum",
  "shift_away_wins",
  "shift_result_sites",
  "shift_early_late_mix",
  "shift_scored_sports",
  "shift_winning_record",
  "shift_win_streak",
  "shift_bounce_back",
  "shift_battle_tested",
  "shift_sites",
] as const;

export const automaticMeasuredRuleKeys = new Set<string>([
  "category_collector",
  ...automaticCheckoutRuleKeys,
  ...automaticReturnRuleKeys,
  ...automaticTradeRuleKeys,
  ...automaticShiftRuleKeys,
]);

/** A checkout held at least this long is a long-haul custody. */
const LONG_HAUL_MS = 7 * 24 * 60 * 60 * 1000;

/** How close to the due moment a return has to land to count as a buzzer beater. */
const BUZZER_WINDOW_MS = 5 * 60 * 1000;

/** A claim inside this window before the shift starts is short-notice cover. */
const SHORT_NOTICE_MS = 24 * 60 * 60 * 1000;

type CategoryEvidence = {
  id: string;
  name: string;
  parent: { name: string } | null;
} | null;

export type CheckoutBadgeEvidence = {
  startsAt: Date;
  kitId: string | null;
  eventId?: string | null;
  sourceReservationId?: string | null;
  shiftAssignmentId?: string | null;
  events?: Array<{ eventId: string }>;
  serializedItems: Array<{
    assetId: string;
    asset: { category: CategoryEvidence };
  }>;
  bulkItems: Array<{
    checkedOutQuantity: number;
    bulkSku: { categoryRel: CategoryEvidence };
  }>;
};

export type ReturnBadgeEvidence = {
  startsAt: Date;
  endsAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  /** At most one row is needed; presence is what decides a clean return. */
  checkinReports: Array<{ id: string; type?: string }>;
  dueDateChanges?: Array<{ id: string }>;
};

export type TradeBadgeEvidence = {
  postedByUserId?: string | null;
  claimedByUserId: string | null;
  claimedAt: Date | null;
  shiftAssignment: { shift: { startsAt: Date } };
};

export type ShiftBadgeEvidence = {
  callStartsAt: Date | null;
  callEndsAt: Date | null;
  hasConflict?: boolean;
  /**
   * Whether the row's clock times describe a real work window. False for
   * evidence derived from an all-day event, whose midnight boundaries are a
   * date rather than hours worked. Defaults to true.
   */
  hoursKnown?: boolean;
  shift: {
    startsAt: Date;
    endsAt: Date;
    callStartsAt: Date | null;
    callEndsAt: Date | null;
    area: string;
    shiftGroup: {
      event: {
        /** Identity, carried so evidence can be deduplicated by event. No rule reads it. */
        id?: string;
        isHome: boolean | null;
        sportCode: string | null;
        result?: string | null;
        site?: string | null;
        locationId?: string | null;
        opponent?: string | null;
      };
    };
  };
};

function increment(counts: Map<string, number>, ruleKey: string) {
  counts.set(ruleKey, (counts.get(ruleKey) ?? 0) + 1);
}

function normalizedFamily(category: CategoryEvidence) {
  return (category?.parent?.name ?? category?.name ?? "").trim().toLowerCase();
}

/**
 * Counts only checkouts whose credit was frozen by an immutable event receipt.
 * Bulk items qualify only when at least one piece was actually handed out.
 */
export function checkoutAutomaticRuleCounts(bookings: CheckoutBadgeEvidence[], timeZone: string) {
  const counts = new Map<string, number>();
  const distinctCategoryIds = new Set<string>();
  const distinctFamilyNames = new Set<string>();
  const distinctAssetIds = new Set<string>();
  const distinctKitIds = new Set<string>();
  const distinctEventIds = new Set<string>();
  const checkoutsByAssetId = new Map<string, number>();
  const checkoutsPerWeek = new Map<string, number>();
  const weekKeys = new Set<string>();
  const monthCounts = new Map<string, number>();
  let totalItemVolume = 0;
  for (const ruleKey of automaticCheckoutRuleKeys) counts.set(ruleKey, 0);

  for (const booking of bookings) {
    const serializedCategories = booking.serializedItems.map((item) => item.asset.category);
    const checkedOutBulkItems = booking.bulkItems.filter((item) => item.checkedOutQuantity > 0);
    const bulkCategories = checkedOutBulkItems.map((item) => item.bulkSku.categoryRel);
    const categories = [...serializedCategories, ...bulkCategories];
    const families = new Set(categories.map(normalizedFamily).filter(Boolean));
    const linkedEventIds = new Set([
      ...(booking.eventId ? [booking.eventId] : []),
      ...(booking.events ?? []).map((event) => event.eventId),
    ]);

    if (linkedEventIds.size > 0) increment(counts, "checkout_event_linked");
    if (linkedEventIds.size >= 2) increment(counts, "checkout_multiple_events");
    if (booking.sourceReservationId) increment(counts, "checkout_from_reservation");
    if (booking.shiftAssignmentId) increment(counts, "checkout_for_shift");
    if (booking.sourceReservationId && linkedEventIds.size > 0) {
      increment(counts, "checkout_reserved_event");
    }
    if (booking.sourceReservationId && booking.shiftAssignmentId && linkedEventIds.size > 0) {
      increment(counts, "checkout_full_context");
    }
    for (const eventId of linkedEventIds) distinctEventIds.add(eventId);

    for (const category of categories) {
      if (category?.id) distinctCategoryIds.add(category.id);
    }
    for (const family of families) distinctFamilyNames.add(family);

    if (families.has("batteries")) increment(counts, "checkout_family_batteries");
    if (families.has("lenses")) increment(counts, "checkout_family_lenses");
    if (families.has("audio")) increment(counts, "checkout_family_audio");
    if (families.has("tripods") || families.has("gimbal")) increment(counts, "checkout_support");
    if (families.has("lighting")) increment(counts, "checkout_family_lighting");
    if (families.size >= 5) increment(counts, "checkout_families_5");
    if (new Set(categories.map((category) => category?.id).filter(Boolean)).size >= 4) {
      increment(counts, "checkout_categories_4");
    }
    if (families.has("cameras") && families.has("lenses") && families.has("audio")) {
      increment(counts, "checkout_full_rig");
    }

    const itemCount = booking.serializedItems.length
      + checkedOutBulkItems.reduce((total, item) => total + item.checkedOutQuantity, 0);
    totalItemVolume += itemCount;
    if (itemCount >= 15) increment(counts, "checkout_items_15");
    if (families.has("cameras") && families.has("lenses") && families.has("audio") && itemCount >= 10) {
      increment(counts, "checkout_full_rig_heavy");
    }
    if (booking.serializedItems.length > 0 && checkedOutBulkItems.length > 0) {
      increment(counts, "checkout_mixed_inventory");
    }
    if (booking.shiftAssignmentId && itemCount >= 10) {
      increment(counts, "checkout_for_shift_heavy");
    }

    if (booking.kitId) {
      increment(counts, "checkout_from_kit");
      distinctKitIds.add(booking.kitId);
    }
    // An empty family set means nothing identifiable was handed out, which is
    // not the same thing as a battery run.
    if (families.size === 1 && families.has("batteries")) increment(counts, "checkout_batteries_only");

    const weekKey = localWeekKey(booking.startsAt, timeZone);
    weekKeys.add(weekKey);
    checkoutsPerWeek.set(weekKey, (checkoutsPerWeek.get(weekKey) ?? 0) + 1);
    const monthKey = localParts(booking.startsAt, timeZone).date.slice(0, 7);
    monthCounts.set(monthKey, (monthCounts.get(monthKey) ?? 0) + 1);

    for (const assetId of new Set(booking.serializedItems.map((item) => item.assetId))) {
      distinctAssetIds.add(assetId);
      checkoutsByAssetId.set(assetId, (checkoutsByAssetId.get(assetId) ?? 0) + 1);
    }
  }

  counts.set("category_collector", distinctCategoryIds.size);
  counts.set("checkout_distinct_assets", distinctAssetIds.size);
  counts.set("checkout_weeks", weekKeys.size);
  counts.set("checkout_same_asset", Math.max(0, ...checkoutsByAssetId.values()));
  counts.set("checkout_week_burst", Math.max(0, ...checkoutsPerWeek.values()));
  counts.set("checkout_months", monthCounts.size);
  counts.set("checkout_distinct_families", distinctFamilyNames.size);
  counts.set("checkout_item_volume", totalItemVolume);
  counts.set("checkout_distinct_kits", distinctKitIds.size);
  counts.set("checkout_consecutive_months", longestConsecutiveMonthRun(monthCounts.keys()));
  counts.set("checkout_distinct_events", distinctEventIds.size);
  return counts;
}

/**
 * Recognition read from the return moment itself rather than from a count of
 * returns. All three run before the on-time early return in the evaluator: a
 * long custody and a same-day turnaround are true whether or not the gear came
 * back on time.
 */
export function returnAutomaticRuleCounts(bookings: ReturnBadgeEvidence[], timeZone: string) {
  const counts = new Map<string, number>();
  for (const ruleKey of automaticReturnRuleKeys) counts.set(ruleKey, 0);

  for (const booking of bookings) {
    const completedAt = booking.completedAt ?? booking.updatedAt;
    const heldMs = completedAt.getTime() - booking.startsAt.getTime();
    const hasReports = booking.checkinReports.length > 0;

    if (hasReports) increment(counts, "return_reported");
    if (booking.checkinReports.some((report) => report.type === "DAMAGED")) {
      increment(counts, "return_damaged");
    }
    if (booking.checkinReports.some((report) => report.type === "LOST")) {
      increment(counts, "return_missing");
    }
    if (completedAt.getTime() > booking.endsAt.getTime() + ON_TIME_GRACE_MS) {
      increment(counts, "return_late");
    }
    if ((booking.dueDateChanges?.length ?? 0) > 0) {
      increment(counts, "return_due_date_changed");
    }
    const onTime = completedAt.getTime() <= booking.endsAt.getTime() + ON_TIME_GRACE_MS;
    if (onTime && !hasReports) increment(counts, "return_on_time_clean");
    if (!hasReports && (booking.dueDateChanges?.length ?? 0) === 0) {
      increment(counts, "return_no_intervention");
    }

    if (heldMs >= LONG_HAUL_MS && !hasReports) {
      increment(counts, "return_long_haul");
    }

    if (localParts(booking.startsAt, timeZone).date === localParts(completedAt, timeZone).date) {
      increment(counts, "return_same_day");
    }

    // Strictly at or before the due moment. The 15-minute on-time grace makes a
    // late return forgivable; it does not make it a buzzer beater.
    const msToSpare = booking.endsAt.getTime() - completedAt.getTime();
    if (msToSpare >= 0 && msToSpare <= BUZZER_WINDOW_MS) {
      increment(counts, "return_buzzer_beater");
    }
  }

  const ordered = [...bookings].sort((a, b) => {
    const aTime = (a.completedAt ?? a.updatedAt).getTime();
    const bTime = (b.completedAt ?? b.updatedAt).getTime();
    return aTime - bTime;
  });
  let cleanStreak = 0;
  let longestCleanStreak = 0;
  for (const booking of ordered) {
    const completedAt = booking.completedAt ?? booking.updatedAt;
    const onTime = completedAt.getTime() <= booking.endsAt.getTime() + ON_TIME_GRACE_MS;
    if (onTime && booking.checkinReports.length === 0) {
      cleanStreak += 1;
      longestCleanStreak = Math.max(longestCleanStreak, cleanStreak);
    } else {
      cleanStreak = 0;
    }
  }
  counts.set("return_clean_streak", longestCleanStreak);

  return counts;
}

/**
 * Recognition for picking a shift up late, credited to the person who claimed
 * it rather than to the person who posted it.
 *
 * A claim recorded at or after the shift start is not counted. It usually means
 * the trade was written down after the fact, and the system cannot tell that
 * apart from someone actually stepping in mid-shift.
 */
export function tradeAutomaticRuleCounts(trades: TradeBadgeEvidence[], userId: string) {
  const counts = new Map<string, number>();
  counts.set("trade_short_notice", 0);
  counts.set("trade_both_sides", 0);
  let posted = false;
  let claimed = false;

  for (const trade of trades) {
    if (trade.postedByUserId === userId) posted = true;
    if (trade.claimedByUserId === userId) claimed = true;
    if (trade.claimedByUserId !== userId || !trade.claimedAt) continue;

    const noticeMs = trade.shiftAssignment.shift.startsAt.getTime() - trade.claimedAt.getTime();
    if (noticeMs >= 0 && noticeMs <= SHORT_NOTICE_MS) increment(counts, "trade_short_notice");
  }

  if (posted && claimed) counts.set("trade_both_sides", 1);

  return counts;
}

/**
 * Monday-anchored week key in institution time. Derived from the local date
 * rather than from UTC, so a Sunday-night checkout is not filed under the
 * following week.
 */
function localWeekKey(date: Date, timeZone: string) {
  const [year = 1970, month = 1, day = 1] = localParts(date, timeZone).date.split("-").map(Number);
  const anchor = new Date(Date.UTC(year, month - 1, day, 12));
  const weekday = (anchor.getUTCDay() + 6) % 7;
  anchor.setUTCDate(anchor.getUTCDate() - weekday);
  return anchor.toISOString().slice(0, 10);
}

function localParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    hour: Number(value("hour") || -1),
  };
}

function longestConsecutiveMonthRun(monthKeys: Iterable<string>) {
  const indexes = [...new Set(monthKeys)]
    .map((key) => {
      const parts = key.split("-").map(Number);
      const year = parts[0] ?? 1970;
      const month = parts[1] ?? 1;
      return year * 12 + month - 1;
    })
    .sort((a, b) => a - b);
  let longest = 0;
  let current = 0;
  let previous: number | null = null;
  for (const index of indexes) {
    current = previous !== null && index === previous + 1 ? current + 1 : 1;
    longest = Math.max(longest, current);
    previous = index;
  }
  return longest;
}

export function shiftAutomaticRuleCounts(assignments: ShiftBadgeEvidence[], timeZone: string) {
  const counts = new Map<string, number>();
  const sportCodes = new Set<string>();
  const areas = new Set<string>();
  const assignmentsByLocalDate = new Map<string, number>();
  const venueCounts = new Map<string, number>();
  const opponentCounts = new Map<string, number>();
  const sportAreaPairs = new Set<string>();
  const monthKeys = new Set<string>();
  const scoredSports = new Set<string>();
  const sites = new Set<string>();
  const winningSites = new Set<string>();
  let hasHome = false;
  let hasAway = false;
  let earlyStarts = 0;
  let lateFinishes = 0;
  for (const ruleKey of automaticShiftRuleKeys) counts.set(ruleKey, 0);

  for (const assignment of assignments) {
    const event = assignment.shift.shiftGroup.event;
    const isAway = event.site === "AWAY" || (event.site == null && event.isHome === false);
    const isHome = event.site === "HOME" || (event.site == null && event.isHome === true);
    if (isAway) {
      increment(counts, "shift_away_completed");
      hasAway = true;
    }
    if (isHome) hasHome = true;

    if (assignment.hasConflict) increment(counts, "shift_conflicts");
    if (event.result === "WIN") increment(counts, "shift_wins");
    if (event.result === "LOSS") increment(counts, "shift_losses");
    if (event.result === "WIN" && event.site) winningSites.add(event.site);
    if (isHome) {
      increment(counts, "shift_home");
    }
    if (event.site === "NEUTRAL") increment(counts, "shift_neutral");
    if (event.site) sites.add(event.site);

    const venueId = event.locationId?.trim();
    if (venueId) venueCounts.set(venueId, (venueCounts.get(venueId) ?? 0) + 1);

    const opponent = event.opponent?.trim().toLowerCase();
    if (opponent) opponentCounts.set(opponent, (opponentCounts.get(opponent) ?? 0) + 1);

    const hoursKnown = assignment.hoursKnown !== false;
    const effectiveStart = assignment.callStartsAt
      ?? assignment.shift.callStartsAt
      ?? assignment.shift.startsAt;
    const start = localParts(effectiveStart, timeZone);
    if (hoursKnown && start.hour >= 0 && start.hour < 7) increment(counts, "shift_before_7");

    const sportCode = assignment.shift.shiftGroup.event.sportCode?.trim();
    const normalizedSport = sportCode?.toLowerCase() ?? "";
    if (normalizedSport) sportCodes.add(normalizedSport);
    const area = (assignment.shift.area ?? "").trim().toLowerCase();
    if (area) areas.add(area);
    if (normalizedSport && area) sportAreaPairs.add(`${normalizedSport}:${area}`);
    monthKeys.add(start.date.slice(0, 7));
    if (event.result === "WIN" || event.result === "LOSS") {
      if (normalizedSport) scoredSports.add(normalizedSport);
    }

    assignmentsByLocalDate.set(start.date, (assignmentsByLocalDate.get(start.date) ?? 0) + 1);

    // A shift that crossed local midnight was necessarily still running during
    // the 11 p.m. hour, so it counts without its end hour reaching 22.
    const effectiveEnd = assignment.callEndsAt
      ?? assignment.shift.callEndsAt
      ?? assignment.shift.endsAt;
    if (hoursKnown && effectiveEnd) {
      const end = localParts(effectiveEnd, timeZone);
      if (end.hour >= 22 || end.date > start.date) increment(counts, "shift_after_22");
      if (end.hour >= 22 || end.date > start.date) lateFinishes += 1;
    }
    if (hoursKnown && start.hour >= 0 && start.hour < 7) earlyStarts += 1;
  }

  counts.set("shift_sports", sportCodes.size);
  counts.set("shift_areas", areas.size);
  counts.set("shift_venues", venueCounts.size);
  counts.set("shift_same_venue", Math.max(0, ...venueCounts.values()));
  counts.set("shift_opponents", opponentCounts.size);
  counts.set("shift_same_opponent", Math.max(0, ...opponentCounts.values()));
  counts.set(
    "shift_doubleheader_days",
    [...assignmentsByLocalDate.values()].filter((total) => total >= 2).length,
  );
  counts.set("shift_sport_area_pairs", sportAreaPairs.size);
  counts.set("shift_months", monthKeys.size);
  counts.set("shift_home_and_away", hasHome && hasAway ? 1 : 0);
  counts.set("shift_spectrum", sportCodes.size >= 5 && areas.size >= 3 ? 1 : 0);
  counts.set(
    "shift_away_wins",
    assignments.filter((assignment) => {
      const event = assignment.shift.shiftGroup.event;
      return event.result === "WIN" && (event.site === "AWAY" || (event.site == null && event.isHome === false));
    }).length,
  );
  counts.set(
    "shift_result_sites",
    winningSites.has("HOME") && winningSites.has("AWAY") && winningSites.has("NEUTRAL") ? 1 : 0,
  );
  counts.set("shift_early_late_mix", earlyStarts >= 3 && lateFinishes >= 5 ? 1 : 0);
  counts.set("shift_scored_sports", scoredSports.size);

  const ordered = [...assignments].sort((a, b) => a.shift.startsAt.getTime() - b.shift.startsAt.getTime());
  const wins = ordered.filter((assignment) => assignment.shift.shiftGroup.event.result === "WIN").length;
  const losses = ordered.filter((assignment) => assignment.shift.shiftGroup.event.result === "LOSS").length;
  counts.set("shift_winning_record", wins >= 8 && wins > losses ? 1 : 0);
  let winStreak = 0;
  let longestWinStreak = 0;
  let bouncedBack = false;
  let sawLoss = false;
  for (const assignment of ordered) {
    const result = assignment.shift.shiftGroup.event.result;
    if (result === "WIN") {
      winStreak += 1;
      longestWinStreak = Math.max(longestWinStreak, winStreak);
      if (sawLoss) bouncedBack = true;
    } else {
      winStreak = 0;
      if (result === "LOSS") sawLoss = true;
    }
  }
  counts.set("shift_win_streak", longestWinStreak);
  counts.set("shift_bounce_back", bouncedBack ? 1 : 0);
  counts.set("shift_battle_tested", wins >= 3 && losses >= 3 ? 1 : 0);
  counts.set("shift_sites", sites.size);

  return counts;
}
