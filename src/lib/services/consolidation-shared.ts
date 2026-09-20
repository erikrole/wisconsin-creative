import { unique } from "@/lib/utils";
type EventLinkedCandidate = {
  eventId: string | null;
  events: { eventId: string }[];
};

export function eventIdsFor(booking: EventLinkedCandidate) {
  return booking.events.length > 0
    ? booking.events.map((event) => event.eventId).sort()
    : booking.eventId ? [booking.eventId] : [];
}

export function sameStrings(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function combinedNotes(bookings: { notes: string | null }[]) {
  const notes = unique(bookings.map((booking) => booking.notes?.trim()).filter(Boolean));
  return notes.length > 0 ? notes.join("\n\n") : null;
}
