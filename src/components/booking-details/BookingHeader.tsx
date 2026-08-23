"use client";

import type { ComponentProps, ComponentType } from "react";
import { InlineTitle } from "@/components/InlineTitle";
import { Button } from "@/components/ui/button";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import StatusIndicator from "@/components/ui/status-indicator";
import { UserAvatar } from "@/components/UserAvatar";
import { DetailPageHeader } from "@/components/DetailPageHeader";
import { Spinner } from "@/components/ui/spinner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  CalendarClock,
  CalendarDays,
  ChevronDown,
  Clock,
  Copy,
  MapPin,
  PackageOpen,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { statusBadgeVariant, statusLabel, urgencyBadgeClassName } from "./helpers";
import type { BookingChangeSyncStatus } from "@/hooks/use-booking-change-sync";
import type { BookingDetail } from "./types";
import { formatDateTime } from "@/lib/format";
import { operationalBookingStatus } from "@/lib/booking-status-display";

type Props = {
  booking: BookingDetail;
  kind: "CHECKOUT" | "RESERVATION";
  canEdit: boolean;
  canExtend: boolean;
  canCancel: boolean;
  canDuplicate: boolean;
  canNudge: boolean;
  canForceComplete: boolean;
  canTransferOwner: boolean;
  canEditEvents: boolean;
  countdown: string | null;
  urgency: string;
  kioskHandoffLabel: string | null;
  reloading: boolean;
  syncStatus?: BookingChangeSyncStatus;
  actionLoading: string | null;
  onSaveTitle: (value: string) => Promise<void>;
  onReload: () => void;
  onEdit: () => void;
  onToggleExtend: () => void;
  onCancel: () => void;
  onDuplicate: () => void;
  onNudge: () => void;
  onForceComplete: () => void;
  onTransferOwner: () => void;
  onEditEvents: () => void;
};

function PendingDropdownMenuItem({
  active,
  children,
  ...props
}: ComponentProps<typeof DropdownMenuItem> & {
  active: boolean;
}) {
  return (
    <DropdownMenuItem aria-busy={active || undefined} {...props}>
      {active ? <Spinner aria-hidden="true" /> : null}
      {children}
    </DropdownMenuItem>
  );
}

function SummaryFact({
  icon: Icon,
  label,
  value,
}: {
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2.5 py-1">
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className="mt-0.5 truncate text-sm font-medium text-foreground" title={value}>
          {value}
        </div>
      </div>
    </div>
  );
}

export function BookingHeader({
  booking,
  kind,
  canEdit,
  canExtend,
  canCancel,
  canDuplicate,
  canNudge,
  canForceComplete,
  canTransferOwner,
  canEditEvents,
  countdown,
  urgency,
  kioskHandoffLabel,
  reloading,
  syncStatus,
  actionLoading,
  onSaveTitle,
  onReload,
  onEdit,
  onToggleExtend,
  onCancel,
  onDuplicate,
  onNudge,
  onForceComplete,
  onTransferOwner,
  onEditEvents,
}: Props) {
  const hasSecondaryActions = canDuplicate || canCancel || canNudge || canForceComplete || canTransferOwner || canEditEvents;
  const hasPrimaryActions = canEdit || canExtend;
  const displayStatus = operationalBookingStatus(booking);

  const eventLabel =
    booking.events && booking.events.length > 1
      ? `${booking.events.length} events`
      : booking.event?.summary ?? null;

  const context = eventLabel
    ? { label: "Event", value: eventLabel }
    : booking.shiftAssignment?.shift.area
      ? { label: "Assignment", value: booking.shiftAssignment.shift.area }
      : booking.kit?.name
        ? { label: "Kit", value: booking.kit.name }
        : null;

  const equipmentCount =
    (booking.serializedItems?.length ?? 0) +
    (booking.bulkItems ?? []).reduce((total, item) => total + item.plannedQuantity, 0);

  const schedule =
    booking.status === "OPEN"
      ? { label: "Due back", value: formatDateTime(booking.endsAt) }
      : booking.status === "BOOKED" || booking.status === "PENDING_PICKUP"
        ? { label: "Pickup", value: formatDateTime(booking.startsAt) }
        : booking.status === "COMPLETED" || booking.status === "CANCELLED"
          ? { label: "Ended", value: formatDateTime(booking.endsAt) }
          : { label: "Starts", value: formatDateTime(booking.startsAt) };

  const updatedLabel = booking.updatedAt
    ? `Updated ${new Date(booking.updatedAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })}`
    : null;

  async function copyRef() {
    if (!booking.refNumber) return;
    try {
      await navigator.clipboard.writeText(booking.refNumber);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Failed to copy");
    }
  }

  return (
    <DetailPageHeader
      className="mb-0"
      media={
        <UserAvatar
          name={booking.requester?.name ?? "Unknown"}
          avatarUrl={booking.requester?.avatarUrl}
          size="xl"
          className="shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]"
        />
      }
      status={
        <>
          <Badge
            variant={
              (booking.isOverdue
                ? "red"
                : statusBadgeVariant(displayStatus, kind)) as BadgeProps["variant"]
            }
          >
            {booking.isOverdue ? "Overdue" : statusLabel(displayStatus, kind)}
          </Badge>
          {countdown && (
            <Badge
              variant="outline"
              className={`gap-1 font-medium tabular-nums ${urgencyBadgeClassName(urgency)}`}
            >
              <Clock className="size-3" />
              {countdown}
            </Badge>
          )}
          {kioskHandoffLabel && (
            <Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
              {kioskHandoffLabel}
            </Badge>
          )}
          {booking.scheduleStatus === "scheduled" && (
            <Badge variant="green" className="gap-1">
              On schedule
            </Badge>
          )}
          {booking.scheduleStatus === "needs_review" && (
            <Badge
              variant="orange"
              className="gap-1"
              title={booking.scheduleStatusReason ?? undefined}
            >
              Schedule review
            </Badge>
          )}
        </>
      }
      title={
        <InlineTitle
          value={booking.title}
          canEdit={canEdit}
          onSave={onSaveTitle}
          placeholder="Untitled booking"
        />
      }
      subtitle={
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <span>Requester</span>
          <span aria-hidden="true" className="text-muted-foreground/40">/</span>
          <span className="font-medium text-foreground">
            {booking.requester?.name ?? "Unknown"}
          </span>
        </span>
      }
      meta={
        /* Reference and type */
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground/70">
              {booking.refNumber && (
                <button
                  type="button"
                  onClick={copyRef}
                  title="Click to copy"
                  className="group/ref inline-flex items-center gap-1 rounded-sm font-mono text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  {booking.refNumber}
                  <Copy className="size-3 opacity-50 transition-opacity group-hover/ref:opacity-100" />
                </button>
              )}
              {booking.refNumber && booking.bookingType && (
                <span aria-hidden="true" className="text-muted-foreground/30">/</span>
              )}
              {booking.bookingType && <span>{booking.bookingType}</span>}
            </div>
      }
      actions={
        <div className="flex flex-col gap-2 lg:min-w-[260px] lg:items-end">
          {(hasPrimaryActions || hasSecondaryActions) && (
            <div className="flex flex-wrap items-center gap-1.5 lg:justify-end">
              {hasSecondaryActions && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="h-10 gap-1.5">
                      Actions
                      <ChevronDown className="size-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuGroup>
                      {canNudge && (
                        <PendingDropdownMenuItem
                          active={actionLoading === "nudge"}
                          onSelect={onNudge}
                          disabled={!!actionLoading}
                        >
                          Nudge borrower
                        </PendingDropdownMenuItem>
                      )}
                      {canForceComplete && (
                        <PendingDropdownMenuItem
                          active={actionLoading === "force-complete"}
                          onSelect={onForceComplete}
                          disabled={!!actionLoading}
                        >
                          Close without scan
                        </PendingDropdownMenuItem>
                      )}
                      {canTransferOwner && (
                        <PendingDropdownMenuItem
                          active={actionLoading === "transfer-owner"}
                          onSelect={onTransferOwner}
                          disabled={!!actionLoading}
                        >
                          Transfer owner
                        </PendingDropdownMenuItem>
                      )}
                      {canEditEvents && (
                        <PendingDropdownMenuItem
                          active={actionLoading === "edit-events"}
                          onSelect={onEditEvents}
                          disabled={!!actionLoading}
                        >
                          Edit linked events
                        </PendingDropdownMenuItem>
                      )}
                      {canDuplicate && (
                        <PendingDropdownMenuItem
                          active={actionLoading === "duplicate"}
                          onSelect={onDuplicate}
                          disabled={!!actionLoading}
                        >
                          Duplicate
                        </PendingDropdownMenuItem>
                      )}
                      {canCancel && (
                        <PendingDropdownMenuItem
                          active={actionLoading === "cancel"}
                          variant="destructive"
                          onSelect={onCancel}
                          disabled={!!actionLoading}
                        >
                          Cancel
                        </PendingDropdownMenuItem>
                      )}
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {canEdit && (
                <Button variant="outline" className="h-10" onClick={onEdit}>
                  Edit
                </Button>
              )}
              {canExtend && (
                <Button variant="outline" className="h-10" onClick={onToggleExtend}>
                  Extend
                </Button>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 text-[10px] leading-none text-muted-foreground/40 lg:justify-end">
            {syncStatus && (
              <StatusIndicator
                state={syncStatus.state}
                label={syncStatus.label}
                size="sm"
                title={syncStatus.description}
              />
            )}
            {reloading ? (
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <Spinner className="size-3" />
                Refreshing…
              </span>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={onReload}
                    className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
                    style={{ fontFamily: "var(--font-mono)" }}
                  >
                    <RefreshCw className="size-3" />
                    {updatedLabel ?? "Refresh"}
                  </button>
                </TooltipTrigger>
                <TooltipContent>Click to refresh</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
      }
      footer={
        <div
          className={`grid gap-x-5 gap-y-3 sm:grid-cols-2 ${context ? "xl:grid-cols-4" : "xl:grid-cols-3"}`}
          aria-label="Booking summary"
        >
          <SummaryFact icon={CalendarClock} label={schedule.label} value={schedule.value} />
          <SummaryFact
            icon={MapPin}
            label="Pickup location"
            value={booking.location?.name ?? "Not assigned"}
          />
          <SummaryFact
            icon={PackageOpen}
            label="Gear"
            value={`${equipmentCount} ${equipmentCount === 1 ? "item" : "items"}`}
          />
          {context && (
            <SummaryFact icon={CalendarDays} label={context.label} value={context.value} />
          )}
        </div>
      }
    />
  );
}
