"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/UserAvatar";
import { InlineDateField } from "./InlineDateField";
import {
  CalendarClockIcon,
  CalendarDaysIcon,
  CheckIcon,
  Clock3Icon,
  LinkIcon,
  MapPinIcon,
  NotebookTextIcon,
  PackageCheckIcon,
  PencilIcon,
  XIcon,
} from "lucide-react";
import {
  formatDateTime,
  formatDueLabel,
  formatDuration,
  formatStartsIn,
  isDueToday,
} from "@/lib/format";
import type { BookingDetail } from "./types";
import { minimumBookingEndDate } from "@/lib/quarter-hour";

type EditableBookingField = "startsAt" | "endsAt" | "notes";

type Props = {
  booking: BookingDetail;
  canEdit: boolean;
  onSaveField: (field: EditableBookingField, value: string) => Promise<void>;
};

function formatSheetDateTime(iso: string) {
  const date = new Date(iso);
  const includeYear = date.getFullYear() !== new Date().getFullYear();
  const day = date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    ...(includeYear ? { year: "numeric" as const } : {}),
  });
  const time = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${day} · ${time}`;
}

function ContextRow({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden={true} />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <div className="mt-1 text-sm leading-relaxed text-foreground">{children}</div>
      </div>
    </div>
  );
}

function NotesField({
  value,
  canEdit,
  onSave,
}: {
  value: string;
  canEdit: boolean;
  onSave: (value: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [editing, value]);

  async function commit() {
    if (draft.trim() === value.trim()) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(draft.trim());
      setEditing(false);
    } catch {
      return;
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-2">
        <Textarea
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              void commit();
            }
            if (event.key === "Escape") {
              setDraft(value);
              setEditing(false);
            }
          }}
          aria-label="Booking notes"
          placeholder="Add operational notes"
          className="resize-none"
        />
        <div className="flex items-center gap-1">
          <Button className="h-10" onClick={() => void commit()} loading={saving}>
            <CheckIcon className="size-4" />
            Save notes
          </Button>
          <Button className="h-10"
            variant="ghost"
            onClick={() => { setDraft(value); setEditing(false); }}
            disabled={saving}
          >
            <XIcon className="size-4" />
            Cancel
          </Button>
          <span className="ml-auto text-[11px] text-muted-foreground">⌘ Enter to save</span>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      className="group flex w-full items-start justify-between gap-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={canEdit ? () => setEditing(true) : undefined}
      disabled={!canEdit}
    >
      <span className={value ? "whitespace-pre-wrap" : "text-muted-foreground"}>
        {value || "No notes"}
      </span>
      {canEdit && <PencilIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />}
    </button>
  );
}

export default function BookingSheetOverview({ booking, canEdit, onSaveField }: Props) {
  const now = new Date();
  const isReservation = booking.kind === "RESERVATION";
  const minimumEndDate = minimumBookingEndDate(new Date(booking.startsAt)).toISOString();
  const timingLabel = isReservation
    ? formatStartsIn(booking.startsAt, now)
    : formatDueLabel(booking.endsAt, now);
  const timingVariant = booking.isOverdue
    ? "red"
    : !isReservation && isDueToday(booking.endsAt, now)
      ? "orange"
      : "secondary";
  const linkedEvents = booking.events?.length ? booking.events : booking.event ? [booking.event] : [];

  return (
    <div className="flex flex-col gap-3">
      <Card elevation="flat" className="overflow-hidden border-border/60 shadow-xs">
        <CardContent className="p-0">
          <div className="flex items-start justify-between gap-4 p-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground ring-1 ring-foreground/5">
                <CalendarClockIcon className="size-5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground">Due back</p>
                <div className="mt-1 text-base font-semibold text-foreground tabular-nums">
                  <InlineDateField
                    value={booking.endsAt}
                    canEdit={canEdit}
                    minDate={minimumEndDate}
                    formatValue={formatSheetDateTime}
                    onSave={(value) => onSaveField("endsAt", value)}
                  />
                </div>
              </div>
            </div>
            {booking.isActive && (
              <Badge variant={timingVariant} size="sm" className="shrink-0 tabular-nums">
                <Clock3Icon className="size-3" aria-hidden="true" />
                {timingLabel}
              </Badge>
            )}
          </div>
          <div className="grid grid-cols-2 border-t border-border/40 bg-muted/20">
            <div className="px-4 py-3">
              <p className="text-xs font-medium text-muted-foreground">{isReservation ? "Starts" : "Checked out"}</p>
              <div className="mt-1 text-sm font-medium tabular-nums">
                <InlineDateField
                  value={booking.startsAt}
                  canEdit={canEdit && isReservation}
                  formatValue={formatSheetDateTime}
                  onSave={(value) => onSaveField("startsAt", value)}
                />
              </div>
            </div>
            <div className="border-l border-border/40 px-4 py-3">
              <p className="text-xs font-medium text-muted-foreground">Duration</p>
              <p className="mt-1 text-sm font-medium tabular-nums">{formatDuration(booking.startsAt, booking.endsAt)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card elevation="flat" className="border-border/60 shadow-xs">
        <CardContent className="divide-y divide-border/40 p-4">
          <ContextRow icon={MapPinIcon} label="Pickup">
            <span>{booking.location?.name ?? "Location not set"}</span>
            {booking.pickupKioskDevice && (
              <span className="block text-xs text-muted-foreground">
                Picked up at {booking.pickupKioskDevice.name}
                {booking.pickupKioskDevice.location?.name && ` · ${booking.pickupKioskDevice.location.name}`}
              </span>
            )}
          </ContextRow>

          {linkedEvents.length > 0 && (
            <ContextRow icon={CalendarDaysIcon} label={linkedEvents.length > 1 ? "Events" : "Event"}>
              <div className="flex flex-col gap-1.5">
                {linkedEvents.map((event) => (
                  <Link key={event.id} href={`/events/${event.id}`} className="inline-flex min-w-0 items-center gap-2 hover:underline">
                    <span className="truncate">{event.summary}</span>
                    {event.sportCode && <Badge variant="outline" size="sm">{event.sportCode}</Badge>}
                  </Link>
                ))}
              </div>
            </ContextRow>
          )}

          {booking.kit && (
            <ContextRow icon={PackageCheckIcon} label="Kit">
              <Link href={`/kits/${booking.kit.id}`} className="hover:underline">{booking.kit.name}</Link>
            </ContextRow>
          )}

          {booking.sourceReservation && (
            <ContextRow icon={LinkIcon} label="Converted from">
              <Link href={`/reservations/${booking.sourceReservation.id}`} className="text-primary hover:underline">
                {booking.sourceReservation.refNumber || booking.sourceReservation.title}
              </Link>
            </ContextRow>
          )}

          {(booking.notes || canEdit) && (
            <ContextRow icon={NotebookTextIcon} label="Notes">
              <NotesField value={booking.notes ?? ""} canEdit={canEdit} onSave={(value) => onSaveField("notes", value)} />
            </ContextRow>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
        <UserAvatar
          name={booking.creator?.name ?? booking.requester?.name ?? "Unknown"}
          avatarUrl={booking.creator?.avatarUrl ?? booking.requester?.avatarUrl}
          size="xs"
        />
        <span className="truncate">
          Created by {booking.creator?.name ?? booking.requester?.name ?? "Unknown"} · {formatDateTime(booking.createdAt)}
        </span>
      </div>
    </div>
  );
}
