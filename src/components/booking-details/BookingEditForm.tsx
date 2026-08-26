"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import type { BookingDetail } from "./types";
import { minimumBookingEndDate } from "@/lib/quarter-hour";

type Props = {
  booking: BookingDetail;
  editTitle: string;
  editStartsAt: string;
  editEndsAt: string;
  editNotes: string;
  saving: boolean;
  onEditTitle: (v: string) => void;
  onEditStartsAt: (v: string) => void;
  onEditEndsAt: (v: string) => void;
  onEditNotes: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
};

import { toLocalDateTimeValue } from "./helpers";

/** Convert datetime-local string back to Date (treats string as local time) */
function parseLocalDateTime(s: string): Date | undefined {
  if (!s) return undefined;
  const [datePart, timePart] = s.split("T");
  if (!datePart || !timePart) return undefined;
  const dateParts = datePart.split("-").map(Number);
  const timeParts = timePart.split(":").map(Number);
  const y = dateParts[0] ?? 0, mo = dateParts[1] ?? 0, d = dateParts[2] ?? 0;
  const h = timeParts[0] ?? 0, mi = timeParts[1] ?? 0;
  const date = new Date(y, mo - 1, d, h, mi);
  return isNaN(date.getTime()) ? undefined : date;
}

export default function BookingEditForm({
  booking,
  editTitle,
  editStartsAt,
  editEndsAt,
  editNotes,
  saving,
  onEditTitle,
  onEditStartsAt,
  onEditEndsAt,
  onEditNotes,
  onSave,
  onCancel,
}: Props) {
	  const startsAt = parseLocalDateTime(editStartsAt) ?? new Date(booking.startsAt);
	  const minimumEndDate = minimumBookingEndDate(startsAt);
	  return (
	    <div className="px-5 py-4">
	      <div className="mb-3 flex flex-col gap-1">
	        <Label htmlFor="booking-edit-title">Title</Label>
	        <Input
	          id="booking-edit-title"
	          name="title"
	          value={editTitle}
	          onChange={(e) => onEditTitle(e.target.value)}
	        />
      </div>

	      <div className="flex gap-3">
	        {booking.kind === "RESERVATION" && (
	          <div className="mb-3 flex flex-col gap-1 flex-1">
	            <Label htmlFor="booking-edit-start">Start</Label>
	            <DateTimePicker
	              id="booking-edit-start"
	              name="startsAt"
	              value={parseLocalDateTime(editStartsAt)}
	              onChange={(d) => onEditStartsAt(toLocalDateTimeValue(d))}
	            />
	          </div>
	        )}
	        <div className="mb-3 flex flex-col gap-1 flex-1">
	          <Label htmlFor="booking-edit-end">{booking.kind === "RESERVATION" ? "End" : "Due date"}</Label>
	          <DateTimePicker
	            id="booking-edit-end"
	            name="endsAt"
	            value={parseLocalDateTime(editEndsAt)}
	            onChange={(d) => onEditEndsAt(toLocalDateTimeValue(d))}
	            minDate={minimumEndDate}
	          />
	        </div>
	      </div>

	      <div className="mb-3 flex flex-col gap-1">
	        <Label htmlFor="booking-edit-notes">Notes</Label>
	        <Textarea
	          id="booking-edit-notes"
	          name="notes"
	          rows={3}
          value={editNotes}
          onChange={(e) => onEditNotes(e.target.value)}
        />
      </div>

      <div className="flex gap-2 mt-4">
        <Button
          loading={saving}
          onClick={onSave}
        >
          Save changes
        </Button>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
