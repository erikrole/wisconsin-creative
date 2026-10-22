"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useConfirm } from "@/components/ConfirmDialog";
import { FilterChip } from "@/components/FilterChip";
import {
  TradeBoardView,
  type BoardAction,
  type BoardNotice,
  type BoardRow,
  type BoardTab,
  type BoardTabSpec,
} from "@/components/trade-board/TradeBoardView";
import type { BadgeProps } from "@/components/ui/badge";
import { scheduleEventTitleParts } from "@/app/(app)/schedule/_components/types";
import { AREA_LABELS } from "@/types/areas";
import { formatCalendarEventAllDayLabel } from "@/lib/calendar-event-dates";
import { formatDateShort, formatTimeShort } from "@/lib/format";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import { studentCallTimeAppliesToEvent } from "@/lib/shift-call-windows";

type TradeEvent = {
  id: string;
  summary: string;
  startsAt: string;
  endsAt: string;
  allDay?: boolean | null;
  sportCode: string | null;
  opponent?: string | null;
  isHome?: boolean | null;
  site?: "HOME" | "AWAY" | "NEUTRAL" | null;
};

type TradeShift = {
  id: string;
  area: string;
  workerType: string;
  startsAt: string;
  endsAt: string;
  callStartsAt?: string | null;
  callEndsAt?: string | null;
  shiftGroup: { event: TradeEvent };
};

type TradeAssignment = {
  id: string;
  shift: TradeShift;
  callStartsAt?: string | null;
  callEndsAt?: string | null;
  user: { id: string; name: string; primaryArea: string | null };
};

type AvailabilityContext = {
  state: "blocked" | "advisory" | "preferred";
  label: string;
  detail: string;
  blocking: boolean;
};

type Trade = {
  id: string;
  status: string;
  notes: string | null;
  postedAt: string;
  claimedAt: string | null;
  shiftAssignment: TradeAssignment;
  postedBy: { id: string; name: string };
  claimedBy: { id: string; name: string } | null;
  reviewEscalatesAt?: string | null;
  reviewAutoApprovesAt?: string | null;
  viewerAvailabilityContext?: AvailabilityContext | null;
  claimedByAvailabilityContext?: AvailabilityContext | null;
  viewerCanClaim?: boolean;
  viewerClaimReason?: string | null;
};

type Props = {
  currentUserId: string;
  currentUserRole: string;
  initialStatusFilter?: string;
  onChanged?: () => void | Promise<void>;
};

type OpenWorkShift = {
  id: string;
  kind: "open_shift";
  action: "claim" | "none";
  canAct: boolean;
  reason: string;
  score: number | null;
  bucket: string | null;
  advisoryConflict: boolean;
  advisoryConflictNote: string | null;
  availabilityContext: AvailabilityContext | null;
  warnings: Array<{ code: string; label: string; weight?: number }>;
  ownRequestId: string | null;
  requestCount: number;
  shift: TradeShift & {
    callStartsAt: string | null;
    callEndsAt: string | null;
    shiftGroup: TradeShift["shiftGroup"] & {
      id: string;
      publishedAt: string | null;
    };
  };
};

type PickupRequest = {
  id: string;
  kind: "pickup_request";
  status: string;
  hasConflict: boolean;
  conflictNote: string | null;
  createdAt: string;
  reviewEscalatesAt?: string | null;
  reviewAutoApprovesAt?: string | null;
  user: { id: string; name: string; primaryArea: string | null; avatarUrl?: string | null };
  shift: OpenWorkShift["shift"];
};

type OpenWorkResponse = {
  openShifts: OpenWorkShift[];
  pickupRequests: PickupRequest[];
};

/** One row of the Admin review queue, whichever record it came from. */
type ReviewQueueItem =
  | { kind: "request"; key: string; startsAtMs: number; request: PickupRequest }
  | { kind: "trade"; key: string; startsAtMs: number; trade: Trade };

const AREAS = ["VIDEO", "PHOTO", "GRAPHICS", "SOCIAL", "COMMS", "LIVE_PRODUCTION"] as const;

const STATUS_META: Record<string, { label: string; variant: BadgeProps["variant"]; helper: string }> = {
  OPEN: {
    label: "Open",
    variant: "green",
    helper: "Available to claim",
  },
  CLAIMED: {
    label: "Claimed",
    variant: "orange",
    helper: "Claimed trade",
  },
  COMPLETED: {
    label: "Completed",
    variant: "gray",
    helper: "Swap complete",
  },
  CANCELLED: {
    label: "Cancelled",
    variant: "red",
    helper: "No longer available",
  },
};

const TRADE_OUTCOME_COPY = {
  claimTrade: {
    server: "Could not claim the trade. Refresh the Trade Board and try again.",
    network: "The response was lost. Check the refreshed work before trying again.",
  },
  approveTrade: {
    server: "Could not approve the trade. The shift assignment was not changed.",
    network: "The response was lost. Check the refreshed work before trying again.",
  },
  declineTrade: {
    server: "Could not decline the trade. The claim stayed in review.",
    network: "The response was lost. Check the refreshed work before trying again.",
  },
  approveRequest: {
    server: "Could not approve the request. Nobody was added to the shift.",
    network: "The response was lost. Check the refreshed work before trying again.",
  },
  declineRequest: {
    server: "Could not decline the request. It stayed in review.",
    network: "The response was lost. Check the refreshed work before trying again.",
  },
  cancelTrade: {
    server: "Could not cancel the trade. The shift stays assigned to the poster.",
    network: "The response was lost. Check the refreshed work before trying again.",
  },
  withdrawClaim: {
    server: "Could not withdraw the claim. Refresh the Trade Board and try again.",
    network: "The response was lost. Check the refreshed work before trying again.",
  },
  withdrawRequest: {
    server: "Could not withdraw the request. Refresh the Trade Board and try again.",
    network: "The response was lost. Check the refreshed work before trying again.",
  },
  claimShift: {
    server: "Could not claim the shift. Refresh the Trade Board and try again.",
    network: "The response was lost. Check the refreshed work before trying again.",
  },
} as const;

function statusMeta(status: string) {
  return STATUS_META[status] ?? {
    label: status,
    variant: "gray" as BadgeProps["variant"],
    helper: "Trade status",
  };
}

function formatShiftWindow(shift: Pick<TradeShift, "startsAt" | "endsAt" | "workerType" | "shiftGroup">) {
  // An all-day event's shift inherits the event's own UTC-midnight boundary,
  // so reading a clock off it prints 7:00 PM the evening before. Such a shift
  // has no call time to state -- it is the whole day.
  if (shift.shiftGroup?.event.allDay) {
    return formatCalendarEventAllDayLabel(shift.shiftGroup.event) || "All day";
  }
  const useEventWindow = shift.workerType === "ST"
    && !studentCallTimeAppliesToEvent(shift.shiftGroup.event);
  const startsAt = useEventWindow ? shift.shiftGroup.event.startsAt : shift.startsAt;
  const endsAt = useEventWindow ? shift.shiftGroup.event.endsAt : shift.endsAt;
  const starts = new Date(startsAt);
  const ends = new Date(endsAt);
  const sameDay = starts.toDateString() === ends.toDateString();
  const date = formatDateShort(startsAt);
  const startTime = formatTimeShort(startsAt);
  const endTime = formatTimeShort(endsAt);

  if (sameDay) return `${date}, ${startTime} - ${endTime}`;
  return `${date}, ${startTime} - ${formatDateShort(endsAt)}, ${endTime}`;
}

/** "2:00 PM – 7:00 PM"; the date lives on the row's date tile. */
function formatShiftTimes(shift: Pick<TradeShift, "startsAt" | "endsAt" | "workerType" | "shiftGroup">) {
  if (shift.shiftGroup?.event.allDay) return "All day";
  const useEventWindow = shift.workerType === "ST"
    && !studentCallTimeAppliesToEvent(shift.shiftGroup.event);
  const startsAt = useEventWindow ? shift.shiftGroup.event.startsAt : shift.startsAt;
  const endsAt = useEventWindow ? shift.shiftGroup.event.endsAt : shift.endsAt;
  const sameDay = new Date(startsAt).toDateString() === new Date(endsAt).toDateString();
  return sameDay
    ? `${formatTimeShort(startsAt)} – ${formatTimeShort(endsAt)}`
    : `${formatTimeShort(startsAt)} – ${formatDateShort(endsAt)}, ${formatTimeShort(endsAt)}`;
}

function canViewerClaimTrade(trade: Trade, isStaff: boolean) {
  if (typeof trade.viewerCanClaim === "boolean") return trade.viewerCanClaim;
  return !isStaff && !trade.viewerAvailabilityContext?.blocking;
}

function tradeCancelContext(trade: Trade) {
  return shiftActionContext(trade.shiftAssignment.shift);
}

function shiftActionContext(shift: Pick<TradeShift, "startsAt" | "endsAt" | "workerType" | "shiftGroup">) {
  const event = shift.shiftGroup.event;
  const titleParts = scheduleEventTitleParts({
    summary: event.summary,
    sportCode: event.sportCode,
    opponent: event.opponent ?? null,
    isHome: event.isHome ?? null,
  });
  return {
    eventLabel: titleParts.detail ? `${titleParts.title} (${titleParts.detail})` : titleParts.title,
    windowLabel: formatShiftWindow(shift),
  };
}

/**
 * When the shift actually starts for whoever works it: personal call window,
 * then the slot's call window, then the shift itself — the same precedence the
 * server uses to decide staleness and review deadlines.
 */
function effectiveStartMs(
  shift: Pick<TradeShift, "startsAt" | "callStartsAt">,
  assignmentCallStartsAt?: string | null,
) {
  const raw = assignmentCallStartsAt ?? shift.callStartsAt ?? shift.startsAt;
  const parsed = new Date(raw).getTime();
  // An unparseable timestamp sorts last rather than poisoning the comparator.
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
}

/**
 * The same deadline means different things to the two people looking at it.
 * Admins need to know the clock runs out on them; the person waiting needs to
 * know the wait ends without knowing which way.
 *
 * Both stay on "check", never "will be approved". The deadline runs the same
 * conflict, availability, and refill re-checks a human approval does, and a 4xx
 * from any of them stands the claim down for Admin instead of forcing it
 * through — so an auto-approval is attempted at this time, not promised.
 */
function reviewDeadlineCopy(
  at: string | null | undefined,
  audience: "reviewer" | "claimant",
) {
  if (!at) return null;
  const when = `${formatDateShort(at)}, ${formatTimeShort(at)}`;
  return audience === "reviewer"
    ? `Auto-approval check by ${when} if nobody reviews it.`
    : `Auto-approval check by ${when}. You are not on the schedule until a decision lands.`;
}

export default function TradeBoard({ currentUserId, currentUserRole, initialStatusFilter = "", onChanged }: Props) {
  const confirm = useConfirm();
  const [trades, setTrades] = useState<Trade[]>([]);
  const [openWork, setOpenWork] = useState<OpenWorkResponse>({ openShifts: [], pickupRequests: [] });
  const [loading, setLoading] = useState(true);
  const [openWorkLoading, setOpenWorkLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [openWorkError, setOpenWorkError] = useState(false);
  const [needsReview, setNeedsReview] = useState(false);
  const uncertainRef = useRef(false);
  const [acting, setActing] = useState<string | null>(null);
  const actingRef = useRef<string | null>(null);
  const loadSeqRef = useRef(0);
  const openWorkSeqRef = useRef(0);

  const [areaFilter, setAreaFilter] = useState("");
  const [tab, setTab] = useState<BoardTab | null>(null);

  const isStaff = currentUserRole === "ADMIN" || currentUserRole === "STAFF";
  const canReview = currentUserRole === "ADMIN";

  const loadTrades = useCallback(async () => {
    const requestId = loadSeqRef.current + 1;
    loadSeqRef.current = requestId;
    setLoading(true);

    try {
      const params = new URLSearchParams({ limit: "100" });
      if (areaFilter) params.set("area", areaFilter);

      const res = await fetch(`/api/shift-trades?${params}`, { cache: "no-store" });
      if (handleAuthRedirect(res)) return false;
      if (requestId !== loadSeqRef.current) return false;

      if (res.ok) {
        const json = await parseJsonSafely<{ data?: Trade[] }>(res);
        if (!Array.isArray(json?.data)) {
          setLoadError(true);
          return false;
        }
        setTrades(json.data ?? []);
        setLoadError(false);
        return true;
      } else {
        setLoadError(true);
      }
    } catch {
      if (requestId === loadSeqRef.current) setLoadError(true);
      return false;
    } finally {
      if (requestId === loadSeqRef.current) setLoading(false);
    }
    return false;
  }, [areaFilter]);

  const loadOpenWork = useCallback(async () => {
    const requestId = openWorkSeqRef.current + 1;
    openWorkSeqRef.current = requestId;
    setOpenWorkLoading(true);

    try {
      const params = new URLSearchParams();
      if (areaFilter) params.set("area", areaFilter);

      const res = await fetch(`/api/schedule/open-work?${params}`, { cache: "no-store" });
      if (handleAuthRedirect(res)) return false;
      if (requestId !== openWorkSeqRef.current) return false;

      if (res.ok) {
        const json = await parseJsonSafely<{ data?: OpenWorkResponse }>(res);
        if (!Array.isArray(json?.data?.openShifts) || !Array.isArray(json?.data?.pickupRequests)) {
          setOpenWorkError(true);
          return false;
        }
        setOpenWork(json.data);
        setOpenWorkError(false);
        return true;
      } else {
        setOpenWorkError(true);
      }
    } catch {
      if (requestId === openWorkSeqRef.current) setOpenWorkError(true);
      return false;
    } finally {
      if (requestId === openWorkSeqRef.current) setOpenWorkLoading(false);
    }
    return false;
  }, [areaFilter]);

  useEffect(() => {
    void loadTrades();
  }, [loadTrades]);

  useEffect(() => {
    void loadOpenWork();
  }, [loadOpenWork]);

  // A trade the viewer claimed has to survive the student filter: it is neither
  // OPEN nor theirs to post, and dropping it took Withdraw off the board.
  const filteredTrades = isStaff
    ? trades
    : trades.filter(
      (trade) => trade.status === "OPEN"
        || trade.postedBy.id === currentUserId
        || trade.claimedBy?.id === currentUserId,
    );
  const filteredOpenShifts = openWork.openShifts;

  // Admins owe a decision on every claimed trade and every pending request.
  // Urgency is the shift, not the post, so the queue runs soonest-first.
  const tradesAwaitingReview = canReview
    ? filteredTrades.filter((trade) => trade.status === "CLAIMED")
    : [];
  const requestsAwaitingReview = canReview ? openWork.pickupRequests : [];
  const reviewQueue: ReviewQueueItem[] = [
    ...requestsAwaitingReview.map((request): ReviewQueueItem => ({
      kind: "request",
      key: `request:${request.id}`,
      startsAtMs: effectiveStartMs(request.shift),
      request,
    })),
    ...tradesAwaitingReview.map((trade): ReviewQueueItem => ({
      kind: "trade",
      key: `trade:${trade.id}`,
      startsAtMs: effectiveStartMs(trade.shiftAssignment.shift, trade.shiftAssignment.callStartsAt),
      trade,
    })),
  ].sort((a, b) => a.startsAtMs - b.startsAtMs);

  // The server scopes pickupRequests to every row for Admin and to the
  // viewer's own rows for everyone else.
  const myPendingRequests = canReview ? [] : openWork.pickupRequests;
  const myPendingClaims = canReview
    ? []
    : filteredTrades.filter(
      (trade) => trade.status === "CLAIMED" && trade.claimedBy?.id === currentUserId,
    );

  const claimableOpenShifts = filteredOpenShifts.filter((item) => item.action === "claim");
  const unavailableOpenShifts = filteredOpenShifts.filter((item) => item.action === "none");
  const blockedClaimableTrades = filteredTrades.filter((trade) =>
    !isStaff
    && trade.status === "OPEN"
    && trade.postedBy.id !== currentUserId
    && !canViewerClaimTrade(trade, isStaff)
  );
  const claimableTrades = filteredTrades.filter((trade) =>
    trade.status === "OPEN" && trade.postedBy.id !== currentUserId
    && canViewerClaimTrade(trade, isStaff)
  );
  const myTradePosts = filteredTrades.filter((trade) =>
    trade.postedBy.id === currentUserId && (trade.status === "OPEN" || trade.status === "CLAIMED")
  );
  const resolvedTrades = filteredTrades.filter((trade) => trade.status === "COMPLETED" || trade.status === "CANCELLED");
  const postedTrades = filteredTrades.filter((trade) =>
    !claimableTrades.some((item) => item.id === trade.id)
    && !blockedClaimableTrades.some((item) => item.id === trade.id)
    && !myTradePosts.some((item) => item.id === trade.id)
    && !resolvedTrades.some((item) => item.id === trade.id)
    && !tradesAwaitingReview.some((item) => item.id === trade.id)
    && !myPendingClaims.some((item) => item.id === trade.id)
  );

  const reloadWork = useCallback(async () => {
    const results = await Promise.all([loadTrades(), loadOpenWork()]);
    void Promise.resolve().then(onChanged).catch(() => toast.error("Work refreshed; refresh Schedule to confirm its display."));
    return results.every(Boolean);
  }, [loadOpenWork, loadTrades, onChanged]);

  const recoverUncertainAction = useCallback(async () => {
    uncertainRef.current = true;
    setNeedsReview(true);
    await reloadWork();
  }, [reloadWork]);

  /**
   * A lost race (someone else claimed it first, or the shift was pulled) means
   * the row on screen is stale, so the board has to refresh or the student is
   * left staring at a Claim button that can only fail again. Rate-limit and
   * network failures have an unknown outcome. Refresh without resubmitting,
   * then require review before another action.
   */
  const isStaleWorkResponse = (status: number) =>
    status === 404 || status === 409 || status === 410;

  const beginAction = useCallback((tradeId: string) => {
    if (actingRef.current || uncertainRef.current || loadError || openWorkError) return false;
    actingRef.current = tradeId;
    setActing(tradeId);
    return true;
  }, [loadError, openWorkError]);

  const endAction = useCallback((tradeId: string) => {
    if (actingRef.current !== tradeId) return;
    actingRef.current = null;
    setActing(null);
  }, []);

  const handleClaim = useCallback(async (trade: Trade) => {
    const tradeId = trade.id;
    const { eventLabel, windowLabel } = tradeCancelContext(trade);
    const ok = await confirm({
      title: "Claim this shift?",
      message: `Claim ${eventLabel} on ${windowLabel}? An admin reviews this before you're on the schedule.`,
      confirmLabel: "Claim shift",
    });
    if (!ok || actingRef.current) return;
    if (!beginAction(tradeId)) return;
    try {
      const res = await fetch(`/api/shift-trades/${tradeId}/claim`, { method: "POST" });
      if (handleAuthRedirect(res)) return;
      if (res.status >= 500) throw new Error("Mutation outcome unavailable");
      if (res.ok) {
        toast.success("Claim sent for Admin approval");
        await reloadWork();
      } else {
        const msg = await parseErrorMessage(res, TRADE_OUTCOME_COPY.claimTrade.server);
        toast.error(msg);
        if (isStaleWorkResponse(res.status)) await reloadWork();
      }
    } catch {
      await recoverUncertainAction();
      toast.error(TRADE_OUTCOME_COPY.claimTrade.network);
    } finally {
      endAction(tradeId);
    }
  }, [beginAction, confirm, endAction, recoverUncertainAction, reloadWork]);

  const handleCancel = useCallback(async (trade: Trade) => {
    const tradeId = trade.id;
    const { eventLabel, windowLabel } = tradeCancelContext(trade);
    // Cancelling a claimed post drops someone else's pending claim. Saying only
    // "the shift stays assigned to you" hides the half of this that lands on
    // another person.
    const claimerName = trade.status === "CLAIMED" ? trade.claimedBy?.name ?? null : null;
    const ok = await confirm({
      title: "Cancel trade",
      message: claimerName
        ? `Cancel the trade posting for ${eventLabel} on ${windowLabel}? The shift stays assigned to ${trade.postedBy.name}, and ${claimerName}'s pending claim is cancelled.`
        : `Cancel the trade posting for ${eventLabel} on ${windowLabel}? The shift stays assigned to ${trade.postedBy.name}.`,
      confirmLabel: "Cancel trade",
      variant: "danger",
    });
    if (!ok || !beginAction(tradeId)) return;

    try {
      const res = await fetch(`/api/shift-trades/${tradeId}/cancel`, { method: "PATCH" });
      if (handleAuthRedirect(res)) return;
      if (res.status >= 500) throw new Error("Mutation outcome unavailable");
      if (res.ok) {
        toast.success(`Trade cancelled for ${eventLabel}`);
        await reloadWork();
      } else {
        const msg = await parseErrorMessage(res, TRADE_OUTCOME_COPY.cancelTrade.server);
        toast.error(msg);
        if (isStaleWorkResponse(res.status)) await reloadWork();
      }
    } catch {
      await recoverUncertainAction();
      toast.error(TRADE_OUTCOME_COPY.cancelTrade.network);
    } finally {
      endAction(tradeId);
    }
  }, [beginAction, confirm, endAction, recoverUncertainAction, reloadWork]);

  const handleReviewTrade = useCallback(async (tradeId: string, decision: "approve" | "decline") => {
    const actionId = `${decision}:${tradeId}`;
    if (!beginAction(actionId)) return;
    try {
      const res = await fetch(`/api/shift-trades/${tradeId}/${decision}`, { method: "PATCH" });
      if (handleAuthRedirect(res)) return;
      if (res.status >= 500) throw new Error("Mutation outcome unavailable");
      if (res.ok) {
        toast.success(decision === "approve" ? "Trade approved" : "Claim declined");
        await reloadWork();
      } else {
        const copy = decision === "approve"
          ? TRADE_OUTCOME_COPY.approveTrade
          : TRADE_OUTCOME_COPY.declineTrade;
        toast.error(await parseErrorMessage(res, copy.server));
        if (isStaleWorkResponse(res.status)) await reloadWork();
      }
    } catch {
      await recoverUncertainAction();
      toast.error(decision === "approve"
        ? TRADE_OUTCOME_COPY.approveTrade.network
        : TRADE_OUTCOME_COPY.declineTrade.network);
    } finally {
      endAction(actionId);
    }
  }, [beginAction, endAction, recoverUncertainAction, reloadWork]);

  const handleReviewRequest = useCallback(async (request: PickupRequest, decision: "approve" | "decline") => {
    const actionId = `${decision}:${request.id}`;
    if (!beginAction(actionId)) return;
    try {
      const res = await fetch(`/api/shift-assignments/${request.id}/${decision}`, { method: "PATCH" });
      if (handleAuthRedirect(res)) return;
      if (res.status >= 500) throw new Error("Mutation outcome unavailable");
      if (res.ok) {
        toast.success(decision === "approve"
          ? `${request.user.name} is on the schedule`
          : `Request declined for ${request.user.name}`);
        await reloadWork();
      } else {
        const copy = decision === "approve"
          ? TRADE_OUTCOME_COPY.approveRequest
          : TRADE_OUTCOME_COPY.declineRequest;
        toast.error(await parseErrorMessage(res, copy.server));
        if (isStaleWorkResponse(res.status)) await reloadWork();
      }
    } catch {
      await recoverUncertainAction();
      toast.error(decision === "approve"
        ? TRADE_OUTCOME_COPY.approveRequest.network
        : TRADE_OUTCOME_COPY.declineRequest.network);
    } finally {
      endAction(actionId);
    }
  }, [beginAction, endAction, recoverUncertainAction, reloadWork]);

  const handleWithdrawClaim = useCallback(async (trade: Trade) => {
    const actionId = `withdraw-claim:${trade.id}`;
    const { eventLabel, windowLabel } = tradeCancelContext(trade);
    const ok = await confirm({
      title: "Withdraw claim",
      message: `Withdraw your claim for ${eventLabel} on ${windowLabel}? The post will return to the Trade Board.`,
      confirmLabel: "Withdraw claim",
      variant: "danger",
    });
    if (!ok || actingRef.current) return;
    if (!beginAction(actionId)) return;

    try {
      const res = await fetch(`/api/shift-trades/${trade.id}/withdraw`, { method: "PATCH" });
      if (handleAuthRedirect(res)) return;
      if (res.status >= 500) throw new Error("Mutation outcome unavailable");
      if (res.ok) {
        toast.success("Claim withdrawn; the trade is back on the board");
        await reloadWork();
      } else {
        const msg = await parseErrorMessage(res, TRADE_OUTCOME_COPY.withdrawClaim.server);
        toast.error(msg);
        if (isStaleWorkResponse(res.status)) await reloadWork();
      }
    } catch {
      await recoverUncertainAction();
      toast.error(TRADE_OUTCOME_COPY.withdrawClaim.network);
    } finally {
      endAction(actionId);
    }
  }, [beginAction, confirm, endAction, recoverUncertainAction, reloadWork]);

  const handleWithdrawRequest = useCallback(async (request: PickupRequest) => {
    const actionId = `withdraw-request:${request.id}`;
    const { eventLabel, windowLabel } = shiftActionContext(request.shift);
    const ok = await confirm({
      title: "Withdraw request",
      message: `Withdraw your request for ${eventLabel} on ${windowLabel}? You will no longer be considered for this shift.`,
      confirmLabel: "Withdraw request",
      variant: "danger",
    });
    if (!ok || actingRef.current) return;
    if (!beginAction(actionId)) return;

    try {
      const res = await fetch(`/api/shift-assignments/${request.id}/withdraw`, { method: "PATCH" });
      if (handleAuthRedirect(res)) return;
      if (res.status >= 500) throw new Error("Mutation outcome unavailable");
      if (res.ok) {
        toast.success("Request withdrawn");
        await reloadWork();
      } else {
        const msg = await parseErrorMessage(res, TRADE_OUTCOME_COPY.withdrawRequest.server);
        toast.error(msg);
        if (isStaleWorkResponse(res.status)) await reloadWork();
      }
    } catch {
      await recoverUncertainAction();
      toast.error(TRADE_OUTCOME_COPY.withdrawRequest.network);
    } finally {
      endAction(actionId);
    }
  }, [beginAction, confirm, endAction, recoverUncertainAction, reloadWork]);

  const handlePickup = useCallback(async (shift: OpenWorkShift) => {
    const { eventLabel, windowLabel } = shiftActionContext(shift.shift);
    const ok = await confirm({
      title: "Claim this open shift?",
      message: `Claim ${eventLabel} on ${windowLabel}? An admin reviews this before you're on the schedule.`,
      confirmLabel: "Claim shift",
    });
    if (!ok || actingRef.current) return;
    const actionId = `pickup:${shift.id}`;
    if (!beginAction(actionId)) return;
    try {
      const res = await fetch("/api/shift-assignments/pickup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shiftId: shift.id }),
      });
      if (handleAuthRedirect(res)) return;
      if (res.status >= 500) throw new Error("Mutation outcome unavailable");
      if (res.ok) {
        toast.success("Request sent for Admin approval");
        await reloadWork();
      } else {
        const msg = await parseErrorMessage(res, TRADE_OUTCOME_COPY.claimShift.server);
        toast.error(msg);
        if (isStaleWorkResponse(res.status)) await reloadWork();
      }
    } catch {
      await recoverUncertainAction();
      toast.error(TRADE_OUTCOME_COPY.claimShift.network);
    } finally {
      endAction(actionId);
    }
  }, [beginAction, confirm, endAction, recoverUncertainAction, reloadWork]);

  const titleOf = (shift: TradeShift) => {
    const event = shift.shiftGroup.event;
    return scheduleEventTitleParts({
      summary: event.summary,
      sportCode: event.sportCode,
      opponent: event.opponent ?? null,
      isHome: event.isHome ?? null,
    });
  };
  const blocked = loadError || openWorkError || needsReview;
  const anyBusy = acting !== null || blocked;
  const action = (
    id: string,
    label: string,
    busyLabel: string,
    variant: BoardAction["variant"],
    onClick: () => void,
    disabled = false,
  ): BoardAction => ({
    label,
    busyLabel,
    variant,
    busy: acting === id,
    disabled: anyBusy || disabled,
    onClick,
  });
  const base = (
    key: string,
    shift: TradeShift,
    callStartsAt?: string | null,
  ) => {
    const parts = titleOf(shift);
    const startsAt = new Date(effectiveStartMs(shift, callStartsAt)).toISOString();
    return {
      key,
      startsAt: Number.isFinite(effectiveStartMs(shift, callStartsAt)) ? startsAt : shift.startsAt,
      title: parts.title,
      detail: parts.detail,
      times: formatShiftTimes(shift),
      area: AREA_LABELS[shift.area] ?? shift.area,
    };
  };
  const availabilityNotice = (context?: AvailabilityContext | null): BoardNotice[] =>
    context
      ? [{ tone: context.blocking ? "block" : "warn", text: `${context.label}. ${context.detail}` }]
      : [];
  const bySoonest = (a: BoardRow, b: BoardRow) => a.startsAt.localeCompare(b.startsAt);

  const tradeToRow = (trade: Trade, mode: "claim" | "blocked" | "mine" | "watch" | "waiting" | "review" | "done"): BoardRow => {
    const shift = trade.shiftAssignment.shift;
    const row = base(`trade:${trade.id}:${mode}`, shift, trade.shiftAssignment.callStartsAt);
    const poster = { name: trade.postedBy.name };
    const common = { ...row, note: trade.notes, muted: false, status: null, actions: [] as BoardAction[], notices: [] as BoardNotice[] };
    if (mode === "claim") {
      return {
        ...common,
        person: poster,
        summary: `${trade.postedBy.name} can't work this`,
        notices: availabilityNotice(trade.viewerAvailabilityContext),
        actions: [action(trade.id, "Claim", "Claiming…", "primary", () => void handleClaim(trade))],
      };
    }
    if (mode === "blocked") {
      return {
        ...common,
        person: poster,
        summary: `${trade.postedBy.name} can't work this`,
        muted: true,
        status: { label: "Can't claim", variant: "gray" },
        notices: trade.viewerAvailabilityContext
          ? availabilityNotice(trade.viewerAvailabilityContext)
          : trade.viewerClaimReason ? [{ tone: "info", text: trade.viewerClaimReason }] : [],
      };
    }
    if (mode === "mine") {
      const claimed = trade.status === "CLAIMED";
      return {
        ...common,
        person: trade.claimedBy ? { name: trade.claimedBy.name } : poster,
        summary: claimed
          ? `${trade.claimedBy?.name ?? "Someone"} claimed it. Waiting on an admin`
          : "Posted. You keep the shift until someone claims it and an admin approves",
        status: claimed ? { label: "Claimed", variant: "orange" } : { label: "Open", variant: "green" },
        menuAction: action(trade.id, "Cancel post", "Cancelling…", "danger", () => void handleCancel(trade)),
      };
    }
    if (mode === "waiting") {
      const deadline = reviewDeadlineCopy(trade.reviewAutoApprovesAt, "claimant");
      return {
        ...common,
        person: poster,
        summary: `Your claim on ${trade.postedBy.name}'s shift`,
        status: { label: "Pending", variant: "orange" },
        notices: deadline ? [{ tone: "info", text: deadline }] : [],
        actions: [action(`withdraw-claim:${trade.id}`, "Withdraw claim", "Withdrawing…", "outline", () => void handleWithdrawClaim(trade))],
      };
    }
    if (mode === "review") {
      const deadline = reviewDeadlineCopy(trade.reviewAutoApprovesAt, "reviewer");
      return {
        ...common,
        person: trade.claimedBy ? { name: trade.claimedBy.name } : poster,
        summary: `${trade.claimedBy?.name ?? "Someone"} wants ${trade.postedBy.name}'s shift`,
        status: { label: "Needs review", variant: "orange" },
        notices: [
          ...availabilityNotice(trade.claimedByAvailabilityContext),
          ...(deadline ? [{ tone: "info" as const, text: deadline }] : []),
        ],
        actions: [
          action(`approve:${trade.id}`, "Approve", "Approving…", "primary", () => void handleReviewTrade(trade.id, "approve")),
          action(`decline:${trade.id}`, "Decline", "Declining…", "outline", () => void handleReviewTrade(trade.id, "decline")),
        ],
      };
    }
    const meta = statusMeta(trade.status);
    return {
      ...common,
      person: poster,
      summary: trade.claimedBy
        ? `${trade.postedBy.name} → ${trade.claimedBy.name}`
        : `Posted by ${trade.postedBy.name}`,
      muted: mode === "done",
      status: { label: meta.label, variant: meta.variant },
    };
  };

  const openShiftToRow = (item: OpenWorkShift): BoardRow => {
    const row = base(`open:${item.id}`, item.shift, item.shift.callStartsAt);
    const claimable = item.action === "claim";
    const warning = claimable
      ? (item.availabilityContext ? null : item.advisoryConflictNote ?? item.warnings[0]?.label ?? null)
      : item.reason || item.advisoryConflictNote || item.warnings[0]?.label || null;
    return {
      ...row,
      person: null,
      summary: item.requestCount > 0
        ? `Open slot · ${item.requestCount} ${item.requestCount === 1 ? "request" : "requests"} so far`
        : "Open slot nobody holds yet",
      note: null,
      muted: !claimable,
      status: claimable ? { label: "Open", variant: "green" } : { label: "Can't claim", variant: "gray" },
      notices: [
        ...(warning ? [{ tone: claimable ? "warn" as const : "info" as const, text: warning }] : []),
        ...(claimable ? availabilityNotice(item.availabilityContext) : []),
      ],
      actions: claimable
        ? [action(`pickup:${item.id}`, "Claim", "Claiming…", "primary", () => void handlePickup(item), !item.canAct)]
        : [],
    };
  };

  const requestToRow = (request: PickupRequest, mode: "review" | "waiting"): BoardRow => {
    const row = base(`request:${request.id}:${mode}`, request.shift, request.shift.callStartsAt);
    const deadline = reviewDeadlineCopy(request.reviewAutoApprovesAt, mode === "review" ? "reviewer" : "claimant");
    const notices: BoardNotice[] = [
      ...(request.conflictNote ? [{ tone: "warn" as const, text: request.conflictNote }] : []),
      ...(deadline ? [{ tone: "info" as const, text: deadline }] : []),
    ];
    return {
      ...row,
      person: { name: request.user.name, avatarUrl: request.user.avatarUrl },
      summary: mode === "review" ? `${request.user.name} wants this open slot` : "Your request for this open slot",
      note: null,
      muted: false,
      status: mode === "review"
        ? { label: "Needs review", variant: "orange" }
        : { label: "Pending", variant: "orange" },
      notices,
      actions: mode === "review"
        ? [
          action(`approve:${request.id}`, "Approve", "Approving…", "primary", () => void handleReviewRequest(request, "approve")),
          action(`decline:${request.id}`, "Decline", "Declining…", "outline", () => void handleReviewRequest(request, "decline")),
        ]
        : [action(`withdraw-request:${request.id}`, "Withdraw request", "Withdrawing…", "outline", () => void handleWithdrawRequest(request))],
    };
  };

  // Trades and open slots are two records but one job, so each tab sorts them
  // together by the shift's real start.
  const availableRows = [
    ...claimableOpenShifts.map(openShiftToRow),
    ...claimableTrades.map((trade) => tradeToRow(trade, "claim")),
    ...postedTrades.filter((trade) => trade.status !== "COMPLETED" && trade.status !== "CANCELLED").map((trade) => tradeToRow(trade, "watch")),
  ].sort(bySoonest);
  const unavailableRows = [
    ...unavailableOpenShifts.map(openShiftToRow),
    ...blockedClaimableTrades.map((trade) => tradeToRow(trade, "blocked")),
  ].sort(bySoonest);
  const mineRows = [
    ...myTradePosts.map((trade) => tradeToRow(trade, "mine")),
    ...myPendingClaims.map((trade) => tradeToRow(trade, "waiting")),
    ...myPendingRequests.map((request) => requestToRow(request, "waiting")),
  ].sort(bySoonest);
  const reviewRows = reviewQueue.map((item) =>
    item.kind === "request" ? requestToRow(item.request, "review") : tradeToRow(item.trade, "review"),
  );
  const historyRows = resolvedTrades.map((trade) => tradeToRow(trade, "done")).sort((a, b) => b.startsAt.localeCompare(a.startsAt));

  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const tabs: BoardTabSpec[] = [
    ...(canReview ? [{
      id: "review" as const,
      label: "Review",
      count: reviewRows.length,
      rows: reviewRows,
      summary: reviewRows.length ? `${reviewRows.length} waiting on you` : null,
    }] : []),
    {
      id: "available",
      label: "Available",
      count: availableRows.length,
      rows: [...availableRows, ...unavailableRows],
      summary: availableRows.length ? plural(availableRows.length, "shift you can pick up", "shifts you can pick up") : null,
    },
    { id: "mine", label: "Mine", count: mineRows.length, rows: mineRows, summary: mineRows.length ? `${mineRows.length} in motion` : null },
    { id: "history", label: "History", count: 0, rows: historyRows },
  ];
  const defaultTab: BoardTab = initialStatusFilter === "CLAIMED" && canReview
    ? "review"
    : canReview && reviewRows.length > 0 ? "review" : "available";
  const activeTab = tab ?? defaultTab;

  const errors = [
    ...(loadError ? [{ text: "Trade posts did not load. What you see may be stale.", retryLabel: "Retry", onRetry: () => void loadTrades(), busy: loading }] : []),
    ...(openWorkError ? [{ text: "Open slots did not load. What you see may be stale.", retryLabel: "Retry", onRetry: () => void loadOpenWork(), busy: openWorkLoading }] : []),
  ];

  return (
    <TradeBoardView
      tabs={tabs}
      tab={tabs.some((item) => item.id === activeTab) ? activeTab : "available"}
      onTab={setTab}
      loading={loading || openWorkLoading}
      errors={errors}
      needsReview={needsReview ? {
        busy: loading || openWorkLoading,
        onReview: async () => {
          if (await reloadWork()) {
            uncertainRef.current = false;
            setNeedsReview(false);
          }
        },
      } : null}
      intro={isStaff ? null : "Claim open shifts and trades in your area. An admin approves every change before it reaches the schedule."}
      toolbar={(
        <FilterChip
          label="Area"
          value={areaFilter}
          displayValue={areaFilter ? AREA_LABELS[areaFilter] ?? areaFilter : ""}
          options={AREAS.map((area) => ({ value: area, label: AREA_LABELS[area] ?? area }))}
          onSelect={(value) => setAreaFilter(value)}
          onClear={() => setAreaFilter("")}
        />
      )}
    />
  );
}
