/* Home: pure view-model builders. Everything the page shows is derived here so
   the dev preview and the live page render the same rows from the same rules. */

import { formatCountdownCompact, formatDueLabel, formatOperationalDateTime, isDueToday } from "@/lib/format";
import { isFullDayBoundaryWindow } from "@/lib/shift-call-windows";
import type { ShiftTradeAction } from "@/lib/shift-trade-actions";
import { AREA_LABELS } from "@/types/areas";
import type { BookingSummary, DashboardData, DashboardStats, CreateBookingContext } from "../dashboard-types";
import { dashboardEventTitle } from "../dashboard/event-title";

export type HomeRole = "STUDENT" | "STAFF" | "ADMIN" | "COLLABORATOR";

export type HomeTone = "critical" | "warning" | "info" | "neutral";

/** The slice of a Trade Board row Home reads. */
export type HomeTrade = {
  id: string;
  status: string;
  viewerCanClaim?: boolean;
  postedBy: { id: string; name: string } | null;
  claimedBy: { id: string; name: string } | null;
  shiftAssignment: {
    shift: {
      area: string;
      shiftGroup: {
        event: {
          id: string;
          summary: string;
          startsAt: string;
          sportCode: string | null;
          opponent: string | null;
          isHome: boolean | null;
        };
      };
    };
  };
};

export type AttentionTarget =
  | { kind: "link"; href: string }
  | { kind: "booking"; bookingId: string }
  | { kind: "report"; reportId: string }
  | { kind: "create"; context: CreateBookingContext };

/** A one-tap decision a row can offer, confirmed before it is sent. */
export type QuickAction = {
  label: string;
  tradeId: string;
  action: ShiftTradeAction;
  confirmTitle: string;
  confirmMessage: string;
  confirmLabel: string;
};

export type AttentionItem = {
  id: string;
  tone: HomeTone;
  icon: "overdue" | "due" | "pickup" | "trade" | "gear" | "damage" | "draft" | "lost";
  title: string;
  detail: string;
  action: string;
  target: AttentionTarget;
  quick?: QuickAction;
  /** Staff can send the borrower an overdue reminder from the row. */
  remind?: { bookingId: string; person: string };
};

export type SummaryMetric = {
  id: string;
  label: string;
  value: number | null;
  detail: string;
  href: string;
  tone: HomeTone;
};

export type UpNextItem = {
  id: string;
  kind: "shift" | "pickup" | "event";
  startsAt: string;
  allDay: boolean;
  time: string;
  title: string;
  detail: string;
  badge: { label: string; tone: HomeTone } | null;
  target: AttentionTarget;
};

export type GearRow = {
  id: string;
  title: string;
  detail: string;
  due: string;
  tone: HomeTone;
  person: string | null;
};

export type CoverageRow = {
  id: string;
  title: string;
  when: string;
  filled: number;
  total: number;
};

export type TradeRow = {
  id: string;
  title: string;
  detail: string;
  quick?: QuickAction;
};

export const PENDING_PICKUP_HREF = "/bookings?tab=checkouts&status=PENDING_PICKUP";
export const TRADE_BOARD_HREF = "/schedule?trades=open";
export const TRADE_APPROVAL_HREF = "/schedule?queue=trade-approval";

export function homeRole(role: string | null | undefined): HomeRole | null {
  if (role === "STUDENT" || role === "STAFF" || role === "ADMIN" || role === "COLLABORATOR") return role;
  return null;
}

export function isTeamRole(role: HomeRole | null) {
  return role === "STAFF" || role === "ADMIN";
}

export function greeting(now: Date, name: string | null | undefined) {
  const hour = now.getHours();
  const part = hour < 5 ? "evening" : hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  const first = name?.trim().split(/\s+/)[0];
  return first ? `Good ${part}, ${first}` : `Good ${part}`;
}

export function todayLabel(now: Date) {
  return now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

function eventTitle(event: { summary: string; sportCode: string | null; opponent: string | null; isHome: boolean | null }) {
  return dashboardEventTitle({ title: event.summary, sportCode: event.sportCode, opponent: event.opponent, isHome: event.isHome });
}

function areaLabel(area: string) {
  return AREA_LABELS[area] ?? area;
}

/* ── Summary ────────────────────────────────────────────── */

/**
 * Four numbers, chosen per role. Fast stats feed the first paint; the full
 * payload replaces them when it lands. Null renders as a dash, never as zero.
 */
export function buildSummary(input: {
  role: HomeRole;
  data: DashboardData | null;
  stats: DashboardStats | null;
  openTradeCount: number | null;
}): SummaryMetric[] {
  const { role, data, stats, openTradeCount } = input;
  if (isTeamRole(role)) {
    const counts = data?.stats ?? stats?.stats ?? null;
    const pendingPickup = data?.pendingPickups.total ?? stats?.pendingPickupTotal ?? null;
    const overdue = counts?.overdue ?? null;
    const dueToday = counts?.dueToday ?? null;
    return [
      { id: "overdue", label: "Overdue", value: overdue, detail: "Past their return time", href: "/checkouts?filter=overdue", tone: overdue ? "critical" : "neutral" },
      { id: "due-today", label: "Due today", value: dueToday, detail: "Coming back today", href: "/bookings?tab=checkouts&filter=due-today", tone: dueToday ? "warning" : "neutral" },
      { id: "pending-pickup", label: "Pending pickup", value: pendingPickup, detail: "Pickup time has passed", href: PENDING_PICKUP_HREF, tone: pendingPickup ? "warning" : "neutral" },
      { id: "checked-out", label: "Checked out", value: counts?.checkedOut ?? null, detail: `${counts ? plural(counts.reserved, "reservation") : "Reservations"} ahead`, href: "/bookings?tab=checkouts&status=OPEN", tone: "neutral" },
    ];
  }
  const now = new Date();
  const mine = data?.myCheckouts ?? null;
  const gearOut = mine?.total ?? stats?.myCheckoutsTotal ?? null;
  const myOverdue = mine?.overdue ?? stats?.myOverdueCount ?? null;
  const myDueToday = mine
    ? mine.items.filter((b) => !b.isOverdue && isDueToday(b.endsAt, now)).length
    : stats?.myDueTodayCount ?? null;
  const shifts = data ? data.myShifts.length : stats?.myShiftsCount ?? null;
  return [
    { id: "gear-out", label: "Gear out", value: gearOut, detail: myOverdue ? `${myOverdue} overdue` : "Checked out to you", href: "/checkouts?mine=true", tone: myOverdue ? "critical" : "neutral" },
    { id: "due-today", label: "Due today", value: myDueToday, detail: "Return by end of day", href: "/checkouts?mine=true", tone: myDueToday ? "warning" : "neutral" },
    { id: "shifts", label: "Upcoming shifts", value: shifts, detail: "Assigned to you", href: "/schedule?myShifts=true", tone: "neutral" },
    { id: "trades", label: "Open trades", value: openTradeCount, detail: "You can pick up", href: TRADE_BOARD_HREF, tone: "neutral" },
  ];
}

/* ── Needs attention ────────────────────────────────────── */

const ATTENTION_ORDER: Record<HomeTone, number> = { critical: 0, warning: 1, info: 2, neutral: 3 };

/**
 * One ordered list of things someone owes an action on. Students see only
 * their own work; staff see the team's custody problems and review queues.
 */
export function buildAttention(input: {
  role: HomeRole;
  data: DashboardData;
  claimedTrades: HomeTrade[];
  now: Date;
}): AttentionItem[] {
  const { role, data, claimedTrades, now } = input;
  const items: AttentionItem[] = [];
  const team = isTeamRole(role);

  // Overdue custody. Staff work the team list; everyone else, their own.
  if (team) {
    for (const o of data.overdueItems) {
      items.push({
        id: `overdue-${o.bookingId}`,
        tone: "critical",
        icon: "overdue",
        title: o.bookingTitle,
        detail: `${o.requesterName} · ${formatDueLabel(o.endsAt, now)}`,
        action: "Open",
        target: { kind: "booking", bookingId: o.bookingId },
        remind: { bookingId: o.bookingId, person: o.requesterName },
      });
    }
    const hidden = data.overdueCount - data.overdueItems.length;
    if (hidden > 0) {
      items.push({
        id: "overdue-more",
        tone: "critical",
        icon: "overdue",
        title: `${plural(hidden, "more overdue checkout")}`,
        detail: "See every checkout past its return time",
        action: "View all",
        target: { kind: "link", href: "/checkouts?filter=overdue" },
      });
    }
  } else {
    for (const b of data.myCheckouts.items.filter((c) => c.isOverdue)) {
      items.push({
        id: `my-overdue-${b.id}`,
        tone: "critical",
        icon: "overdue",
        title: `Return ${b.title}`,
        detail: `${formatDueLabel(b.endsAt, now)} · ${plural(b.itemCount, "item")}`,
        action: "Open",
        target: { kind: "booking", bookingId: b.id },
      });
    }
  }

  // Trade claims waiting on an admin decision.
  if (role === "ADMIN") {
    for (const t of claimedTrades) {
      const event = t.shiftAssignment.shift.shiftGroup.event;
      const when = formatOperationalDateTime(event.startsAt, now, { month: "short" });
      const from = t.postedBy?.name ?? "Someone";
      const to = t.claimedBy?.name ?? "the claimer";
      items.push({
        id: `trade-${t.id}`,
        tone: "warning",
        icon: "trade",
        title: `Approve trade: ${eventTitle(event)}`,
        detail: `${t.postedBy?.name ?? "Someone"} to ${t.claimedBy?.name ?? "a claimer"} · ${areaLabel(t.shiftAssignment.shift.area)} · ${formatOperationalDateTime(event.startsAt, now, { month: "short" })}`,
        action: "Review",
        target: { kind: "link", href: TRADE_APPROVAL_HREF },
        quick: {
          label: "Approve",
          tradeId: t.id,
          action: "approve",
          confirmTitle: "Approve this trade?",
          confirmMessage: `${to} takes ${from}\u2019s ${areaLabel(t.shiftAssignment.shift.area)} shift for ${eventTitle(event)} on ${when}. Review the full queue to check availability first.`,
          confirmLabel: "Approve trade",
        },
      });
    }
  }

  // My shifts in the next week with no gear arranged.
  const weekOut = now.getTime() + 7 * 86_400_000;
  for (const w of data.myEventWork) {
    const starts = new Date(w.event.startsAt).getTime();
    if (!w.needsGear || starts > weekOut || starts < now.getTime()) continue;
    const title = eventTitle(w.event);
    items.push({
      id: `gear-${w.id}`,
      tone: "warning",
      icon: "gear",
      title: `Reserve gear for ${title}`,
      detail: `${areaLabel(w.shift.area)} · ${w.event.allDay ? dayHeading(w.event.startsAt, now, true) : formatOperationalDateTime(w.event.startsAt, now, { month: "short" })}`,
      action: "Reserve",
      target: {
        kind: "create",
        context: {
          kind: "RESERVATION",
          title,
          startsAt: w.event.startsAt,
          endsAt: w.event.endsAt,
          locationId: w.event.locationId ?? undefined,
          eventId: w.event.id,
          sportCode: w.event.sportCode ?? undefined,
        },
      },
    });
  }

  if (team) {
    for (const p of data.pendingPickups.items) {
      items.push({
        id: `pickup-${p.id}`,
        tone: "warning",
        icon: "pickup",
        title: p.title,
        detail: `${p.requesterName} · Pickup was due ${formatOperationalDateTime(p.startsAt, now, { month: "short" })}`,
        action: "Open",
        target: { kind: "booking", bookingId: p.id },
      });
    }
    for (const f of data.flaggedItems.filter((x) => x.type !== "MAINTENANCE")) {
      items.push({
        id: `flag-${f.id}`,
        tone: f.type === "LOST" ? "critical" : "warning",
        icon: "damage",
        title: `${f.type === "LOST" ? "Lost" : "Damaged"}: ${f.assetName ?? f.assetTag}`,
        detail: [f.assetTag, f.reportedBy ? `Reported by ${f.reportedBy}` : null].filter(Boolean).join(" · "),
        action: "Review",
        target: { kind: "report", reportId: f.id },
      });
    }
  }

  if (role === "ADMIN") {
    for (const l of data.lostBulkUnits) {
      items.push({
        id: `lost-${l.skuName}`,
        tone: "info",
        icon: "lost",
        title: `${plural(l.count, `${l.skuName} unit`)} marked lost`,
        detail: "Confirm the loss or restock",
        action: "Review",
        target: { kind: "link", href: "/reports/bulk-losses" },
      });
    }
  }

  // Due today, not yet overdue: a reminder, not an alarm.
  for (const b of data.myCheckouts.items) {
    if (b.isOverdue || !isDueToday(b.endsAt, now)) continue;
    items.push({
      id: `due-${b.id}`,
      tone: "info",
      icon: "due",
      title: `Return ${b.title} today`,
      detail: `${formatDueLabel(b.endsAt, now)} · ${plural(b.itemCount, "item")}`,
      action: "Open",
      target: { kind: "booking", bookingId: b.id },
    });
  }

  if (team) {
    for (const d of data.drafts) {
      items.push({
        id: `draft-${d.id}`,
        tone: "neutral",
        icon: "draft",
        title: `Finish draft: ${d.title || "Untitled reservation"}`,
        detail: `${plural(d.itemCount, "item")} · Saved ${formatOperationalDateTime(d.updatedAt, now, { month: "short" })}`,
        action: "Continue",
        target: { kind: "link", href: d.kind === "CHECKOUT" ? `/checkouts/new?draftId=${d.id}` : `/reservations/new?draftId=${d.id}` },
      });
    }
  }

  // Stable sort keeps each group's own order inside a tone.
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => ATTENTION_ORDER[a.item.tone] - ATTENTION_ORDER[b.item.tone] || a.index - b.index)
    .map(({ item }) => item);
}

/* ── Up next ────────────────────────────────────────────── */

export function buildUpNext(data: DashboardData, now: Date): UpNextItem[] {
  const rows: UpNextItem[] = [];
  for (const s of data.myShifts) {
    // Only Student assignments have a report time. Staff rows use the event's
    // own start and never call it a call time. An all-day event never has a
    // call time, whatever window a slot may still carry, so its flag decides first.
    const studentCallWindow = s.workerType === "ST" && !s.event.allDay && s.callStartsAt && s.callEndsAt
      ? { startsAt: s.callStartsAt, endsAt: s.callEndsAt }
      : null;
    const isFullDayDefault = studentCallWindow ? isFullDayBoundaryWindow(studentCallWindow) : false;
    const isAllDayDisplay = s.event.allDay || isFullDayDefault;
    const displayDate = studentCallWindow?.startsAt ?? s.event.startsAt;
    const gear = s.gearStatus === "checked_out" ? { label: "Gear out", tone: "info" as const }
      : s.gearStatus === "reserved" ? { label: "Gear reserved", tone: "neutral" as const }
      : s.gearStatus === "draft" ? { label: "Gear draft", tone: "neutral" as const }
      : null;
    rows.push({
      id: `shift-${s.id}`,
      kind: "shift",
      startsAt: displayDate,
      // Calendar-date reading applies to the event's own all-day flag only.
      allDay: s.event.allDay,
      time: isAllDayDisplay ? "All day" : formatClock(displayDate),
      title: eventTitle(s.event),
      detail: [
        areaLabel(s.area),
        // The time column already shows the call; name it so it is not read as kickoff.
        studentCallWindow && !isFullDayDefault ? "Call time" : null,
        s.event.locationName,
      ].filter(Boolean).join(" · "),
      badge: gear,
      target: { kind: "link", href: `/events/${s.event.id}` },
    });
  }
  for (const r of data.myReservations) {
    rows.push({
      id: `pickup-${r.id}`,
      kind: "pickup",
      startsAt: r.startsAt,
      allDay: false,
      time: formatClock(r.startsAt),
      title: `Pick up ${r.title}`,
      detail: [plural(r.itemCount, "item"), r.locationName].filter(Boolean).join(" · "),
      badge: new Date(r.startsAt).getTime() < now.getTime() ? { label: "Pickup was due", tone: "warning" } : null,
      target: { kind: "booking", bookingId: r.id },
    });
  }
  return rows.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()).slice(0, 8);
}

export function formatClock(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** Group key and heading for an Up next row: Today, Tomorrow, or "Fri, Oct 24". */
export function dayHeading(iso: string, now: Date, allDay = false) {
  const d = allDay ? utcCalendarDate(iso) : new Date(iso);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - start.getTime()) / 86_400_000);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function utcCalendarDate(iso: string) {
  const d = new Date(iso);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/* ── Gear and team ──────────────────────────────────────── */

/** Compact due time for a right-aligned column: "Overdue 1d 2h", "Due 5:00 PM", "Due Fri", "Due Oct 30". */
export function shortDue(endsAt: string, now: Date) {
  const end = new Date(endsAt);
  if (end.getTime() <= now.getTime()) return formatCountdownCompact(endsAt, now);
  if (isDueToday(endsAt, now)) return `Due ${formatClock(endsAt)}`;
  if (end.getTime() - now.getTime() < 6 * 86_400_000) {
    return `Due ${end.toLocaleDateString("en-US", { weekday: "short" })}`;
  }
  return `Due ${end.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

export function gearRows(bookings: BookingSummary[], now: Date, showPerson: boolean): GearRow[] {
  return bookings.map((b) => ({
    id: b.id,
    title: b.title,
    detail: plural(b.itemCount, "item"),
    due: shortDue(b.endsAt, now),
    tone: b.isOverdue ? "critical" : isDueToday(b.endsAt, now) ? "warning" : "neutral",
    person: showPerson ? b.requesterName : null,
  }));
}

export function coverageRows(data: DashboardData, now: Date): CoverageRow[] {
  return data.upcomingEvents.slice(0, 5).map((e) => ({
    id: e.id,
    title: dashboardEventTitle(e),
    when: e.allDay
      ? `${dayHeading(e.startsAt, now, true)} · All day`
      : `${dayHeading(e.startsAt, now)} · ${formatClock(e.startsAt)}`,
    filled: e.coverage?.filled ?? e.filledShiftSlots,
    total: e.coverage?.total ?? e.totalShiftSlots,
  }));
}

export function tradeRows(trades: HomeTrade[], now: Date): TradeRow[] {
  return trades.map((t) => {
    const event = t.shiftAssignment.shift.shiftGroup.event;
    const when = formatOperationalDateTime(event.startsAt, now, { month: "short" });
    return {
      id: t.id,
      title: eventTitle(event),
      detail: `${areaLabel(t.shiftAssignment.shift.area)} · ${when} · from ${t.postedBy?.name ?? "a teammate"}`,
      quick: t.viewerCanClaim
        ? {
          label: "Claim",
          tradeId: t.id,
          action: "claim",
          confirmTitle: "Claim this shift?",
          confirmMessage: `Claim ${eventTitle(event)} on ${when}? An admin reviews this before you\u2019re on the schedule.`,
          confirmLabel: "Claim shift",
        }
        : undefined,
    };
  });
}

/* ── Today ──────────────────────────────────────────────── */

/** "now", "in 45m", "in 5h", "in 2d": how soon an Up next row starts. */
export function startsIn(iso: string, now: Date) {
  const diff = new Date(iso).getTime() - now.getTime();
  if (diff <= 0) return "now";
  const minutes = Math.round(diff / 60_000);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours}h`;
  return `in ${Math.round(hours / 24)}d`;
}

/**
 * Overdue checkouts the viewer is on the hook for: the team's for staff and
 * admins, their own for everyone else. Drives the browser tab badge.
 */
export function overdueForViewer(role: HomeRole, data: DashboardData): number {
  return isTeamRole(role) ? data.overdueCount : data.myCheckouts.items.filter((c) => c.isOverdue).length;
}

export function homeTabTitle(base: string, overdue: number): string {
  return overdue > 0 ? `(${overdue}) ${base}` : base;
}

/**
 * One sentence under the greeting that says what today holds, so the page
 * answers "what do I have to do today" before anyone reads a card.
 */
export function daySummary(role: HomeRole, data: DashboardData, now: Date): string {
  const sentences: string[] = [];
  const next = buildUpNext(data, now)
    .find((r) => r.kind === "shift" && dayHeading(r.startsAt, now, r.allDay) === "Today");
  if (next) {
    sentences.push(next.allDay ? `You\u2019re on ${next.title} today.` : `You\u2019re on ${next.title} at ${next.time}.`);
  }
  const team = isTeamRole(role);
  const overdue = team ? data.stats.overdue : data.myCheckouts.items.filter((b) => b.isOverdue).length;
  const due = team
    ? data.stats.dueToday
    : data.myCheckouts.items.filter((b) => !b.isOverdue && isDueToday(b.endsAt, now)).length;
  const gear = [overdue > 0 ? `${overdue} overdue` : null, due > 0 ? `${due} due back today` : null].filter(Boolean);
  if (gear.length > 0) {
    const noun = team ? "Team gear" : "Your gear";
    sentences.push(`${noun}: ${gear.join(", ")}.`);
  }
  return sentences.length > 0 ? sentences.join(" ") : "Nothing due today. You\u2019re clear.";
}

export type TodayCrewEvent = {
  id: string;
  summary: string;
  startsAt: string;
  endsAt: string;
  when: "now" | "later" | "tomorrow";
  people: Array<{ id: string; name: string; avatarUrl: string | null; area: string }>;
};

export type CrewRow = {
  id: string;
  title: string;
  when: string;
  live: boolean;
  people: TodayCrewEvent["people"];
};

/** Today's crewed events from the Staff Today feed; tomorrow waits for tomorrow. */
export function crewRows(events: TodayCrewEvent[]): CrewRow[] {
  return events
    .filter((e) => e.when !== "tomorrow")
    .map((e) => ({
      id: e.id,
      title: e.summary,
      when: e.when === "now" ? `On now · until ${formatClock(e.endsAt)}` : `${formatClock(e.startsAt)} – ${formatClock(e.endsAt)}`,
      live: e.when === "now",
      people: e.people,
    }));
}
