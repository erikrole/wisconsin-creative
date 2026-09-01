"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  ArrowLeftRightIcon,
  AlertTriangleIcon,
  CalendarClockIcon,
  CalendarDaysIcon,
  CheckIcon,
  Clock3Icon,
  ClipboardListIcon,
  ShieldCheckIcon,
  XIcon,
} from "lucide-react";
import { useConfirm } from "@/components/ConfirmDialog";
import EmptyState from "@/components/EmptyState";
import { FilterChip } from "@/components/FilterChip";
import { OperationalActiveFilterChips, type OperationalActiveFilter } from "@/components/OperationalToolbar";
import { OperationalRowActions } from "@/components/OperationalRowActions";
import { UserAvatar } from "@/components/UserAvatar";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { scheduleEventTitleParts } from "@/app/(app)/schedule/_components/types";
import { AREA_LABELS } from "@/types/areas";
import { formatCalendarEventAllDayLabel } from "@/lib/calendar-event-dates";
import { formatDateShort, formatTimeShort } from "@/lib/format";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import { cn } from "@/lib/utils";

type TradeEvent = {
  id: string;
  summary: string;
  startsAt: string;
  endsAt: string;
  allDay?: boolean | null;
  sportCode: string | null;
  opponent?: string | null;
  isHome?: boolean | null;
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
const TRADE_STATUSES = ["OPEN", "CLAIMED", "COMPLETED", "CANCELLED"] as const;

const STATUS_OPTIONS = [
  { value: "OPEN_SHIFT", label: "Open shifts" },
  { value: "OPEN", label: "Open" },
  { value: "CLAIMED", label: "Claimed" },
  { value: "COMPLETED", label: "Completed" },
  { value: "CANCELLED", label: "Cancelled" },
];

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
    network: "Could not reach the server. The trade was not claimed.",
  },
  approveTrade: {
    server: "Could not approve the trade. The shift assignment was not changed.",
    network: "Could not reach the server. The trade was not approved.",
  },
  declineTrade: {
    server: "Could not decline the trade. The claim stayed in review.",
    network: "Could not reach the server. The trade was not declined.",
  },
  approveRequest: {
    server: "Could not approve the request. Nobody was added to the shift.",
    network: "Could not reach the server. The request was not approved.",
  },
  declineRequest: {
    server: "Could not decline the request. It stayed in review.",
    network: "Could not reach the server. The request was not declined.",
  },
  cancelTrade: {
    server: "Could not cancel the trade. The shift stays assigned to the poster.",
    network: "Could not reach the server. The trade was not cancelled.",
  },
  withdrawClaim: {
    server: "Could not withdraw the claim. Refresh the Trade Board and try again.",
    network: "Could not reach the server. The claim was not withdrawn.",
  },
  withdrawRequest: {
    server: "Could not withdraw the request. Refresh the Trade Board and try again.",
    network: "Could not reach the server. The request was not withdrawn.",
  },
  claimShift: {
    server: "Could not claim the shift. Refresh the Trade Board and try again.",
    network: "Could not reach the server. The shift was not claimed.",
  },
} as const;

function statusMeta(status: string) {
  return STATUS_META[status] ?? {
    label: status,
    variant: "gray" as BadgeProps["variant"],
    helper: "Trade status",
  };
}

function isTradeStatus(value: string): value is typeof TRADE_STATUSES[number] {
  return (TRADE_STATUSES as readonly string[]).includes(value);
}

function formatShiftWindow(shift: Pick<TradeShift, "startsAt" | "endsAt" | "shiftGroup">) {
  // An all-day event's shift inherits the event's own UTC-midnight boundary,
  // so reading a clock off it prints 7:00 PM the evening before. Such a shift
  // has no call time to state -- it is the whole day.
  if (shift.shiftGroup?.event.allDay) {
    return formatCalendarEventAllDayLabel(shift.shiftGroup.event) || "All day";
  }
  const starts = new Date(shift.startsAt);
  const ends = new Date(shift.endsAt);
  const sameDay = starts.toDateString() === ends.toDateString();
  const date = formatDateShort(shift.startsAt);
  const startTime = formatTimeShort(shift.startsAt);
  const endTime = formatTimeShort(shift.endsAt);

  if (sameDay) return `${date}, ${startTime} - ${endTime}`;
  return `${date}, ${startTime} - ${formatDateShort(shift.endsAt)}, ${endTime}`;
}

function openShiftActionCopy(item: OpenWorkShift) {
  if (item.action === "claim") return "An admin reviews this before you're on the schedule.";
  return item.reason;
}

function tradeOutcomeCopy(trade: Trade, args: { currentUserId: string; isStaff: boolean }) {
  const isOwnTrade = trade.postedBy.id === args.currentUserId;
  if (isOwnTrade && (trade.status === "OPEN" || trade.status === "CLAIMED")) {
    return "Canceling removes the post; the shift stays assigned to you.";
  }
  if (trade.status === "OPEN") {
    return "Claiming sends this to an admin for approval; the shift stays with its owner until then.";
  }
  return statusMeta(trade.status).helper;
}

function canViewerClaimTrade(trade: Trade, isStaff: boolean) {
  if (typeof trade.viewerCanClaim === "boolean") return trade.viewerCanClaim;
  return !isStaff && !trade.viewerAvailabilityContext?.blocking;
}

function tradeCancelContext(trade: Trade) {
  return shiftActionContext(trade.shiftAssignment.shift);
}

function shiftActionContext(shift: Pick<TradeShift, "startsAt" | "endsAt" | "shiftGroup">) {
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

function TradeSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-3">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="rounded-lg border border-border/50 p-3">
          <div className="flex items-start gap-3">
            <Skeleton className="size-9 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 flex flex-col gap-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-3 w-full" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function WorkSection({
  title,
  description,
  count,
  children,
}: {
  title: string;
  description: string;
  count: number;
  children: ReactNode;
}) {
  if (count === 0) return null;

  return (
    <section className="border-b border-border/50 last:border-b-0">
      <div className="border-b border-border/40 bg-muted/30 px-4 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
          <span className="text-xs font-medium tabular-nums text-muted-foreground">
            {count}
          </span>
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
      </div>
      <div className="divide-y divide-border/50">{children}</div>
    </section>
  );
}

function AvailabilityContextNote({ context }: { context?: AvailabilityContext | null }) {
  if (!context) return null;
  const variant: BadgeProps["variant"] = context.state === "blocked"
    ? "red"
    : context.state === "preferred"
      ? "green"
      : "orange";

  return (
    <div className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/40 px-2.5 py-2 text-xs leading-relaxed text-muted-foreground">
      <AlertTriangleIcon className={cn(
        "mt-0.5 size-3.5 shrink-0",
        context.state === "blocked" ? "text-destructive" : context.state === "preferred" ? "text-[var(--green-text)]" : "text-[var(--orange-text)]",
      )} />
      <div className="min-w-0">
        <Badge variant={variant} size="sm" className="mb-1 h-5 px-1.5 text-[10px]">
          {context.label}
        </Badge>
        <p>{context.detail}</p>
      </div>
    </div>
  );
}

export default function TradeBoard({ currentUserId, currentUserRole, initialStatusFilter = "" }: Props) {
  const confirm = useConfirm();
  const [trades, setTrades] = useState<Trade[]>([]);
  const [openWork, setOpenWork] = useState<OpenWorkResponse>({ openShifts: [], pickupRequests: [] });
  const [loading, setLoading] = useState(true);
  const [openWorkLoading, setOpenWorkLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [openWorkError, setOpenWorkError] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const actingRef = useRef<string | null>(null);
  const loadSeqRef = useRef(0);
  const openWorkSeqRef = useRef(0);

  const [areaFilter, setAreaFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState(initialStatusFilter);
  const [myTradesOnly, setMyTradesOnly] = useState(false);

  const isStaff = currentUserRole === "ADMIN" || currentUserRole === "STAFF";
  const canReview = currentUserRole === "ADMIN";

  useEffect(() => {
    if (initialStatusFilter) setStatusFilter(initialStatusFilter);
  }, [initialStatusFilter]);

  const loadTrades = useCallback(async () => {
    const requestId = loadSeqRef.current + 1;
    loadSeqRef.current = requestId;
    setLoading(true);

    try {
      const params = new URLSearchParams({ limit: "100" });
      if (areaFilter) params.set("area", areaFilter);
      if (isTradeStatus(statusFilter)) params.set("status", statusFilter);

      const res = await fetch(`/api/shift-trades?${params}`);
      if (handleAuthRedirect(res)) return;
      if (requestId !== loadSeqRef.current) return;

      if (res.ok) {
        const json = await parseJsonSafely<{ data?: Trade[] }>(res);
        if (!Array.isArray(json?.data)) {
          setLoadError(true);
          return;
        }
        setTrades(json.data ?? []);
        setLoadError(false);
      } else {
        setLoadError(true);
      }
    } catch {
      if (requestId === loadSeqRef.current) setLoadError(true);
    } finally {
      if (requestId === loadSeqRef.current) setLoading(false);
    }
  }, [areaFilter, statusFilter]);

  const loadOpenWork = useCallback(async () => {
    const requestId = openWorkSeqRef.current + 1;
    openWorkSeqRef.current = requestId;
    setOpenWorkLoading(true);

    try {
      const params = new URLSearchParams();
      if (areaFilter) params.set("area", areaFilter);

      const res = await fetch(`/api/schedule/open-work?${params}`);
      if (handleAuthRedirect(res)) return;
      if (requestId !== openWorkSeqRef.current) return;

      if (res.ok) {
        const json = await parseJsonSafely<{ data?: OpenWorkResponse }>(res);
        if (!Array.isArray(json?.data?.openShifts) || !Array.isArray(json?.data?.pickupRequests)) {
          setOpenWorkError(true);
          return;
        }
        setOpenWork(json.data);
        setOpenWorkError(false);
      } else {
        setOpenWorkError(true);
      }
    } catch {
      if (requestId === openWorkSeqRef.current) setOpenWorkError(true);
    } finally {
      if (requestId === openWorkSeqRef.current) setOpenWorkLoading(false);
    }
  }, [areaFilter]);

  useEffect(() => {
    void loadTrades();
  }, [loadTrades]);

  useEffect(() => {
    void loadOpenWork();
  }, [loadOpenWork]);

  const filteredTrades = useMemo(() => {
    if (statusFilter === "OPEN_SHIFT") return [];
    let result = trades;
    if (myTradesOnly) {
      result = result.filter(
        (trade) => trade.postedBy.id === currentUserId || trade.claimedBy?.id === currentUserId,
      );
    } else if (!statusFilter && !isStaff) {
      // A trade the viewer claimed has to survive this filter: it is neither
      // OPEN nor theirs to post, and dropping it took "Waiting on Admin" — and
      // with it the only Withdraw claim button — off the default board.
      result = result.filter(
        (trade) => trade.status === "OPEN"
          || trade.postedBy.id === currentUserId
          || trade.claimedBy?.id === currentUserId,
      );
    }
    return result;
  }, [trades, statusFilter, isStaff, currentUserId, myTradesOnly]);

  const filteredOpenShifts = useMemo(() => {
    if (myTradesOnly) return [];
    if (statusFilter && statusFilter !== "OPEN_SHIFT") return [];
    return openWork.openShifts;
  }, [myTradesOnly, openWork.openShifts, statusFilter]);

  const reloadWork = useCallback(async () => {
    await Promise.all([loadTrades(), loadOpenWork()]);
  }, [loadOpenWork, loadTrades]);

  /**
   * A lost race (someone else claimed it first, or the shift was pulled) means
   * the row on screen is stale, so the board has to refresh or the student is
   * left staring at a Claim button that can only fail again. Rate-limit and
   * network failures are left alone — nothing changed server-side, and
   * reloading would just add load to a request the user should simply retry.
   */
  const isStaleWorkResponse = (status: number) =>
    status === 404 || status === 409 || status === 410;

  const beginAction = useCallback((tradeId: string) => {
    if (actingRef.current) return false;
    actingRef.current = tradeId;
    setActing(tradeId);
    return true;
  }, []);

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
      if (res.ok) {
        toast.success("Claim sent for Admin approval");
        await reloadWork();
      } else {
        const msg = await parseErrorMessage(res, TRADE_OUTCOME_COPY.claimTrade.server);
        toast.error(msg);
        if (isStaleWorkResponse(res.status)) await reloadWork();
      }
    } catch {
      toast.error(TRADE_OUTCOME_COPY.claimTrade.network);
    } finally {
      endAction(tradeId);
    }
  }, [beginAction, confirm, endAction, reloadWork]);

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
      if (res.ok) {
        toast.success(`Trade cancelled for ${eventLabel}`);
        await reloadWork();
      } else {
        const msg = await parseErrorMessage(res, TRADE_OUTCOME_COPY.cancelTrade.server);
        toast.error(msg);
        if (isStaleWorkResponse(res.status)) await reloadWork();
      }
    } catch {
      toast.error(TRADE_OUTCOME_COPY.cancelTrade.network);
    } finally {
      endAction(tradeId);
    }
  }, [beginAction, confirm, endAction, reloadWork]);

  const handleReviewTrade = useCallback(async (tradeId: string, decision: "approve" | "decline") => {
    const actionId = `${decision}:${tradeId}`;
    if (!beginAction(actionId)) return;
    try {
      const res = await fetch(`/api/shift-trades/${tradeId}/${decision}`, { method: "PATCH" });
      if (handleAuthRedirect(res)) return;
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
      toast.error(decision === "approve"
        ? TRADE_OUTCOME_COPY.approveTrade.network
        : TRADE_OUTCOME_COPY.declineTrade.network);
    } finally {
      endAction(actionId);
    }
  }, [beginAction, endAction, reloadWork]);

  const handleReviewRequest = useCallback(async (request: PickupRequest, decision: "approve" | "decline") => {
    const actionId = `${decision}:${request.id}`;
    if (!beginAction(actionId)) return;
    try {
      const res = await fetch(`/api/shift-assignments/${request.id}/${decision}`, { method: "PATCH" });
      if (handleAuthRedirect(res)) return;
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
      toast.error(decision === "approve"
        ? TRADE_OUTCOME_COPY.approveRequest.network
        : TRADE_OUTCOME_COPY.declineRequest.network);
    } finally {
      endAction(actionId);
    }
  }, [beginAction, endAction, reloadWork]);

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
      if (res.ok) {
        toast.success("Claim withdrawn; the trade is back on the board");
        await reloadWork();
      } else {
        const msg = await parseErrorMessage(res, TRADE_OUTCOME_COPY.withdrawClaim.server);
        toast.error(msg);
        if (isStaleWorkResponse(res.status)) await reloadWork();
      }
    } catch {
      toast.error(TRADE_OUTCOME_COPY.withdrawClaim.network);
    } finally {
      endAction(actionId);
    }
  }, [beginAction, confirm, endAction, reloadWork]);

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
      if (res.ok) {
        toast.success("Request withdrawn");
        await reloadWork();
      } else {
        const msg = await parseErrorMessage(res, TRADE_OUTCOME_COPY.withdrawRequest.server);
        toast.error(msg);
        if (isStaleWorkResponse(res.status)) await reloadWork();
      }
    } catch {
      toast.error(TRADE_OUTCOME_COPY.withdrawRequest.network);
    } finally {
      endAction(actionId);
    }
  }, [beginAction, confirm, endAction, reloadWork]);

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
      if (res.ok) {
        toast.success("Request sent for Admin approval");
        await reloadWork();
      } else {
        const msg = await parseErrorMessage(res, TRADE_OUTCOME_COPY.claimShift.server);
        toast.error(msg);
        if (isStaleWorkResponse(res.status)) await reloadWork();
      }
    } catch {
      toast.error(TRADE_OUTCOME_COPY.claimShift.network);
    } finally {
      endAction(actionId);
    }
  }, [beginAction, confirm, endAction, reloadWork]);

  const hasFilters = !!(areaFilter || statusFilter || myTradesOnly);
  const activeFilters: OperationalActiveFilter[] = [
    ...(areaFilter
      ? [{
        key: "area",
        label: `Area: ${AREA_LABELS[areaFilter] ?? areaFilter}`,
        onRemove: () => setAreaFilter(""),
      }]
      : []),
    ...(statusFilter
      ? [{
        key: "status",
        label: `Status: ${STATUS_OPTIONS.find((option) => option.value === statusFilter)?.label ?? statusFilter}`,
        onRemove: () => setStatusFilter(""),
      }]
      : []),
    ...(myTradesOnly
      ? [{
        key: "my-trades",
        label: "My trades",
        onRemove: () => setMyTradesOnly(false),
      }]
      : []),
  ];
  const totalRows = filteredOpenShifts.length + filteredTrades.length + openWork.pickupRequests.length;
  const isLoadingWork = loading && openWorkLoading && totalRows === 0;
  const hasAnyLoadError = loadError || openWorkError;
  const hasLoadError = loadError && openWorkError;
  const countLabel = `${totalRows} ${totalRows === 1 ? "item" : "items"}`;
  // Admins owe a decision on every claimed trade and every pending request.
  // Urgency is the shift, not the post: a claim filed this morning on a shift
  // tonight outranks one filed last week on a shift in March, so the queue runs
  // soonest-first rather than in the list order the two sources happen to use.
  const tradesAwaitingReview = canReview
    ? filteredTrades.filter((trade) => trade.status === "CLAIMED")
    : [];
  const requestsAwaitingReview = canReview ? openWork.pickupRequests : [];
  const reviewCount = tradesAwaitingReview.length + requestsAwaitingReview.length;
  // Trade claims and pickup requests are two records but one job, so they share
  // one queue and one ordering key. Rendering them as two consecutive groups
  // sorted each separately: a request four days out still landed above a claim
  // on tomorrow's shift, which looks ordered without being ordered.
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

  // A student sees what they are waiting on. The server already scopes
  // pickupRequests to all rows only for Admin and to the viewer's own rows for
  // everyone else.
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

  // Both review row shapes, so one ordered queue can render either.
  const renderReviewRequest = (request: PickupRequest) => {
    const shift = request.shift;
    const event = shift.shiftGroup.event;
    const titleParts = scheduleEventTitleParts({
      summary: event.summary,
      sportCode: event.sportCode,
      opponent: event.opponent ?? null,
      isHome: event.isHome ?? null,
    });
    const areaLabel = AREA_LABELS[shift.area] ?? shift.area;
    const isApproving = acting === `approve:${request.id}`;
    const isDeclining = acting === `decline:${request.id}`;
    const deadline = reviewDeadlineCopy(request.reviewAutoApprovesAt, "reviewer");

    return (
      <article key={`review-request-${request.id}`} className="px-4 py-3 transition-colors hover:bg-muted/25">
        <div className="flex items-start gap-3">
          <UserAvatar name={request.user.name} size="sm" className="mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1 flex flex-col gap-2">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold leading-tight">{titleParts.title}</h3>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {request.user.name} wants this slot
                </p>
              </div>
              <Badge variant="orange" size="sm">Needs review</Badge>
            </div>

            <div className="grid gap-1.5 text-xs text-muted-foreground sm:grid-cols-2">
              <span className="flex min-w-0 items-center gap-1.5">
                <CalendarClockIcon className="size-3.5 shrink-0" />
                <span className="truncate tabular-nums">{formatShiftWindow(shift)}</span>
              </span>
              <span className="flex min-w-0 items-center gap-1.5">
                <ClipboardListIcon className="size-3.5 shrink-0" />
                <span className="truncate">{areaLabel}</span>
              </span>
            </div>

            {request.conflictNote && (
              <p className="flex items-start gap-1.5 rounded-md bg-muted/50 px-2.5 py-2 text-xs leading-relaxed text-muted-foreground">
                <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                <span>{request.conflictNote}</span>
              </p>
            )}

            {deadline && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock3Icon className="size-3.5 shrink-0" />
                <span>{deadline}</span>
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button className="h-10"
                onClick={() => void handleReviewRequest(request, "approve")}
                disabled={Boolean(acting)}
              >
                {isApproving ? "Approving…" : "Approve"}
              </Button>
              <Button className="h-10"
                variant="outline"
                onClick={() => void handleReviewRequest(request, "decline")}
                disabled={Boolean(acting)}
              >
                {isDeclining ? "Declining…" : "Decline"}
              </Button>
            </div>
          </div>
        </div>
      </article>
    );
  };

  const renderReviewTrade = (trade: Trade) => {
    const shift = trade.shiftAssignment.shift;
    const event = shift.shiftGroup.event;
    const titleParts = scheduleEventTitleParts({
      summary: event.summary,
      sportCode: event.sportCode,
      opponent: event.opponent ?? null,
      isHome: event.isHome ?? null,
    });
    const areaLabel = AREA_LABELS[shift.area] ?? shift.area;
    const isApproving = acting === `approve:${trade.id}`;
    const isDeclining = acting === `decline:${trade.id}`;
    const deadline = reviewDeadlineCopy(trade.reviewAutoApprovesAt, "reviewer");

    return (
      <article key={`review-trade-${trade.id}`} className="px-4 py-3 transition-colors hover:bg-muted/25">
        <div className="flex items-start gap-3">
          <UserAvatar name={trade.claimedBy?.name ?? trade.postedBy.name} size="sm" className="mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1 flex flex-col gap-2">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold leading-tight">{titleParts.title}</h3>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {trade.claimedBy?.name ?? "Someone"} wants to take {trade.postedBy.name}&apos;s shift
                </p>
              </div>
              <Badge variant="orange" size="sm">Needs review</Badge>
            </div>

            <div className="grid gap-1.5 text-xs text-muted-foreground sm:grid-cols-2">
              <span className="flex min-w-0 items-center gap-1.5">
                <CalendarClockIcon className="size-3.5 shrink-0" />
                <span className="truncate tabular-nums">{formatShiftWindow(shift)}</span>
              </span>
              <span className="flex min-w-0 items-center gap-1.5">
                <ArrowLeftRightIcon className="size-3.5 shrink-0" />
                <span className="truncate">{areaLabel}</span>
              </span>
            </div>

            {trade.notes && (
              <p className="rounded-md bg-muted/50 px-2.5 py-2 text-xs leading-relaxed text-muted-foreground">
                {trade.notes}
              </p>
            )}
            <AvailabilityContextNote context={trade.claimedByAvailabilityContext} />

            {deadline && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock3Icon className="size-3.5 shrink-0" />
                <span>{deadline}</span>
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button className="h-10"
                onClick={() => void handleReviewTrade(trade.id, "approve")}
                disabled={Boolean(acting)}
              >
                {isApproving ? "Approving…" : "Approve trade"}
              </Button>
              <Button className="h-10"
                variant="outline"
                onClick={() => void handleReviewTrade(trade.id, "decline")}
                disabled={Boolean(acting)}
              >
                {isDeclining ? "Declining…" : "Decline"}
              </Button>
            </div>
          </div>
        </div>
      </article>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      {!isStaff && (
        <div className="flex items-start gap-2.5 rounded-md border border-border/60 bg-muted/50 px-3 py-2.5 text-sm">
          <CalendarDaysIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p className="leading-snug text-muted-foreground">
            Claim open Student shifts here, or post a trade from an assignment you already own.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <FilterChip
            label="Area"
            value={areaFilter}
            displayValue={areaFilter ? AREA_LABELS[areaFilter] ?? areaFilter : ""}
            options={AREAS.map((area) => ({ value: area, label: AREA_LABELS[area] ?? area }))}
            onSelect={(value) => setAreaFilter(value)}
            onClear={() => setAreaFilter("")}
          />
          <FilterChip
            label="Status"
            value={statusFilter}
            displayValue={STATUS_OPTIONS.find((option) => option.value === statusFilter)?.label ?? ""}
            options={STATUS_OPTIONS}
            onSelect={(value) => setStatusFilter(value)}
            onClear={() => setStatusFilter("")}
          />
          <FilterChip
            label="My trades"
            value={myTradesOnly ? "mine" : ""}
            displayValue={myTradesOnly ? "My trades" : ""}
            options={[{ value: "mine", label: "My trades" }]}
            onSelect={() => setMyTradesOnly(true)}
            onClear={() => setMyTradesOnly(false)}
          />
          {hasFilters && (
            <Button
              type="button"
              variant="ghost"
              className="h-10 rounded-full px-2.5 text-xs text-muted-foreground"
              onClick={() => {
                setAreaFilter("");
                setStatusFilter("");
                setMyTradesOnly(false);
              }}
            >
              Clear all
            </Button>
          )}
        </div>
        <OperationalActiveFilterChips filters={activeFilters} />
      </div>

      <Card elevation="flat" className="overflow-hidden border-border/60 shadow-sm">
        <CardHeader className="flex-row items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
          <CardTitle className="text-sm">Trade Board</CardTitle>
          <span className="text-xs font-medium tabular-nums text-muted-foreground">
            {hasAnyLoadError ? "Partial data" : countLabel}
          </span>
        </CardHeader>

        {hasAnyLoadError && !hasLoadError && (
          <div className="divide-y divide-border/50 border-b border-border/60 bg-[var(--orange-bg)]">
            {loadError && (
              <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span className="flex min-w-0 items-center gap-2 text-[var(--orange-text)]">
                  <AlertTriangleIcon className="size-4 shrink-0" />
                  <span>Trade Board posts are unavailable. Visible posts may be stale.</span>
                </span>
                <Button className="h-10" variant="outline" onClick={loadTrades} disabled={loading}>
                  {loading ? "Retrying..." : "Retry posts"}
                </Button>
              </div>
            )}
            {openWorkError && (
              <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span className="flex min-w-0 items-center gap-2 text-[var(--orange-text)]">
                  <AlertTriangleIcon className="size-4 shrink-0" />
                  <span>Open Student slots are unavailable. Visible slots may be stale.</span>
                </span>
                <Button className="h-10" variant="outline" onClick={loadOpenWork} disabled={openWorkLoading}>
                  {openWorkLoading ? "Retrying..." : "Retry open slots"}
                </Button>
              </div>
            )}
          </div>
        )}

        {isLoadingWork ? (
          <TradeSkeleton />
        ) : hasLoadError ? (
          <CardContent className="p-4 text-center">
            <p className="mb-3 text-sm text-muted-foreground">Open shifts did not load. Retry before acting on shift or trade coverage.</p>
            <Button className="h-10" variant="outline" onClick={reloadWork}>
              Retry
            </Button>
          </CardContent>
        ) : !hasAnyLoadError && totalRows === 0 ? (
          <EmptyState
            icon="clipboard"
            title={hasFilters ? "No matching work" : "No open shifts"}
            description={
              hasFilters
                ? "Clear or adjust the filters to see more shift and trade activity."
                : "No shifts are currently open for pickup or posted for trade. Published shifts will appear here when someone opens a slot or requests coverage."
            }
            actionLabel={hasFilters ? "Clear filters" : "View schedule"}
            actionHref={!hasFilters ? "/schedule" : undefined}
            onAction={hasFilters ? () => {
              setAreaFilter("");
              setStatusFilter("");
              setMyTradesOnly(false);
            } : undefined}
            compact
          />
        ) : totalRows > 0 ? (
          <div>
            {reviewCount > 0 && (
              <WorkSection
                title="Admin Review"
                description="Students are waiting on these. Nothing moves on the schedule until you decide."
                count={reviewCount}
              >
                {reviewQueue.map((item) => (
                  item.kind === "request"
                    ? renderReviewRequest(item.request)
                    : renderReviewTrade(item.trade)
                ))}
              </WorkSection>
            )}

            {claimableOpenShifts.length > 0 && (
              <WorkSection
                title="Open Shifts"
                description="Unassigned Student slots. Claiming sends a pickup request to an admin."
                count={claimableOpenShifts.length}
              >
              {claimableOpenShifts.map((item) => {
              const shift = item.shift;
              const event = shift.shiftGroup.event;
              const titleParts = scheduleEventTitleParts({
                summary: event.summary,
                sportCode: event.sportCode,
                opponent: event.opponent ?? null,
                isHome: event.isHome ?? null,
              });
              const areaLabel = AREA_LABELS[shift.area] ?? shift.area;
              const isBusy = acting === `pickup:${item.id}`;
              const primaryWarning = item.availabilityContext ? null : item.advisoryConflictNote ?? item.warnings[0]?.label ?? null;

              return (
                <article
                  key={`open-${item.id}`}
                  className="group/open-work px-4 py-3 transition-colors hover:bg-muted/25"
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <ClipboardListIcon className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1 flex flex-col gap-2">
                      <div className="flex min-w-0 items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="truncate text-sm font-semibold leading-tight">{titleParts.title}</h3>
                          {titleParts.detail && (
                            <p className="mt-0.5 truncate text-xs text-muted-foreground">{titleParts.detail}</p>
                          )}
                        </div>
                        <Badge variant="green" size="sm">
                          Open
                        </Badge>
                      </div>

                      <div className="grid gap-1.5 text-xs text-muted-foreground sm:grid-cols-2">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <CalendarClockIcon className="size-3.5 shrink-0" />
                          <span className="truncate tabular-nums">{formatShiftWindow(shift)}</span>
                        </span>
                        <span className="flex min-w-0 items-center gap-1.5">
                          <ArrowLeftRightIcon className="size-3.5 shrink-0" />
                          <span className="truncate">{areaLabel}</span>
                        </span>
                        <span className="flex min-w-0 items-center gap-1.5">
                          <ShieldCheckIcon className="size-3.5 shrink-0" />
                          <span className="truncate">{openShiftActionCopy(item)}</span>
                        </span>
                        {item.score !== null && (
                          <span className="flex min-w-0 items-center gap-1.5">
                            <Clock3Icon className="size-3.5 shrink-0" />
                            <span className="truncate tabular-nums">Fit score {item.score}</span>
                          </span>
                        )}
                      </div>

                      {primaryWarning && (
                        <p className="flex items-start gap-1.5 rounded-md bg-[var(--orange-bg)] px-2.5 py-2 text-xs leading-relaxed text-[var(--orange-text)]">
                          <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                          <span>{primaryWarning}</span>
                        </p>
                      )}
                      <AvailabilityContextNote context={item.availabilityContext} />

                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <Button
                          className="h-10 gap-1.5"
                          onClick={() => void handlePickup(item)}
                          disabled={acting !== null || !item.canAct}
                        >
                          <CheckIcon className="size-3.5" />
                          {isBusy ? "Claiming..." : "Claim shift"}
                        </Button>
                        {item.requestCount > 0 && (
                          <span className="text-xs text-muted-foreground">
                            {item.requestCount} pending {item.requestCount === 1 ? "request" : "requests"}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </article>
              );
              })}
              </WorkSection>
            )}

            {claimableTrades.length > 0 && (
              <WorkSection
                title="Trade Posts"
                description="Shifts another student posted for coverage. Claiming sends the trade to an admin."
                count={claimableTrades.length}
              >
              {claimableTrades.map((trade) => {
                const shift = trade.shiftAssignment.shift;
                const event = shift.shiftGroup.event;
                const titleParts = scheduleEventTitleParts({
                  summary: event.summary,
                  sportCode: event.sportCode,
                  opponent: event.opponent ?? null,
                  isHome: event.isHome ?? null,
                });
                const areaLabel = AREA_LABELS[shift.area] ?? shift.area;
                const meta = statusMeta(trade.status);
                const isBusy = acting === trade.id;

                return (
                  <article
                    key={trade.id}
                    className="group/trade px-4 py-3 transition-colors hover:bg-muted/25"
                  >
                    <div className="flex items-start gap-3">
                      <UserAvatar name={trade.postedBy.name} size="sm" className="mt-0.5 shrink-0" />
                      <div className="min-w-0 flex-1 flex flex-col gap-2">
                        <div className="flex min-w-0 items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="truncate text-sm font-semibold leading-tight">{titleParts.title}</h3>
                            {titleParts.detail && (
                              <p className="mt-0.5 truncate text-xs text-muted-foreground">{titleParts.detail}</p>
                            )}
                          </div>
                          <Badge variant={meta.variant} size="sm">
                            {meta.label}
                          </Badge>
                        </div>

                        <div className="grid gap-1.5 text-xs text-muted-foreground sm:grid-cols-2">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <CalendarClockIcon className="size-3.5 shrink-0" />
                            <span className="truncate tabular-nums">{formatShiftWindow(shift)}</span>
                          </span>
                          <span className="flex min-w-0 items-center gap-1.5">
                            <ArrowLeftRightIcon className="size-3.5 shrink-0" />
                            <span className="truncate">{areaLabel}</span>
                          </span>
                          <span className="flex min-w-0 items-center gap-1.5">
                            <ShieldCheckIcon className="size-3.5 shrink-0" />
                            <span className="truncate">{tradeOutcomeCopy(trade, { currentUserId, isStaff })}</span>
                          </span>
                          <span className="flex min-w-0 items-center gap-1.5">
                            <Clock3Icon className="size-3.5 shrink-0" />
                            <span className="truncate tabular-nums">Posted {formatDateShort(trade.postedAt)}</span>
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span>
                            Posted by <span className="font-medium text-foreground">{trade.postedBy.name}</span>
                          </span>
                          <span className="font-medium text-[var(--green-text)]">
                            Available to claim
                          </span>
                        </div>

                        {trade.notes && (
                          <p className="rounded-md bg-muted/40 px-2.5 py-2 text-xs leading-relaxed text-muted-foreground">
                            {trade.notes}
                          </p>
                        )}

                        <AvailabilityContextNote context={trade.viewerAvailabilityContext} />
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <Button
                            className="h-10 gap-1.5"
                            onClick={() => void handleClaim(trade)}
                            disabled={acting !== null}
                          >
                            <CheckIcon className="size-3.5" />
                            {isBusy ? "Claiming..." : "Claim"}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </article>
                );
                })}
              </WorkSection>
            )}

            <WorkSection
              title="My Posts"
              description="Trades you posted. Canceling a post keeps the shift assigned to you."
              count={myTradePosts.length}
            >
              {myTradePosts.map((trade) => {
              const shift = trade.shiftAssignment.shift;
              const event = shift.shiftGroup.event;
              const titleParts = scheduleEventTitleParts({
                summary: event.summary,
                sportCode: event.sportCode,
                opponent: event.opponent ?? null,
                isHome: event.isHome ?? null,
              });
              const areaLabel = AREA_LABELS[shift.area] ?? shift.area;
              const meta = statusMeta(trade.status);
              const isOwnTrade = trade.postedBy.id === currentUserId;
              const isBusy = acting === trade.id;
              const canCancel = isOwnTrade && (trade.status === "OPEN" || trade.status === "CLAIMED");

              return (
                <article
                  key={trade.id}
                  className="group/trade px-4 py-3 transition-colors hover:bg-muted/25"
                >
                  <div className="flex items-start gap-3">
                    <UserAvatar name={trade.postedBy.name} size="sm" className="mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1 flex flex-col gap-2">
                      <div className="flex min-w-0 items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="truncate text-sm font-semibold leading-tight">{titleParts.title}</h3>
                          {titleParts.detail && (
                            <p className="mt-0.5 truncate text-xs text-muted-foreground">{titleParts.detail}</p>
                          )}
                        </div>
                        <Badge variant={meta.variant} size="sm">
                          {meta.label}
                        </Badge>
                      </div>

                      <div className="grid gap-1.5 text-xs text-muted-foreground sm:grid-cols-2">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <CalendarClockIcon className="size-3.5 shrink-0" />
                          <span className="truncate tabular-nums">{formatShiftWindow(shift)}</span>
                        </span>
                        <span className="flex min-w-0 items-center gap-1.5">
                          <ArrowLeftRightIcon className="size-3.5 shrink-0" />
                          <span className="truncate">{areaLabel}</span>
                        </span>
                        <span className="flex min-w-0 items-center gap-1.5">
                          <ShieldCheckIcon className="size-3.5 shrink-0" />
                          <span className="truncate">
                            Admin approval required
                          </span>
                        </span>
                        <span className="flex min-w-0 items-center gap-1.5">
                          <Clock3Icon className="size-3.5 shrink-0" />
                          <span className="truncate tabular-nums">Posted {formatDateShort(trade.postedAt)}</span>
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>
                          Posted by <span className="font-medium text-foreground">{trade.postedBy.name}</span>
                        </span>
                        {trade.claimedBy && (
                          <span>
                            Claimed by <span className="font-medium text-foreground">{trade.claimedBy.name}</span>
                          </span>
                        )}
                        <span className={cn(
                          "font-medium",
                          trade.status === "OPEN" ? "text-[var(--green-text)]" : "text-muted-foreground",
                        )}>
                          {tradeOutcomeCopy(trade, { currentUserId, isStaff })}
                        </span>
                      </div>

                      {trade.notes && (
                        <p className="rounded-md bg-muted/40 px-2.5 py-2 text-xs leading-relaxed text-muted-foreground">
                          {trade.notes}
                        </p>
                      )}

                      {canCancel && (
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <OperationalRowActions
                            label={`Actions for ${titleParts.title} trade`}
                          >
                            <DropdownMenuItem
                              variant="destructive"
                              disabled={acting !== null}
                              onSelect={() => void handleCancel(trade)}
                            >
                              <XIcon className="size-4" />
                              {isBusy ? "Cancelling..." : "Cancel"}
                            </DropdownMenuItem>
                          </OperationalRowActions>
                        </div>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
            </WorkSection>

            {(myPendingRequests.length + myPendingClaims.length) > 0 && (
              <WorkSection
                title="Waiting on Admin"
                description="These requests and claims are waiting for an admin. You are not on the schedule until approval."
                count={myPendingRequests.length + myPendingClaims.length}
              >
                {myPendingRequests.map((request) => {
                  const shift = request.shift;
                  const event = shift.shiftGroup.event;
                  const titleParts = scheduleEventTitleParts({
                    summary: event.summary,
                    sportCode: event.sportCode,
                    opponent: event.opponent ?? null,
                    isHome: event.isHome ?? null,
                  });
                  const areaLabel = AREA_LABELS[shift.area] ?? shift.area;
                  const isBusy = acting === `withdraw-request:${request.id}`;
                  const deadline = reviewDeadlineCopy(request.reviewAutoApprovesAt, "claimant");

                  return (
                    <article key={`mine-request-${request.id}`} className="px-4 py-3">
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                          <ClipboardListIcon className="size-4" />
                        </div>
                        <div className="min-w-0 flex-1 flex flex-col gap-2">
                          <div className="flex min-w-0 items-start justify-between gap-3">
                            <div className="min-w-0">
                              <h3 className="truncate text-sm font-semibold leading-tight">{titleParts.title}</h3>
                              {titleParts.detail && (
                                <p className="mt-0.5 truncate text-xs text-muted-foreground">{titleParts.detail}</p>
                              )}
                            </div>
                            <Badge variant="orange" size="sm">Waiting</Badge>
                          </div>
                          <div className="grid gap-1.5 text-xs text-muted-foreground sm:grid-cols-2">
                            <span className="flex min-w-0 items-center gap-1.5">
                              <CalendarClockIcon className="size-3.5 shrink-0" />
                              <span className="truncate tabular-nums">{formatShiftWindow(shift)}</span>
                            </span>
                            <span className="flex min-w-0 items-center gap-1.5">
                              <ClipboardListIcon className="size-3.5 shrink-0" />
                              <span className="truncate">{areaLabel}</span>
                            </span>
                          </div>
                          {deadline && (
                            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <Clock3Icon className="size-3.5 shrink-0" />
                              <span>{deadline}</span>
                            </p>
                          )}
                          <div className="flex flex-wrap gap-2 pt-1">
                            <Button
                              variant="outline"
                              className="h-10"
                              onClick={() => void handleWithdrawRequest(request)}
                              disabled={acting !== null}
                            >
                              {isBusy ? "Withdrawing…" : "Withdraw request"}
                            </Button>
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}

                {myPendingClaims.map((trade) => {
                  const shift = trade.shiftAssignment.shift;
                  const event = shift.shiftGroup.event;
                  const titleParts = scheduleEventTitleParts({
                    summary: event.summary,
                    sportCode: event.sportCode,
                    opponent: event.opponent ?? null,
                    isHome: event.isHome ?? null,
                  });
                  const areaLabel = AREA_LABELS[shift.area] ?? shift.area;
                  const isBusy = acting === `withdraw-claim:${trade.id}`;
                  const deadline = reviewDeadlineCopy(trade.reviewAutoApprovesAt, "claimant");

                  return (
                    <article key={`mine-claim-${trade.id}`} className="px-4 py-3">
                      <div className="flex items-start gap-3">
                        <UserAvatar name={trade.postedBy.name} size="sm" className="mt-0.5 shrink-0" />
                        <div className="min-w-0 flex-1 flex flex-col gap-2">
                          <div className="flex min-w-0 items-start justify-between gap-3">
                            <div className="min-w-0">
                              <h3 className="truncate text-sm font-semibold leading-tight">{titleParts.title}</h3>
                              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                {trade.postedBy.name}&apos;s shift
                              </p>
                            </div>
                            <Badge variant="orange" size="sm">Waiting</Badge>
                          </div>
                          <div className="grid gap-1.5 text-xs text-muted-foreground sm:grid-cols-2">
                            <span className="flex min-w-0 items-center gap-1.5">
                              <CalendarClockIcon className="size-3.5 shrink-0" />
                              <span className="truncate tabular-nums">{formatShiftWindow(shift)}</span>
                            </span>
                            <span className="flex min-w-0 items-center gap-1.5">
                              <ArrowLeftRightIcon className="size-3.5 shrink-0" />
                              <span className="truncate">{areaLabel}</span>
                            </span>
                          </div>
                          {deadline && (
                            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <Clock3Icon className="size-3.5 shrink-0" />
                              <span>{deadline}</span>
                            </p>
                          )}
                          {trade.viewerClaimReason && (
                            <p className="text-xs leading-relaxed text-muted-foreground">{trade.viewerClaimReason}</p>
                          )}
                          <div className="flex flex-wrap gap-2 pt-1">
                            <Button
                              variant="outline"
                              className="h-10"
                              onClick={() => void handleWithdrawClaim(trade)}
                              disabled={acting !== null}
                            >
                              {isBusy ? "Withdrawing…" : "Withdraw claim"}
                            </Button>
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </WorkSection>
            )}

            <WorkSection
              title="Waiting or Blocked"
              description="These shifts are visible for context, but cannot be picked up from your current state."
              count={unavailableOpenShifts.length + blockedClaimableTrades.length}
            >
              {unavailableOpenShifts.map((item) => {
                const shift = item.shift;
                const event = shift.shiftGroup.event;
                const titleParts = scheduleEventTitleParts({
                  summary: event.summary,
                  sportCode: event.sportCode,
                  opponent: event.opponent ?? null,
                  isHome: event.isHome ?? null,
                });
                const areaLabel = AREA_LABELS[shift.area] ?? shift.area;
                const primaryWarning = item.advisoryConflictNote ?? item.warnings[0]?.label ?? item.reason;

                return (
                  <article
                    key={`open-${item.id}`}
                    className="group/open-work px-4 py-3 transition-colors hover:bg-muted/25"
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                        <ClipboardListIcon className="size-4" />
                      </div>
                      <div className="min-w-0 flex-1 flex flex-col gap-2">
                        <div className="flex min-w-0 items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="truncate text-sm font-semibold leading-tight">{titleParts.title}</h3>
                            {titleParts.detail && (
                              <p className="mt-0.5 truncate text-xs text-muted-foreground">{titleParts.detail}</p>
                            )}
                          </div>
                          <Badge variant="gray" size="sm">
                            Not available
                          </Badge>
                        </div>

                        <div className="grid gap-1.5 text-xs text-muted-foreground sm:grid-cols-2">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <CalendarClockIcon className="size-3.5 shrink-0" />
                            <span className="truncate tabular-nums">{formatShiftWindow(shift)}</span>
                          </span>
                          <span className="flex min-w-0 items-center gap-1.5">
                            <ArrowLeftRightIcon className="size-3.5 shrink-0" />
                            <span className="truncate">{areaLabel}</span>
                          </span>
                        </div>

                        {primaryWarning && (
                          <p className="flex items-start gap-1.5 rounded-md bg-muted/50 px-2.5 py-2 text-xs leading-relaxed text-muted-foreground">
                            <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                            <span>{primaryWarning}</span>
                          </p>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}

              {blockedClaimableTrades.map((trade) => {
                const shift = trade.shiftAssignment.shift;
                const event = shift.shiftGroup.event;
                const titleParts = scheduleEventTitleParts({
                  summary: event.summary,
                  sportCode: event.sportCode,
                  opponent: event.opponent ?? null,
                  isHome: event.isHome ?? null,
                });
                const areaLabel = AREA_LABELS[shift.area] ?? shift.area;

                return (
                  <article
                    key={trade.id}
                    className="group/trade px-4 py-3 transition-colors hover:bg-muted/25"
                  >
                    <div className="flex items-start gap-3">
                      <UserAvatar name={trade.postedBy.name} size="sm" className="mt-0.5 shrink-0" />
                      <div className="min-w-0 flex-1 flex flex-col gap-2">
                        <div className="flex min-w-0 items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="truncate text-sm font-semibold leading-tight">{titleParts.title}</h3>
                            {titleParts.detail && (
                              <p className="mt-0.5 truncate text-xs text-muted-foreground">{titleParts.detail}</p>
                            )}
                          </div>
                          <Badge variant="red" size="sm">
                            Blocked
                          </Badge>
                        </div>

                        <div className="grid gap-1.5 text-xs text-muted-foreground sm:grid-cols-2">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <CalendarClockIcon className="size-3.5 shrink-0" />
                            <span className="truncate tabular-nums">{formatShiftWindow(shift)}</span>
                          </span>
                          <span className="flex min-w-0 items-center gap-1.5">
                            <ArrowLeftRightIcon className="size-3.5 shrink-0" />
                            <span className="truncate">{areaLabel}</span>
                          </span>
                        </div>

                        <AvailabilityContextNote context={trade.viewerAvailabilityContext} />
                        {!trade.viewerAvailabilityContext && trade.viewerClaimReason && (
                          <p className="flex items-start gap-1.5 rounded-md bg-muted/50 px-2.5 py-2 text-xs leading-relaxed text-muted-foreground">
                            <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                            <span>{trade.viewerClaimReason}</span>
                          </p>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </WorkSection>

            <WorkSection
              title="Posted Trades"
              description="Trade posts visible for coverage context."
              count={postedTrades.length}
            >
              {postedTrades.map((trade) => {
                const shift = trade.shiftAssignment.shift;
                const event = shift.shiftGroup.event;
                const titleParts = scheduleEventTitleParts({
                  summary: event.summary,
                  sportCode: event.sportCode,
                  opponent: event.opponent ?? null,
                  isHome: event.isHome ?? null,
                });
                const areaLabel = AREA_LABELS[shift.area] ?? shift.area;
                const meta = statusMeta(trade.status);

                return (
                  <article
                    key={trade.id}
                    className="group/trade px-4 py-3 transition-colors hover:bg-muted/25"
                  >
                    <div className="flex items-start gap-3">
                      <UserAvatar name={trade.postedBy.name} size="sm" className="mt-0.5 shrink-0" />
                      <div className="min-w-0 flex-1 flex flex-col gap-2">
                        <div className="flex min-w-0 items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="truncate text-sm font-semibold leading-tight">{titleParts.title}</h3>
                            {titleParts.detail && (
                              <p className="mt-0.5 truncate text-xs text-muted-foreground">{titleParts.detail}</p>
                            )}
                          </div>
                          <Badge variant={meta.variant} size="sm">
                            {meta.label}
                          </Badge>
                        </div>

                        <div className="grid gap-1.5 text-xs text-muted-foreground sm:grid-cols-2">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <CalendarClockIcon className="size-3.5 shrink-0" />
                            <span className="truncate tabular-nums">{formatShiftWindow(shift)}</span>
                          </span>
                          <span className="flex min-w-0 items-center gap-1.5">
                            <ArrowLeftRightIcon className="size-3.5 shrink-0" />
                            <span className="truncate">{areaLabel}</span>
                          </span>
                          <span className="flex min-w-0 items-center gap-1.5">
                            <ShieldCheckIcon className="size-3.5 shrink-0" />
                            <span className="truncate">{tradeOutcomeCopy(trade, { currentUserId, isStaff })}</span>
                          </span>
                          <span className="flex min-w-0 items-center gap-1.5">
                            <Clock3Icon className="size-3.5 shrink-0" />
                            <span className="truncate tabular-nums">Posted {formatDateShort(trade.postedAt)}</span>
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span>
                            Posted by <span className="font-medium text-foreground">{trade.postedBy.name}</span>
                          </span>
                          {trade.claimedBy && (
                            <span>
                              Claimed by <span className="font-medium text-foreground">{trade.claimedBy.name}</span>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </WorkSection>

            <WorkSection
              title="Resolved"
              description="Completed or cancelled trade history shown by the current filters."
              count={resolvedTrades.length}
            >
              {resolvedTrades.map((trade) => {
                const shift = trade.shiftAssignment.shift;
                const event = shift.shiftGroup.event;
                const titleParts = scheduleEventTitleParts({
                  summary: event.summary,
                  sportCode: event.sportCode,
                  opponent: event.opponent ?? null,
                  isHome: event.isHome ?? null,
                });
                const areaLabel = AREA_LABELS[shift.area] ?? shift.area;
                const meta = statusMeta(trade.status);

                return (
                  <article
                    key={trade.id}
                    className="group/trade px-4 py-3 transition-colors hover:bg-muted/25"
                  >
                    <div className="flex items-start gap-3">
                      <UserAvatar name={trade.postedBy.name} size="sm" className="mt-0.5 shrink-0" />
                      <div className="min-w-0 flex-1 flex flex-col gap-2">
                        <div className="flex min-w-0 items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="truncate text-sm font-semibold leading-tight">{titleParts.title}</h3>
                            {titleParts.detail && (
                              <p className="mt-0.5 truncate text-xs text-muted-foreground">{titleParts.detail}</p>
                            )}
                          </div>
                          <Badge variant={meta.variant} size="sm">
                            {meta.label}
                          </Badge>
                        </div>

                        <div className="grid gap-1.5 text-xs text-muted-foreground sm:grid-cols-2">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <CalendarClockIcon className="size-3.5 shrink-0" />
                            <span className="truncate tabular-nums">{formatShiftWindow(shift)}</span>
                          </span>
                          <span className="flex min-w-0 items-center gap-1.5">
                            <ArrowLeftRightIcon className="size-3.5 shrink-0" />
                            <span className="truncate">{areaLabel}</span>
                          </span>
                          <span className="flex min-w-0 items-center gap-1.5">
                            <ShieldCheckIcon className="size-3.5 shrink-0" />
                            <span className="truncate">{meta.helper}</span>
                          </span>
                          <span className="flex min-w-0 items-center gap-1.5">
                            <Clock3Icon className="size-3.5 shrink-0" />
                            <span className="truncate tabular-nums">Posted {formatDateShort(trade.postedAt)}</span>
                          </span>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </WorkSection>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
