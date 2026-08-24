import { BookingKind, type Prisma } from "@prisma/client";
import { env } from "@/lib/env";
import { db } from "@/lib/db";
import type {
  ScheduleChangeEventSummary,
  ScheduleChangeHistorySnapshot,
  ScheduleChangeItem,
  ScheduleChangeKind,
} from "@/lib/schedule-change-history-types";
import { shiftWorkerSlotLabel } from "@/lib/shift-display";

type ScheduleChangeHistoryInput = {
  eventIds: string[];
  limitPerEvent?: number;
  since?: Date;
  /** Working-copy edits are private to internal staffing surfaces. */
  includeWorkingCopy?: boolean;
};

type AuditRow = {
  id: string;
  actorUserId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  beforeJson: Prisma.JsonValue | null;
  afterJson: Prisma.JsonValue | null;
  createdAt: Date;
  actor: { id: string; name: string | null; role: string } | null;
};

type ShiftLookup = {
  id: string;
  eventId: string;
  label: string;
  publishedAt: Date | null;
};

type AssignmentLookup = {
  id: string;
  eventId: string;
  label: string;
  publishedAt: Date | null;
};

type BookingLookup = {
  id: string;
  eventIds: string[];
  label: string;
  kind: BookingKind;
  publishedAtByEvent: Map<string, Date | null>;
};

const REVIEW_ACTION_EXCEPTIONS = new Set([
  "shift_group_published",
  "shift_group_republished",
  "shift_acknowledged",
]);

const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function unique(values: string[]) {
  return [...new Set(values)];
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatDateLike(value: unknown) {
  const raw = stringValue(value);
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  // Rendered on the server, which has no timezone of its own -- a bare
  // `toLocaleString` here reports every schedule change five or six hours off.
  return date.toLocaleString("en-US", {
    timeZone: env.appTimezone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function changedFieldDetail(before: Record<string, unknown>, after: Record<string, unknown>, fields: string[]) {
  for (const field of fields) {
    if (before[field] === after[field]) continue;
    const next = formatDateLike(after[field]) ?? stringValue(after[field]);
    if (next) return `${field}: ${next}`;
  }
  return null;
}

function workingScheduleActionMeta(row: AuditRow): { kind: ScheduleChangeKind; label: string; detail: string | null } | null {
  const command = jsonObject(jsonObject(row.beforeJson).command);
  const commandType = stringValue(command.type);
  if (!commandType) return null;

  switch (commandType) {
    case "assign":
      return { kind: "assignment_assigned", label: "Assigned worker", detail: "Working copy" };
    case "unassign":
      return { kind: "assignment_removed", label: "Removed worker", detail: "Working copy" };
    case "convertAndReplace":
      return { kind: "assignment_updated", label: "Replaced worker", detail: "Working copy" };
    case "setCallWindow":
    case "setCallWindowForAll":
      return { kind: "assignment_updated", label: "Updated call time", detail: "Working copy" };
    case "adjustSlots": {
      const delta = numberValue(command.delta);
      return delta === -1
        ? { kind: "shift_deleted", label: "Removed shift", detail: "Working copy" }
        : { kind: "shift_created", label: "Added shift", detail: "Working copy" };
    }
    case "removeSlot":
      return { kind: "shift_deleted", label: "Removed shift", detail: "Working copy" };
    case "convertSlot":
      return { kind: "shift_updated", label: "Converted shift", detail: "Working copy" };
    default:
      return null;
  }
}

function actionMeta(row: AuditRow, lookup: {
  shift?: ShiftLookup;
  assignment?: AssignmentLookup;
  booking?: BookingLookup;
}): { kind: ScheduleChangeKind; label: string; detail: string | null } {
  const before = jsonObject(row.beforeJson);
  const after = jsonObject(row.afterJson);

  if (row.entityType === "shift_group_working_copy") {
    return workingScheduleActionMeta(row) ?? {
      kind: "unknown",
      label: row.action.replaceAll("_", " "),
      detail: null,
    };
  }

  switch (row.action) {
    case "shift_assigned":
      return { kind: "assignment_assigned", label: "Assigned worker", detail: lookup.assignment?.label ?? null };
    case "shift_assignment_removed":
      return { kind: "assignment_removed", label: "Removed worker", detail: lookup.assignment?.label ?? null };
    case "shift_assignment_updated":
      return {
        kind: "assignment_updated",
        label: "Updated call time",
        detail: changedFieldDetail(before, after, ["callStartsAt", "callEndsAt", "callNote"]) ?? lookup.assignment?.label ?? null,
      };
    case "shift_created":
    case "shift_added":
      return { kind: "shift_created", label: "Added shift", detail: lookup.shift?.label ?? null };
    case "shift_updated":
      return {
        kind: "shift_updated",
        label: "Updated shift time",
        detail: changedFieldDetail(before, after, ["callStartsAt", "callEndsAt", "startsAt", "endsAt"]) ?? lookup.shift?.label ?? null,
      };
    case "shift_deleted":
    case "shift_removed":
      return { kind: "shift_deleted", label: "Removed shift", detail: lookup.shift?.label ?? null };
    case "shift_swapped":
      return { kind: "assignment_updated", label: "Swapped workers", detail: lookup.assignment?.label ?? null };
    case "shift_request_approved":
      return { kind: "assignment_assigned", label: "Approved shift request", detail: lookup.assignment?.label ?? null };
    case "shift_request_declined":
      return { kind: "assignment_removed", label: "Declined shift request", detail: lookup.assignment?.label ?? null };
    case "shift_assignment_acknowledged":
      return { kind: "assignment_updated", label: "Acknowledged shift", detail: lookup.assignment?.label ?? null };
    case "shift_assignment_role_slot_repaired":
      return { kind: "assignment_updated", label: "Repaired role slot", detail: lookup.assignment?.label ?? null };
    case "shift_backfill_executed":
      return { kind: "copy_forward_applied", label: "Backfilled schedule", detail: null };
    case "shift_group_regenerated":
      return { kind: "republished", label: "Regenerated schedule", detail: null };
    case "shift_group_updated":
      return { kind: "shift_updated", label: "Updated schedule settings", detail: null };
    case "shift_group_published":
      return { kind: "published", label: "Published schedule", detail: null };
    case "shift_group_republished":
      return { kind: "republished", label: "Republished schedule", detail: null };
    case "shift_group_copy_forward_applied": {
      const assigned = numberValue(after.assigned);
      return { kind: "copy_forward_applied", label: "Copied crew forward", detail: assigned !== null ? `${assigned} assigned` : null };
    }
    case "shift_pickup_requested":
      return { kind: "pickup_requested", label: "Pickup requested", detail: lookup.assignment?.label ?? null };
    case "shift_pickup_claimed":
      return { kind: "pickup_claimed", label: "Open shift claimed", detail: lookup.assignment?.label ?? null };
    case "created":
      if (row.entityType === "booking" && lookup.booking?.kind === BookingKind.RESERVATION) {
        return { kind: "reservation_linked", label: "Reserved gear", detail: lookup.booking.label };
      }
      break;
    case "calendar_event_created":
      return { kind: "event_created", label: "Created event", detail: stringValue(after.summary) };
    case "calendar_event_updated":
      return { kind: "event_updated", label: "Updated event details", detail: changedFieldDetail(before, after, ["summary", "startsAt", "endsAt", "locationId", "subtitle"]) };
    case "calendar_event_visibility_updated":
      return { kind: "event_visibility_updated", label: "Updated visibility", detail: null };
    case "shift_group_archived":
      return { kind: "shift_group_archived", label: "Archived schedule", detail: null };
    default:
      break;
  }

  const humanized = row.action.replaceAll("_", " ");
  return {
    kind: "unknown",
    label: humanized.charAt(0).toUpperCase() + humanized.slice(1),
    detail: null,
  };
}

function targetFor(row: AuditRow, lookup: {
  shift?: ShiftLookup;
  assignment?: AssignmentLookup;
  booking?: BookingLookup;
}): ScheduleChangeItem["target"] {
  if (row.entityType === "calendar_event") return { type: "event", id: row.entityId, label: null };
  if (row.entityType === "shift_group") return { type: "shift_group", id: row.entityId, label: null };
  if (row.entityType === "shift_group_working_copy") return { type: "shift_group", id: row.entityId, label: null };
  if (row.entityType === "shift") return { type: "shift", id: row.entityId, label: lookup.shift?.label ?? null };
  if (row.entityType === "shift_assignment") return { type: "assignment", id: row.entityId, label: lookup.assignment?.label ?? null };
  if (row.entityType === "booking") return { type: "booking", id: row.entityId, label: lookup.booking?.label ?? null };
  return { type: "unknown", id: row.entityId, label: null };
}

function emptySummary(eventId: string): ScheduleChangeEventSummary {
  return {
    eventId,
    count: 0,
    latestAt: null,
    hasRecentChanges: false,
    needsReview: false,
    items: [],
  };
}

export async function getScheduleChangeHistory({
  eventIds,
  limitPerEvent = 5,
  since,
  includeWorkingCopy = false,
}: ScheduleChangeHistoryInput): Promise<ScheduleChangeHistorySnapshot> {
  const scopedEventIds = unique(eventIds).filter(Boolean);
  const events = Object.fromEntries(scopedEventIds.map((eventId) => [eventId, emptySummary(eventId)]));
  if (scopedEventIds.length === 0) return { events };

  const groups = await db.shiftGroup.findMany({
    where: { eventId: { in: scopedEventIds } },
    select: {
      id: true,
      eventId: true,
      publishedAt: true,
      shifts: {
        select: {
          id: true,
          area: true,
          workerType: true,
          assignments: {
            select: {
              id: true,
              user: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  const groupEvent = new Map<string, string>();
  const groupPublishedAt = new Map<string, Date | null>();
  const shiftLookup = new Map<string, ShiftLookup>();
  const assignmentLookup = new Map<string, AssignmentLookup>();

  for (const group of groups) {
    groupEvent.set(group.id, group.eventId);
    groupPublishedAt.set(group.eventId, group.publishedAt);
    for (const shift of group.shifts) {
      const shiftLabel = `${shift.area} ${shiftWorkerSlotLabel(shift.workerType)}`;
      shiftLookup.set(shift.id, {
        id: shift.id,
        eventId: group.eventId,
        label: shiftLabel,
        publishedAt: group.publishedAt,
      });
      for (const assignment of shift.assignments) {
        assignmentLookup.set(assignment.id, {
          id: assignment.id,
          eventId: group.eventId,
          label: assignment.user?.name ? `${assignment.user.name} · ${shiftLabel}` : shiftLabel,
          publishedAt: group.publishedAt,
        });
      }
    }
  }

  const assignmentIds = [...assignmentLookup.keys()];
  const bookingFilters: Prisma.BookingWhereInput[] = [
    { eventId: { in: scopedEventIds } },
    { events: { some: { eventId: { in: scopedEventIds } } } },
    ...(assignmentIds.length ? [{ shiftAssignmentId: { in: assignmentIds } }] : []),
  ];
  const bookings = await db.booking.findMany({
    where: { OR: bookingFilters },
    select: {
      id: true,
      kind: true,
      title: true,
      eventId: true,
      shiftAssignmentId: true,
      events: { select: { eventId: true } },
    },
    take: 500,
  });

  const bookingLookup = new Map<string, BookingLookup>();
  for (const booking of bookings) {
    const linkedEventIds = new Set<string>();
    if (booking.eventId) linkedEventIds.add(booking.eventId);
    for (const link of booking.events) linkedEventIds.add(link.eventId);
    if (booking.shiftAssignmentId) {
      const assignment = assignmentLookup.get(booking.shiftAssignmentId);
      if (assignment) linkedEventIds.add(assignment.eventId);
    }
    const mappedEventIds = [...linkedEventIds].filter((eventId) => events[eventId]);
    if (mappedEventIds.length === 0) continue;
    bookingLookup.set(booking.id, {
      id: booking.id,
      eventIds: mappedEventIds,
      label: booking.title,
      kind: booking.kind,
      publishedAtByEvent: new Map(mappedEventIds.map((eventId) => [eventId, groupPublishedAt.get(eventId) ?? null])),
    });
  }

  const auditFilters: Prisma.AuditLogWhereInput[] = [
    { entityType: "calendar_event", entityId: { in: scopedEventIds } },
    ...(groupEvent.size ? [{ entityType: "shift_group", entityId: { in: [...groupEvent.keys()] } }] : []),
    ...(includeWorkingCopy && groupEvent.size ? [{ entityType: "shift_group_working_copy", entityId: { in: [...groupEvent.keys()] } }] : []),
    ...(shiftLookup.size ? [{ entityType: "shift", entityId: { in: [...shiftLookup.keys()] } }] : []),
    ...(assignmentLookup.size ? [{ entityType: "shift_assignment", entityId: { in: [...assignmentLookup.keys()] } }] : []),
    ...(bookingLookup.size ? [{ entityType: "booking", entityId: { in: [...bookingLookup.keys()] } }] : []),
  ];

  const auditRows = await db.auditLog.findMany({
    where: {
      OR: auditFilters,
      ...(since ? { createdAt: { gte: since } } : {}),
    },
    include: { actor: { select: { id: true, name: true, role: true } } },
    orderBy: { createdAt: "desc" },
    take: Math.max(scopedEventIds.length * limitPerEvent * 4, 50),
  }) as AuditRow[];

  const now = Date.now();
  for (const row of auditRows) {
    const booking = row.entityType === "booking" ? bookingLookup.get(row.entityId) : undefined;
    const affectedEventIds =
      row.entityType === "calendar_event" ? [row.entityId]
      : row.entityType === "shift_group" ? [groupEvent.get(row.entityId)].filter((value): value is string => Boolean(value))
      : row.entityType === "shift_group_working_copy" ? [groupEvent.get(row.entityId)].filter((value): value is string => Boolean(value))
      : row.entityType === "shift" ? [shiftLookup.get(row.entityId)?.eventId].filter((value): value is string => Boolean(value))
      : row.entityType === "shift_assignment" ? [assignmentLookup.get(row.entityId)?.eventId].filter((value): value is string => Boolean(value))
      : row.entityType === "booking" ? booking?.eventIds ?? []
      : [];
    if (affectedEventIds.length === 0) continue;

    const shift = row.entityType === "shift" ? shiftLookup.get(row.entityId) : undefined;
    const assignment = row.entityType === "shift_assignment" ? assignmentLookup.get(row.entityId) : undefined;
    const meta = actionMeta(row, { shift, assignment, booking });
    if (meta.kind === "unknown" && row.entityType === "booking") continue;

    for (const eventId of affectedEventIds) {
      const summary = events[eventId];
      if (!summary || summary.items.length >= limitPerEvent) continue;
      const publishedAt = row.entityType === "booking"
        ? booking?.publishedAtByEvent.get(eventId) ?? null
        : row.entityType === "shift_group"
          ? groupPublishedAt.get(eventId) ?? null
          : shift?.publishedAt ?? assignment?.publishedAt ?? groupPublishedAt.get(eventId) ?? null;
      const afterPublication = Boolean(publishedAt && row.createdAt.getTime() > publishedAt.getTime());
      const needsReview = afterPublication && !REVIEW_ACTION_EXCEPTIONS.has(row.action);
      const item: ScheduleChangeItem = {
        id: row.id,
        eventId,
        entityType: row.entityType,
        entityId: row.entityId,
        action: row.action,
        kind: meta.kind,
        label: meta.label,
        detail: meta.detail,
        actorId: row.actorUserId,
        actorName: row.actor?.name ?? "System",
        actorRole: row.actor?.role ?? stringValue(jsonObject(row.afterJson)._actorRole),
        createdAt: row.createdAt.toISOString(),
        target: targetFor(row, { shift, assignment, booking }),
        afterPublication,
        needsReview,
        source: "audit",
      };
      summary.items.push(item);
      summary.count += 1;
      summary.latestAt ??= item.createdAt;
      summary.hasRecentChanges ||= now - row.createdAt.getTime() <= RECENT_WINDOW_MS;
      summary.needsReview ||= needsReview;
    }
  }

  return { events };
}
