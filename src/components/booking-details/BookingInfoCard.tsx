"use client";

import { useCallback, useEffect, useId, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { UserAvatar } from "@/components/UserAvatar";
import { SaveableField, useSaveField, FieldGroup } from "@/components/SaveableField";
import { InlineDateField } from "./InlineDateField";
import { BoxesIcon, CameraIcon, LinkIcon, TriangleAlert } from "lucide-react";
import { formatDateTime, formatDuration } from "@/lib/format";
import { minimumBookingEndDate } from "@/lib/quarter-hour";
import type { BookingDetail, BookingPhoto } from "./types";

type Props = {
  booking: BookingDetail;
  canEdit: boolean;
  /** PATCH a single booking field. */
  onSave: (field: string, value: unknown) => Promise<BookingDetail>;
  /** Optimistically patch local booking state. */
  onPatch: (patch: Partial<BookingDetail>) => void;
  /** When true, drops the outer Card chrome (for use inside a sheet). */
  bare?: boolean;
};

export default function BookingInfoCard({
  booking,
  canEdit,
  onSave,
  onPatch,
  bare = false,
}: Props) {
  const isReservation = booking.kind === "RESERVATION";
  const minimumEndDate = minimumBookingEndDate(new Date(booking.startsAt)).toISOString();

  const saveStart = useCallback(
    async (iso: string) => {
      const updated = await onSave("startsAt", iso);
      onPatch(updated);
    },
    [onSave, onPatch],
  );

  const saveEnd = useCallback(
    async (iso: string) => {
      const updated = await onSave("endsAt", iso);
      onPatch(updated);
    },
    [onSave, onPatch],
  );

  const body = (
    <>
      <FieldGroup label="Schedule">
        <SaveableField label={isReservation ? "Start" : "Checked out"}>
          <InlineDateField
            value={booking.startsAt}
            canEdit={canEdit && isReservation}
            onSave={saveStart}
          />
        </SaveableField>
        <SaveableField label={isReservation ? "End" : "Due back"}>
          <InlineDateField
            value={booking.endsAt}
            canEdit={canEdit}
            onSave={saveEnd}
            minDate={minimumEndDate}
          />
        </SaveableField>
        <SaveableField label="Duration">
          <span className="text-sm">{formatDuration(booking.startsAt, booking.endsAt)}</span>
        </SaveableField>
      </FieldGroup>

      <FieldGroup label="People">
        <SaveableField label="Requester">
          <span className="inline-flex min-w-0 items-center gap-2 text-sm">
            <UserAvatar
              name={booking.requester?.name ?? "Unknown"}
              avatarUrl={booking.requester?.avatarUrl}
              size="sm"
              className="shrink-0"
            />
            <span className="min-w-0">
              <span className="block truncate">{booking.requester?.name ?? "Unknown"}</span>
              {booking.requester?.email && (
                <span className="block truncate text-xs text-muted-foreground">
                  {booking.requester.email}
                </span>
              )}
            </span>
          </span>
        </SaveableField>
        {booking.creator ? (
          <SaveableField label="Created by">
            <span className="inline-flex min-w-0 items-center gap-2 text-sm">
              <UserAvatar
                name={booking.creator.name}
                avatarUrl={booking.creator.avatarUrl}
                size="sm"
                className="shrink-0"
              />
              <span className="min-w-0">
                <span className="block truncate">{booking.creator.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {formatDateTime(booking.createdAt)}
                </span>
              </span>
            </span>
          </SaveableField>
        ) : (
          <SaveableField label="Created">
            <span className="text-sm">{formatDateTime(booking.createdAt)}</span>
          </SaveableField>
        )}
      </FieldGroup>

      <FieldGroup label="Context">
        <SaveableField label="Pickup location">
          <span className="text-sm">{booking.location?.name ?? "—"}</span>
        </SaveableField>
        {booking.pickupKioskDevice && (
          <SaveableField label="Picked up at">
            <span className="text-sm">
              {booking.pickupKioskDevice.name}
              {booking.pickupKioskDevice.location?.name && (
                <span className="text-muted-foreground"> · {booking.pickupKioskDevice.location.name}</span>
              )}
            </span>
          </SaveableField>
        )}
        {booking.events && booking.events.length > 1 ? (
          <SaveableField label="Events">
            <div className="flex flex-col gap-1.5 text-sm">
              {booking.events.map((ev) => (
                <Link
                  key={ev.id}
                  href={`/events/${ev.id}`}
                  className="inline-flex items-center gap-1.5 hover:underline"
                >
                  <span className="truncate">{ev.summary}</span>
                  {ev.sportCode && <Badge variant="outline" size="sm">{ev.sportCode}</Badge>}
                </Link>
              ))}
            </div>
          </SaveableField>
        ) : booking.event ? (
          <SaveableField label="Event">
            <span className="inline-flex items-center gap-1.5 text-sm">
              <Link href={`/events/${booking.event.id}`} className="truncate hover:underline">
                {booking.event.summary}
              </Link>
              {booking.event.sportCode && (
                <Badge variant="outline" size="sm">{booking.event.sportCode}</Badge>
              )}
            </span>
          </SaveableField>
        ) : null}
        {booking.shiftAssignment && (
          <SaveableField label="Shift">
            <Badge variant="outline" size="sm">{booking.shiftAssignment.shift.area}</Badge>
          </SaveableField>
        )}
        {booking.kit && (
          <SaveableField label="Kit">
            <Link
              href={`/kits/${booking.kit.id}`}
              className="inline-flex items-center gap-1.5 text-sm hover:underline"
            >
              <BoxesIcon className="size-3.5 text-muted-foreground" />
              <Badge variant="outline" className="font-normal">{booking.kit.name}</Badge>
            </Link>
          </SaveableField>
        )}
        {booking.sourceReservation && (
          <SaveableField label="Converted from">
            <Link
              href={`/reservations/${booking.sourceReservation.id}`}
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
            >
              <LinkIcon className="size-3.5" />
              {booking.sourceReservation.refNumber || booking.sourceReservation.title}
            </Link>
          </SaveableField>
        )}
      </FieldGroup>

      <FieldGroup label="Notes">
        <NotesField
          value={booking.notes ?? ""}
          canEdit={canEdit}
          onSave={async (v) => {
            const updated = await onSave("notes", v || null);
            onPatch(updated);
          }}
        />
      </FieldGroup>

      {booking.photos && booking.photos.length > 0 && (
        <FieldGroup label="Condition photos">
          <ConditionPhotos photos={booking.photos} />
        </FieldGroup>
      )}

      {booking.locationMode === "MIXED" && booking.itemLocations.length > 1 && (
        <Alert className="rounded-none border-x-0 border-b-0">
          <TriangleAlert className="size-4" />
          <AlertDescription>
            Equipment spans multiple locations:{" "}
            {booking.itemLocations.map((l) => l.name).join(", ")}
          </AlertDescription>
        </Alert>
      )}
    </>
  );

  if (bare) return <div className="py-1">{body}</div>;

  return (
    <Card className="details-card border-border/40">
      <div className="py-1">{body}</div>
    </Card>
  );
}

/* ── Notes Field (inline-editable textarea) ─────────────── */

function NotesField({
  value,
  canEdit,
  onSave,
}: {
  value: string;
  canEdit: boolean;
  onSave: (v: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(value);
  const saveField = useSaveField(onSave);
  const fieldId = useId();

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const isDirty = draft.trim() !== (value || "");

  async function commit() {
    if (saveField.isSaving) return;
    const trimmed = draft.trim();
    if (trimmed === (value || "")) return;
    await saveField.save(trimmed);
  }

  function cancel() {
    setDraft(value);
    saveField.reset();
  }

  return (
    <SaveableField
      label="Notes"
      status={saveField.status}
      isDirty={canEdit && isDirty}
      onCommit={commit}
      onCancel={cancel}
      className="items-start"
      labelClassName="pt-2"
      htmlFor={fieldId}
    >
      {canEdit ? (
        <Textarea
          id={fieldId}
          name="notes"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") cancel();
          }}
          placeholder="Add notes..."
          disabled={saveField.isSaving}
          aria-busy={saveField.isSaving}
          rows={3}
          className="resize-none text-sm"
        />
      ) : (
        <p className="whitespace-pre-wrap py-1.5 text-sm">
          {value || <span className="text-muted-foreground">No notes</span>}
        </p>
      )}
    </SaveableField>
  );
}

/* ── Condition Photos ───────────────────────────────────── */

function ConditionPhotos({ photos }: { photos: BookingPhoto[] }) {
  const checkoutPhotos = photos.filter((p) => p.phase === "CHECKOUT");
  const checkinPhotos = photos.filter((p) => p.phase === "CHECKIN");

  return (
    <div className="px-3 py-2">
      <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <CameraIcon className="size-3.5" />
        Logged at checkout and check-in
      </div>
      <div className="grid grid-cols-2 gap-3">
        {checkoutPhotos.length > 0 && <PhotoGroup label="Checkout" photos={checkoutPhotos} />}
        {checkinPhotos.length > 0 && <PhotoGroup label="Check-in" photos={checkinPhotos} />}
      </div>
    </div>
  );
}

function PhotoGroup({ label, photos }: { label: string; photos: BookingPhoto[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {photos.map((photo) => (
        <a
          key={photo.id}
          href={photo.imageUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block overflow-hidden rounded-lg border border-border transition-colors hover:border-foreground/20"
        >
          <Image
            src={photo.imageUrl}
            alt={`${label} condition photo`}
            width={800}
            height={600}
            className="h-auto w-full object-cover"
          />
        </a>
      ))}
      <span className="text-[11px] text-muted-foreground">
        by {photos[0]!.actor.name} &middot; {formatDateTime(photos[0]!.createdAt)}
      </span>
    </div>
  );
}
