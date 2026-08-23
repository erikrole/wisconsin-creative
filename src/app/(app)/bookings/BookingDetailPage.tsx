"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { AlertCircle, ChevronDown } from "lucide-react";
import BookingDetailsSheet from "@/components/BookingDetailsSheet";
import { toast } from "sonner";
import { useBreadcrumbLabel } from "@/components/BreadcrumbContext";

import { useBookingDetail } from "@/hooks/useBookingDetail";
import { useBookingActions } from "@/hooks/useBookingActions";
import { useBookingChangeSync } from "@/hooks/use-booking-change-sync";
import {
  toLocalDateTimeValue,
  auditActionLabel,
  formatRelative,
} from "@/components/booking-details/helpers";
import { BookingHeader } from "@/components/booking-details/BookingHeader";
import BookingInfoCard from "@/components/booking-details/BookingInfoCard";
import { EditBookingEventsDialog } from "@/components/booking-details/EditBookingEventsDialog";
import { TransferOwnerDialog } from "@/components/booking-details/TransferOwnerDialog";
import { UserAvatar } from "@/components/UserAvatar";
import { formatCountdownCompact, formatDateTime, getUrgency } from "@/lib/format";

import BookingEquipmentTab from "./BookingEquipmentTab";
import BookingHistoryTab from "./BookingHistoryTab";

/* ── Main Component ── */

export default function BookingDetailPage({
  kind,
}: {
  kind: "CHECKOUT" | "RESERVATION";
}) {
  const { id } = useParams<{ id: string }>();
  const { setBreadcrumbLabel } = useBreadcrumbLabel();

  // Data fetching
  const { booking, loading, reloading, error, reload, patchLocal } = useBookingDetail(id);

  // Actions
  const actions = useBookingActions(id, kind, reload, booking?.updatedAt);
  const bookingSync = useBookingChangeSync();

  // Extend panel state
  const [showExtend, setShowExtend] = useState(false);
  const [extendDate, setExtendDate] = useState("");

  // History collapse state
  const [historyExpanded, setHistoryExpanded] = useState(false);

  // Edit sheet state
  const [editSheetOpen, setEditSheetOpen] = useState(false);
  const [transferOwnerOpen, setTransferOwnerOpen] = useState(false);
  const [editEventsOpen, setEditEventsOpen] = useState(false);

  // Admin exception state
  const [forceCompleteOpen, setForceCompleteOpen] = useState(false);
  const [forceCompleteReason, setForceCompleteReason] = useState("");
  const [forceCompleteError, setForceCompleteError] = useState("");

  useEffect(() => {
    if (booking?.title) setBreadcrumbLabel(booking.title);
  }, [booking?.title, setBreadcrumbLabel]);

  // Live countdown tick — faster for urgent/overdue bookings
  const [now, setNow] = useState(() => new Date());
  const liveUrgency = booking ? getUrgency(booking.startsAt, booking.endsAt, now) : "normal";
  useEffect(() => {
    const interval = liveUrgency === "overdue" || liveUrgency === "critical" ? 10_000 : 30_000;
    const timer = setInterval(() => setNow(new Date()), interval);
    return () => clearInterval(timer);
  }, [liveUrgency]);

  async function handleExtend() {
    if (!extendDate) return;
    if (new Date(extendDate) <= new Date()) {
      toast.error("New end date must be in the future");
      return;
    }
    const ok = await actions.extend(extendDate);
    if (ok) {
      setShowExtend(false);
      setExtendDate("");
    }
  }

  function handleQuickExtend(days: number) {
    if (!booking) return;
    // Offset from the currently picked date if set, otherwise from booking end
    const base = extendDate ? new Date(extendDate) : new Date(booking.endsAt);
    base.setDate(base.getDate() + days);
    setExtendDate(toLocalDateTimeValue(base));
    setShowExtend(true);
  }

  function toggleExtend() {
    setShowExtend((v) => {
      if (!v && booking) setExtendDate(toLocalDateTimeValue(new Date(booking.endsAt)));
      return !v;
    });
  }

  async function handleForceComplete() {
    const reason = forceCompleteReason.trim();
    if (reason.length < 10) {
      setForceCompleteError("Enter a reason of at least 10 characters.");
      return;
    }
    const ok = await actions.forceComplete(reason);
    if (ok) {
      setForceCompleteOpen(false);
      setForceCompleteReason("");
      setForceCompleteError("");
    }
  }

  // Derived
  const allowedActions = booking?.allowedActions ?? [];
  const canEdit = allowedActions.includes("edit");
  const canExtend = allowedActions.includes("extend");
  const canCancel = allowedActions.includes("cancel");
  const canDuplicate = kind === "RESERVATION" && allowedActions.includes("duplicate");
  const canNudge = allowedActions.includes("nudge");
  const canForceComplete = kind === "CHECKOUT" && allowedActions.includes("force-complete");
  const canTransferOwner = allowedActions.includes("transfer-owner");
  const canEditEvents = canEdit;
  const isOpen = booking?.status === "OPEN";
  const isActive = isOpen || booking?.status === "BOOKED";
  const kioskHandoffLabel =
    kind === "CHECKOUT" && booking?.status === "PENDING_PICKUP"
      ? "Pickup at kiosk"
      : kind === "CHECKOUT" && booking?.status === "OPEN"
        ? "Return at kiosk"
        : kind === "RESERVATION" && booking?.status === "BOOKED"
          ? "Pick up at kiosk"
          : null;

  // Keyboard shortcut: E to open edit sheet
  useEffect(() => {
    if (!canEdit) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === "e" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setEditSheetOpen(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canEdit]);

  const listPath = kind === "CHECKOUT" ? "/checkouts" : "/reservations";
  const kindLabel = kind === "CHECKOUT" ? "checkout" : "reservation";
  const kindLabelPlural = kind === "CHECKOUT" ? "Checkouts" : "Reservations";

  // Countdown for active bookings
  const countdown = booking && isActive ? formatCountdownCompact(booking.endsAt, now) : null;
  const urgency = isActive ? liveUrgency : "normal";

  /* ── Loading state ── */

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        {/* Header card skeleton */}
        <div className="rounded-lg border border-border/50 bg-card px-4 py-4 shadow-xs sm:px-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex gap-4">
              <Skeleton className="size-20 rounded-full shrink-0" />
              <div className="flex flex-col gap-2 pt-1">
                <Skeleton className="h-5 w-24 rounded-full" />
                <Skeleton className="h-8 w-56" />
                <Skeleton className="h-3 w-40" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-8 w-20" />
              <Skeleton className="h-8 w-20" />
            </div>
          </div>
        </div>
        {/* Two-column body skeleton */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
          <Skeleton className="h-80 rounded-xl" />
          <Skeleton className="h-80 rounded-xl" />
        </div>
      </div>
    );
  }

  /* ── Error state ── */

  if (error || !booking) {
    const isNetwork = error === "network";
    return (
      <div className="flex items-center justify-center py-16 px-5">
        <Alert variant="destructive" className="max-w-md">
          <AlertCircle className="size-4" />
          <AlertTitle>
            {isNetwork
              ? "Connection error"
              : `${kindLabel.charAt(0).toUpperCase() + kindLabel.slice(1)} not found`}
          </AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <p>
              {isNetwork
                ? "Could not reach the server. Check your connection and try again."
                : `This ${kindLabel} could not be loaded. It may have been deleted or you may not have access.`}
            </p>
            <div className="flex items-center gap-3">
              {isNetwork && (
                <Button className="h-10" variant="outline" onClick={reload}>
                  Retry
                </Button>
              )}
              <Link href={listPath} className="underline font-medium text-sm">
                Back to {kindLabelPlural.toLowerCase()}
              </Link>
            </div>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ── Header ── */}
      <BookingHeader
        booking={booking}
        kind={kind}
        canEdit={canEdit}
        canExtend={canExtend}
        canCancel={canCancel}
        canDuplicate={canDuplicate}
        canNudge={canNudge}
        canForceComplete={canForceComplete}
        canTransferOwner={canTransferOwner}
        canEditEvents={canEditEvents}
        countdown={countdown}
        urgency={urgency}
        kioskHandoffLabel={kioskHandoffLabel}
        reloading={reloading}
        syncStatus={bookingSync}
        actionLoading={actions.actionLoading}
        onSaveTitle={async (v) => {
          const updated = await actions.saveField("title", v);
          patchLocal(updated);
        }}
        onReload={reload}
        onEdit={() => setEditSheetOpen(true)}
        onToggleExtend={toggleExtend}
        onCancel={actions.cancel}
        onDuplicate={actions.duplicate}
        onNudge={actions.nudge}
        onForceComplete={() => setForceCompleteOpen(true)}
        onTransferOwner={() => setTransferOwnerOpen(true)}
        onEditEvents={() => setEditEventsOpen(true)}
      />

      {/* ── Extend panel ── */}
      {showExtend && (
        <Card elevation="flat" className="p-4 rounded-xl border-border/50 shadow-xs flex flex-col gap-3">
          <span className="text-sm font-medium">New end date</span>
          <DateTimePicker
            value={extendDate ? new Date(extendDate) : undefined}
            onChange={(d) => setExtendDate(toLocalDateTimeValue(d))}
            minDate={new Date(Math.max(new Date(booking.endsAt).getTime(), Date.now()))}
            placeholder="Select new end date"
          />
          <div className="flex items-center gap-2 flex-wrap">
            <Button className="h-10"
              onClick={handleExtend}
              disabled={!extendDate || !!actions.actionLoading}
            >
              {actions.actionLoading === "extend" ? "Saving..." : "Save"}
            </Button>
            <Button className="h-10"
              variant="outline"
              onClick={() => { setShowExtend(false); setExtendDate(""); }}
            >
              Cancel
            </Button>
            <span className="border-l border-border/40 h-5 mx-1" />
            {[
              { label: "+1 day", days: 1 },
              { label: "+3 days", days: 3 },
              { label: "+1 week", days: 7 },
            ].map(({ label, days }) => (
              <Button
                key={days}
                variant="outline"
                className="h-10 text-xs"
                onClick={() => handleQuickExtend(days)}
              >
                {label}
              </Button>
            ))}
          </div>
        </Card>
      )}

      {/* ── Two-column layout: Equipment + Info ── */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
        {/* Left: Equipment manifest */}
        <BookingEquipmentTab booking={booking} />

        {/* Right: Info card */}
        <BookingInfoCard
          booking={booking}
          canEdit={canEdit}
          onSave={actions.saveField}
          onPatch={patchLocal}
        />
      </div>

      {/* ── History section (inline, collapsible) ── */}
      {booking.auditLogs.length > 0 && (
        <Collapsible open={historyExpanded} onOpenChange={setHistoryExpanded}>
          <Card elevation="flat" className="rounded-xl border-border/50 shadow-xs">
            <CardHeader className="pb-0">
              <CollapsibleTrigger className="flex items-center gap-2 w-full text-left">
                <ChevronDown className={`size-4 transition-transform ${historyExpanded ? "" : "-rotate-90"}`} />
                <CardTitle className="text-base tracking-tight">Activity</CardTitle>
                <Badge variant="secondary" size="sm" className="tabular-nums">
                  {booking.auditLogs.length}
                </Badge>
              </CollapsibleTrigger>
              {/* Collapsed preview: show latest entry */}
              {!historyExpanded && booking.auditLogs[0] && (
                <div
                  className="mt-1.5 ml-6 flex items-center gap-2 text-xs text-muted-foreground"
                  title={formatDateTime(booking.auditLogs[0].createdAt)}
                >
                  <UserAvatar
                    name={booking.auditLogs[0].actor?.name ?? "Unknown"}
                    size="xs"
                    className="shrink-0"
                  />
                  <span className="min-w-0 truncate">
                    <span className="font-medium text-foreground">
                      {booking.auditLogs[0].actor?.name ?? "Unknown"}
                    </span>{" "}
                    {auditActionLabel(booking.auditLogs[0].action)}
                  </span>
                  <span className="shrink-0 text-muted-foreground/40">·</span>
                  <span className="shrink-0">{formatRelative(booking.auditLogs[0].createdAt)}</span>
                </div>
              )}
            </CardHeader>
            <CollapsibleContent>
              <CardContent className="p-0 pt-2">
                <BookingHistoryTab auditLogs={booking.auditLogs} dueAt={booking.endsAt} />
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      )}

      {/* ── Edit sheet ── */}
      <BookingDetailsSheet
        bookingId={editSheetOpen ? id : null}
        onClose={() => setEditSheetOpen(false)}
        onUpdated={() => {
          setEditSheetOpen(false);
          reload();
        }}
      />

      <TransferOwnerDialog
        open={transferOwnerOpen}
        booking={booking}
        onOpenChange={setTransferOwnerOpen}
        onTransferred={(updated) => {
          patchLocal(updated);
        }}
      />

      <EditBookingEventsDialog
        open={editEventsOpen}
        booking={booking}
        onOpenChange={setEditEventsOpen}
        onUpdated={(updated) => {
          patchLocal(updated);
          reload();
        }}
      />

      <Dialog
        open={forceCompleteOpen}
        onOpenChange={(open) => {
          if (actions.actionLoading === "force-complete") return;
          setForceCompleteOpen(open);
          if (!open) {
            setForceCompleteReason("");
            setForceCompleteError("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close without scan?</DialogTitle>
            <DialogDescription>
              Use this only when an admin has physically verified every item is back. The checkout will close and the exception will be recorded in history.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="force-complete-reason">Reason</Label>
              <Textarea
                id="force-complete-reason"
                value={forceCompleteReason}
                onChange={(event) => {
                  setForceCompleteReason(event.target.value);
                  if (forceCompleteError) setForceCompleteError("");
                }}
                placeholder="Example: Scanner offline, all gear verified on shelf by admin."
                rows={4}
                aria-invalid={forceCompleteError ? true : undefined}
                disabled={actions.actionLoading === "force-complete"}
              />
              {forceCompleteError && (
                <p className="text-sm text-destructive">{forceCompleteError}</p>
              )}
            </div>
          </DialogBody>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setForceCompleteOpen(false)}
              disabled={actions.actionLoading === "force-complete"}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleForceComplete}
              disabled={actions.actionLoading === "force-complete" || forceCompleteReason.trim().length < 10}
            >
              {actions.actionLoading === "force-complete" ? "Closing..." : "Close checkout"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
