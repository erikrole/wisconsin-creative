import { ShiftArea, ShiftAssignmentSource, ShiftWorkerType } from "@prisma/client";
import { z } from "zod";

const isoDate = z.string().datetime({ offset: true });

export const workingAssignmentSchema = z.object({
  sourceAssignmentId: z.string().min(1).nullable(),
  source: z.nativeEnum(ShiftAssignmentSource).optional(),
  userId: z.string().min(1),
  status: z.enum(["DIRECT_ASSIGNED", "APPROVED"]),
  callStartsAt: isoDate.nullable(),
  callEndsAt: isoDate.nullable(),
  callNote: z.string().max(5000).nullable(),
  activeTradeId: z.string().min(1).nullable(),
  bookingCount: z.number().int().min(0),
});

export const workingSlotSchema = z.object({
  key: z.string().min(1),
  sourceShiftId: z.string().min(1).nullable(),
  area: z.nativeEnum(ShiftArea),
  workerType: z.nativeEnum(ShiftWorkerType),
  startsAt: isoDate,
  endsAt: isoDate,
  callStartsAt: isoDate.nullable(),
  callEndsAt: isoDate.nullable(),
  notes: z.string().max(5000).nullable(),
  assignmentHistoryCount: z.number().int().min(0).default(0),
  assignment: workingAssignmentSchema.nullable(),
});

export const workingSchedulePayloadSchema = z.object({
  eventStartsAt: isoDate,
  eventEndsAt: isoDate,
  /**
   * The live shift IDs this draft was snapshotted from (payloadVersion 2+).
   *
   * A shift absent from `slots` means one of two opposite things: the user
   * removed it, or it was added to the live schedule after this draft started
   * and the draft never saw it. Only this list answers that exactly. Drafts
   * written before payloadVersion 2 omit it and fall back to comparing the
   * shift's `createdAt` against the working copy's, which is a good proxy but
   * still a proxy.
   */
  baseShiftIds: z.array(z.string().min(1)).max(250).optional(),
  slots: z.array(workingSlotSchema).max(250),
}).superRefine((payload, ctx) => {
  if (new Date(payload.eventEndsAt) <= new Date(payload.eventStartsAt)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Event end must be after event start" });
  }

  const keys = new Set<string>();
  for (const [index, slot] of payload.slots.entries()) {
    if (keys.has(slot.key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["slots", index, "key"],
        message: "Working slot keys must be unique",
      });
    }
    keys.add(slot.key);
    if (new Date(slot.endsAt) <= new Date(slot.startsAt)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["slots", index, "endsAt"],
        message: "Shift end must be after shift start",
      });
    }
    if (Boolean(slot.callStartsAt) !== Boolean(slot.callEndsAt)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["slots", index],
        message: "Call start and end must both be set or both be empty",
      });
    }
    if (slot.callStartsAt && slot.callEndsAt && new Date(slot.callEndsAt) <= new Date(slot.callStartsAt)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["slots", index, "callEndsAt"],
        message: "Call end must be after call start",
      });
    }
    // Personal overrides carry the same pair invariant as the slot window.
    // `effectiveCallWindow` only honours an override when both sides are set,
    // while the reads that chain `??` per field would mix a personal start with
    // a slot end. Publishing writes this payload straight onto ShiftAssignment,
    // so an unvalidated half pair here bypasses the REST-route guards.
    const assignment = slot.assignment;
    if (assignment) {
      if (Boolean(assignment.callStartsAt) !== Boolean(assignment.callEndsAt)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["slots", index, "assignment"],
          message: "Call start and end must both be set or both be empty",
        });
      }
      if (
        assignment.callStartsAt
        && assignment.callEndsAt
        && new Date(assignment.callEndsAt) <= new Date(assignment.callStartsAt)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["slots", index, "assignment", "callEndsAt"],
          message: "Call end must be after call start",
        });
      }
    }
  }
});

export type WorkingSchedulePayload = z.infer<typeof workingSchedulePayloadSchema>;
export type WorkingScheduleSlot = z.infer<typeof workingSlotSchema>;
export type WorkingScheduleDefaultWindow = {
  startsAt: string;
  endsAt: string;
};

/**
 * Server-owned inverse operations for the private Schedule working copy.
 *
 * Snapshots live with the working copy rather than in a client cache so an
 * undo or redo cannot silently overwrite a newer operator's edit. The stack
 * is bounded in the persistence layer to keep a long-lived draft predictable.
 */
export const WORKING_SCHEDULE_HISTORY_LIMIT = 50;

export const workingScheduleHistoryEntrySchema = z.object({
  id: z.string().min(1),
  actorId: z.string().min(1),
  commandType: z.string().min(1),
  label: z.string().min(1).max(160),
  before: workingSchedulePayloadSchema,
  after: workingSchedulePayloadSchema,
});

export const workingScheduleHistoryStackSchema = z.array(workingScheduleHistoryEntrySchema)
  .max(WORKING_SCHEDULE_HISTORY_LIMIT);

export type WorkingScheduleHistoryEntry = z.infer<typeof workingScheduleHistoryEntrySchema>;

function titleCaseScheduleWord(value: string) {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

function scheduleWorkerTypeLabel(workerType: string) {
  return workerType === "FT" ? "Staff" : "Student";
}

/** A short verb-led label suitable for Undo/Redo menus and buttons. */
export function workingScheduleCommandLabel(
  command: WorkingScheduleCommand,
  before: WorkingSchedulePayload,
  after: WorkingSchedulePayload,
) {
  const slotFor = (slotKey: string | undefined) =>
    after.slots.find((slot) => slot.key === slotKey)
    ?? before.slots.find((slot) => slot.key === slotKey);

  switch (command.type) {
    case "adjustSlots":
      return `${command.delta > 0 ? "Add" : "Remove"} ${scheduleWorkerTypeLabel(command.workerType)} ${titleCaseScheduleWord(command.area)} slot`;
    case "convertSlot": {
      const slot = slotFor(command.slotKey);
      return `Convert ${slot ? titleCaseScheduleWord(slot.area) : "schedule"} slot to ${scheduleWorkerTypeLabel(command.workerType)}`;
    }
    case "convertAndReplace": {
      const slot = slotFor(command.slotKey);
      return `Replace ${slot ? titleCaseScheduleWord(slot.area) : "schedule"} worker with ${scheduleWorkerTypeLabel(command.workerType)}`;
    }
    case "assign": {
      const slot = slotFor(command.slotKey);
      return `Assign ${slot ? titleCaseScheduleWord(slot.area) : "schedule"} slot`;
    }
    case "unassign": {
      const slot = slotFor(command.slotKey);
      return `Unassign ${slot ? titleCaseScheduleWord(slot.area) : "schedule"} worker`;
    }
    case "removeSlot": {
      const slot = slotFor(command.slotKey);
      return `Remove ${slot ? titleCaseScheduleWord(slot.area) : "schedule"} shift`;
    }
    case "setCallWindow": {
      const slot = slotFor(command.slotKey);
      return `Set ${slot ? titleCaseScheduleWord(slot.area) : "student"} call window`;
    }
    case "setCallWindowForAll":
      return "Set all Student call windows";
  }
}

/**
 * Repair a same-person slot that was staged as a replacement even though the
 * live slot still holds that person. Older working copies can contain a null
 * sourceAssignmentId for this no-op replacement; treating it as new makes the
 * publish conflict check compare the worker with their own live assignment.
 * Only matching worker classes are repaired. A real class conversion remains
 * an explicit replacement and must continue through its normal guards.
 */
export function reconcileWorkingAssignmentSources(
  payload: WorkingSchedulePayload,
  liveShifts: ReadonlyArray<{
    id: string;
    workerType: ShiftWorkerType | string;
    assignments: ReadonlyArray<{ id: string; userId: string }>;
  }>,
): WorkingSchedulePayload {
  const liveByShiftId = new Map(liveShifts.map((shift) => [shift.id, shift] as const));
  let changed = false;

  const slots = payload.slots.map((slot) => {
    if (!slot.sourceShiftId || !slot.assignment || slot.assignment.sourceAssignmentId !== null) {
      return slot;
    }
    const live = liveByShiftId.get(slot.sourceShiftId);
    const liveAssignment = live?.assignments.length === 1 ? live.assignments[0] : undefined;
    if (
      !live
      || !liveAssignment
      || live.workerType !== slot.workerType
      || liveAssignment.userId !== slot.assignment.userId
    ) {
      return slot;
    }

    changed = true;
    return {
      ...slot,
      assignment: {
        ...slot.assignment,
        sourceAssignmentId: liveAssignment.id,
      },
    };
  });

  return changed ? { ...payload, slots } : payload;
}

export const workingScheduleCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("adjustSlots"),
    area: z.nativeEnum(ShiftArea),
    workerType: z.nativeEnum(ShiftWorkerType),
    delta: z.union([z.literal(-1), z.literal(1)]),
    callStartsAt: isoDate.nullable().optional(),
    callEndsAt: isoDate.nullable().optional(),
  }),
  z.object({
    type: z.literal("convertSlot"),
    slotKey: z.string().min(1),
    workerType: z.nativeEnum(ShiftWorkerType),
  }),
  z.object({
    type: z.literal("convertAndReplace"),
    slotKey: z.string().min(1),
    workerType: z.nativeEnum(ShiftWorkerType),
    userId: z.string().min(1),
  }),
  z.object({
    type: z.literal("assign"),
    slotKey: z.string().min(1),
    userId: z.string().min(1),
  }),
  z.object({
    type: z.literal("unassign"),
    slotKey: z.string().min(1),
  }),
  z.object({
    type: z.literal("removeSlot"),
    slotKey: z.string().min(1),
  }),
  z.object({
    type: z.literal("setCallWindow"),
    slotKey: z.string().min(1),
    callStartsAt: isoDate.nullable(),
    callEndsAt: isoDate.nullable(),
  }),
  z.object({
    type: z.literal("setCallWindowForAll"),
    callStartsAt: isoDate.nullable(),
    callEndsAt: isoDate.nullable(),
  }),
]);

export type WorkingScheduleCommand = z.infer<typeof workingScheduleCommandSchema>;

export type WorkingScheduleChanges = {
  addedSlots: number;
  removedSlots: number;
  convertedSlots: number;
  assignmentChanges: number;
  callWindowChanges: number;
  total: number;
};

function effectiveCallWindow(slot: WorkingScheduleSlot) {
  return {
    startsAt: slot.assignment?.callStartsAt ?? slot.callStartsAt ?? slot.startsAt,
    endsAt: slot.assignment?.callEndsAt ?? slot.callEndsAt ?? slot.endsAt,
  };
}

export function summarizeWorkingScheduleChanges(
  published: WorkingSchedulePayload,
  working: WorkingSchedulePayload,
): WorkingScheduleChanges {
  const publishedById = new Map(
    published.slots
      .filter((slot): slot is WorkingScheduleSlot & { sourceShiftId: string } => Boolean(slot.sourceShiftId))
      .map((slot) => [slot.sourceShiftId, slot]),
  );
  const workingById = new Map(
    working.slots
      .filter((slot): slot is WorkingScheduleSlot & { sourceShiftId: string } => Boolean(slot.sourceShiftId))
      .map((slot) => [slot.sourceShiftId, slot]),
  );

  const addedSlots = working.slots.filter((slot) => !slot.sourceShiftId).length;
  const removedSlots = [...publishedById.keys()].filter((id) => !workingById.has(id)).length;
  let convertedSlots = 0;
  let assignmentChanges = 0;
  let callWindowChanges = 0;

  for (const [id, slot] of workingById) {
    const previous = publishedById.get(id);
    if (!previous) continue;
    if (previous.workerType !== slot.workerType) convertedSlots += 1;
    const previousWindow = effectiveCallWindow(previous);
    const workingWindow = effectiveCallWindow(slot);
    if (
      previous.callStartsAt !== slot.callStartsAt
      || previous.callEndsAt !== slot.callEndsAt
      || previousWindow.startsAt !== workingWindow.startsAt
      || previousWindow.endsAt !== workingWindow.endsAt
    ) {
      callWindowChanges += 1;
    }
    if (
      previous.assignment?.userId !== slot.assignment?.userId
      || previous.assignment?.callNote !== slot.assignment?.callNote
    ) {
      assignmentChanges += 1;
    }
  }

  return {
    addedSlots,
    removedSlots,
    convertedSlots,
    assignmentChanges,
    callWindowChanges,
    total: addedSlots + removedSlots + convertedSlots + assignmentChanges + callWindowChanges,
  };
}

export function applyWorkingScheduleCommand(
  payload: WorkingSchedulePayload,
  command: WorkingScheduleCommand,
  createKey: () => string,
  defaultWindow: WorkingScheduleDefaultWindow = {
    startsAt: payload.eventStartsAt,
    endsAt: payload.eventEndsAt,
  },
): WorkingSchedulePayload {
  const next = structuredClone(payload);

  if (command.type === "adjustSlots") {
    if (command.delta === 1) {
      const peer = [...next.slots].reverse().find((slot) =>
        slot.area === command.area && slot.workerType === command.workerType,
      );
      const isStudentSlot = command.workerType === "ST";
      next.slots.push({
        key: createKey(),
        sourceShiftId: null,
        area: command.area,
        workerType: command.workerType,
        startsAt: isStudentSlot ? peer?.startsAt ?? defaultWindow.startsAt : next.eventStartsAt,
        endsAt: isStudentSlot ? peer?.endsAt ?? defaultWindow.endsAt : next.eventEndsAt,
        callStartsAt: isStudentSlot
          ? command.callStartsAt !== undefined ? command.callStartsAt : peer?.callStartsAt ?? null
          : null,
        callEndsAt: isStudentSlot
          ? command.callEndsAt !== undefined ? command.callEndsAt : peer?.callEndsAt ?? null
          : null,
        notes: null,
        assignmentHistoryCount: 0,
        assignment: null,
      });
    } else {
      const removableIndex = next.slots.findLastIndex((slot) =>
        slot.area === command.area
        && slot.workerType === command.workerType
        && slot.assignment === null
        && slot.assignmentHistoryCount === 0,
      );
      if (removableIndex === -1) {
        throw new Error("UNASSIGN_BEFORE_REDUCING");
      }
      next.slots.splice(removableIndex, 1);
    }
  } else if (command.type === "convertSlot") {
    const slot = next.slots.find((candidate) => candidate.key === command.slotKey);
    if (!slot) throw new Error("WORKING_SLOT_NOT_FOUND");
    if (slot.workerType === command.workerType) return next;
    if (slot.assignment || slot.assignmentHistoryCount > 0) {
      throw new Error("UNASSIGN_BEFORE_CONVERTING");
    }
    slot.workerType = command.workerType;
    if (command.workerType === "FT") {
      slot.startsAt = next.eventStartsAt;
      slot.endsAt = next.eventEndsAt;
      slot.callStartsAt = null;
      slot.callEndsAt = null;
    }
  } else if (command.type === "convertAndReplace") {
    const slot = next.slots.find((candidate) => candidate.key === command.slotKey);
    if (!slot) throw new Error("WORKING_SLOT_NOT_FOUND");
    if (!slot.assignment) throw new Error("WORKING_SLOT_NOT_ASSIGNED");
    if (slot.workerType === command.workerType) {
      throw new Error("CONVERT_AND_REPLACE_REQUIRES_CONVERSION");
    }
    if (slot.assignment.activeTradeId) throw new Error("CANCEL_TRADE_BEFORE_REPLACING");
    if (slot.assignment.bookingCount > 0) throw new Error("UNLINK_BOOKING_BEFORE_REPLACING");
    slot.workerType = command.workerType;
    if (command.workerType === "FT") {
      slot.startsAt = next.eventStartsAt;
      slot.endsAt = next.eventEndsAt;
      slot.callStartsAt = null;
      slot.callEndsAt = null;
    }
    slot.assignment = {
      ...slot.assignment,
      sourceAssignmentId: null,
      userId: command.userId,
      status: "DIRECT_ASSIGNED",
      callStartsAt: null,
      callEndsAt: null,
      callNote: null,
      activeTradeId: null,
      bookingCount: 0,
    };
  } else if (command.type === "assign") {
    const slot = next.slots.find((candidate) => candidate.key === command.slotKey);
    if (!slot) throw new Error("WORKING_SLOT_NOT_FOUND");
    if (slot.assignment) throw new Error("WORKING_SLOT_ALREADY_ASSIGNED");
    slot.assignment = {
      sourceAssignmentId: null,
      userId: command.userId,
      status: "DIRECT_ASSIGNED",
      callStartsAt: null,
      callEndsAt: null,
      callNote: null,
      activeTradeId: null,
      bookingCount: 0,
    };
  } else if (command.type === "unassign") {
    const slot = next.slots.find((candidate) => candidate.key === command.slotKey);
    if (!slot) throw new Error("WORKING_SLOT_NOT_FOUND");
    if (!slot.assignment) throw new Error("WORKING_SLOT_NOT_ASSIGNED");
    if (slot.assignment.activeTradeId) throw new Error("CANCEL_TRADE_BEFORE_UNASSIGNING");
    if (slot.assignment.bookingCount > 0) throw new Error("UNLINK_BOOKING_BEFORE_UNASSIGNING");
    slot.assignment = null;
  } else if (command.type === "removeSlot") {
    const slotIndex = next.slots.findIndex((candidate) => candidate.key === command.slotKey);
    if (slotIndex === -1) throw new Error("WORKING_SLOT_NOT_FOUND");
    const slot = next.slots[slotIndex]!;
    if (slot.assignment || slot.assignmentHistoryCount > 0) {
      throw new Error("UNASSIGN_BEFORE_REDUCING");
    }
    next.slots.splice(slotIndex, 1);
  } else if (command.type === "setCallWindow") {
    const slot = next.slots.find((candidate) => candidate.key === command.slotKey);
    if (!slot) throw new Error("WORKING_SLOT_NOT_FOUND");
    if (slot.workerType !== "ST") throw new Error("CALL_TIME_STUDENT_ONLY");
    if (slot.assignment) {
      slot.assignment.callStartsAt = command.callStartsAt;
      slot.assignment.callEndsAt = command.callEndsAt;
    } else {
      slot.callStartsAt = command.callStartsAt;
      slot.callEndsAt = command.callEndsAt;
    }
  } else {
    for (const slot of next.slots) {
      if (slot.workerType !== "ST") continue;
      slot.callStartsAt = command.callStartsAt;
      slot.callEndsAt = command.callEndsAt;
      if (slot.assignment) {
        slot.assignment.callStartsAt = null;
        slot.assignment.callEndsAt = null;
      }
    }
  }

  return workingSchedulePayloadSchema.parse(next);
}
