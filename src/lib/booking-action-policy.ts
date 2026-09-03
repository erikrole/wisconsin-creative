export type BookingKind = "CHECKOUT" | "RESERVATION";
export type BookingStatus = "DRAFT" | "BOOKED" | "PENDING_PICKUP" | "OPEN" | "COMPLETED" | "CANCELLED";

export type CheckoutAction = "edit" | "extend" | "cancel" | "checkin" | "open" | "force-complete" | "nudge" | "transfer-owner" | "manage-custody";
export type ReservationAction = "edit" | "extend" | "cancel" | "convert" | "duplicate" | "force-checkout" | "transfer-owner";
export type BookingAction = CheckoutAction | ReservationAction | "view";

export type BookingContext = {
  kind?: BookingKind;
  status: string;
  requesterUserId?: string;
  createdBy?: string;
  requester?: { id: string };
  creator?: { id: string };
  custodyScope?: "PERSON" | "SHARED" | string;
};

export type ActorContext = {
  id: string;
  role: string;
  capabilities?: readonly string[];
};

export type ActionCheckResult = {
  allowed: boolean;
  reason?: string;
};

type ActionOptions = {
  includeServerActions?: boolean;
};

const CLIENT_CHECKOUT_ACTIONS: CheckoutAction[] = ["edit", "extend", "cancel", "open", "transfer-owner", "manage-custody"];
const SERVER_CHECKOUT_ACTIONS: CheckoutAction[] = ["edit", "extend", "cancel", "checkin", "open", "force-complete", "nudge", "transfer-owner", "manage-custody"];
const CLIENT_RESERVATION_ACTIONS: ReservationAction[] = ["edit", "extend", "cancel", "duplicate", "transfer-owner"];
const SERVER_RESERVATION_ACTIONS: ReservationAction[] = ["edit", "extend", "cancel", "convert", "duplicate", "force-checkout", "transfer-owner"];
const COLLABORATOR_RESERVATION_ACTION_CAPABILITIES: Partial<Record<"edit" | "extend" | "cancel", string>> = {
  edit: "RESERVATION_EDIT_OWN",
  extend: "RESERVATION_EXTEND_OWN",
  cancel: "RESERVATION_CANCEL_OWN",
};

const STATE_ACTIONS: Record<BookingKind, Record<BookingStatus, Set<string>>> = {
  CHECKOUT: {
    DRAFT: new Set(["edit", "cancel", "transfer-owner"]),
    BOOKED: new Set(["edit", "extend", "cancel", "open", "transfer-owner", "manage-custody"]),
    PENDING_PICKUP: new Set(["edit", "cancel", "transfer-owner", "manage-custody"]),
    OPEN: new Set(["edit", "extend", "force-complete", "nudge", "transfer-owner", "manage-custody"]),
    COMPLETED: new Set(),
    CANCELLED: new Set(),
  },
  RESERVATION: {
    DRAFT: new Set(["edit", "cancel", "transfer-owner"]),
    BOOKED: new Set(["edit", "extend", "cancel", "duplicate", "force-checkout", "transfer-owner"]),
    PENDING_PICKUP: new Set(),
    OPEN: new Set(),
    COMPLETED: new Set(["duplicate"]),
    CANCELLED: new Set(["duplicate"]),
  },
};

function isStaffOrAbove(role: string): boolean {
  return role === "ADMIN" || role === "STAFF";
}

function isOwner(actor: ActorContext, booking: BookingContext): boolean {
  if (booking.custodyScope === "SHARED") return false;
  const requesterId = booking.requesterUserId ?? booking.requester?.id;
  const creatorId = booking.createdBy ?? booking.creator?.id;
  return actor.id === requesterId || actor.id === creatorId;
}

function hasAccess(actor: ActorContext, booking: BookingContext): boolean {
  return isStaffOrAbove(actor.role) || isOwner(actor, booking);
}

function collaboratorActionCheck(
  actor: ActorContext,
  booking: BookingContext,
  action: string,
  kind: BookingKind | null,
): ActionCheckResult | null {
  if (actor.role !== "COLLABORATOR") return null;
  if (!isOwner(actor, booking)) {
    return { allowed: false, reason: "You do not have permission to access this booking" };
  }
  if (action === "view") return { allowed: true };
  if (kind !== "RESERVATION" || !["edit", "extend", "cancel"].includes(action)) {
    return { allowed: false, reason: "This action is not available to collaborators" };
  }
  const requiredCapability = COLLABORATOR_RESERVATION_ACTION_CAPABILITIES[action as "edit" | "extend" | "cancel"];
  if (!requiredCapability || !actor.capabilities?.includes(requiredCapability)) {
    return { allowed: false, reason: "Your collaborator access does not include this reservation action" };
  }
  return null;
}

function resolveKind(booking: BookingContext, kind?: BookingKind): BookingKind | null {
  return kind ?? booking.kind ?? null;
}

function allActionsForKind(kind: BookingKind, includeServerActions: boolean) {
  if (kind === "CHECKOUT") {
    return includeServerActions ? SERVER_CHECKOUT_ACTIONS : CLIENT_CHECKOUT_ACTIONS;
  }
  return includeServerActions ? SERVER_RESERVATION_ACTIONS : CLIENT_RESERVATION_ACTIONS;
}

export function canPerformBookingAction(
  actor: ActorContext,
  booking: BookingContext,
  action: string,
  kind?: BookingKind,
): ActionCheckResult {
  const resolvedKind = resolveKind(booking, kind);
  const collaboratorCheck = collaboratorActionCheck(actor, booking, action, resolvedKind);
  if (collaboratorCheck) return collaboratorCheck;

  if (action === "view") {
    return hasAccess(actor, booking)
      ? { allowed: true }
      : { allowed: false, reason: "You do not have permission to view this booking" };
  }

  if (!resolvedKind) {
    return { allowed: false, reason: "Unknown booking kind" };
  }

  const stateActions = STATE_ACTIONS[resolvedKind]?.[booking.status as BookingStatus];
  if (!stateActions || !stateActions.has(action)) {
    return {
      allowed: false,
      reason: `Action "${action}" is not available in ${booking.status} state`,
    };
  }

  if (action === "force-complete") {
    return actor.role === "ADMIN"
      ? { allowed: true }
      : { allowed: false, reason: "Only admins can force-complete a checkout" };
  }

  if (action === "force-checkout") {
    return actor.role === "ADMIN"
      ? { allowed: true }
      : { allowed: false, reason: "Only admins can force-checkout a reservation" };
  }

  if (action === "nudge") {
    if (booking.custodyScope === "SHARED") {
      return { allowed: false, reason: "Shared checkouts do not have a borrower to nudge" };
    }
    return isStaffOrAbove(actor.role)
      ? { allowed: true }
      : { allowed: false, reason: "Only staff or admin can send nudge notifications" };
  }

  if (action === "transfer-owner") {
    if (booking.custodyScope === "SHARED") {
      return { allowed: false, reason: "Shared checkouts do not have a personal owner" };
    }
    return hasAccess(actor, booking)
      ? { allowed: true }
      : { allowed: false, reason: "You do not have permission to transfer this booking" };
  }

  if (action === "manage-custody") {
    return isStaffOrAbove(actor.role)
      ? { allowed: true }
      : { allowed: false, reason: "Only staff or admin can change checkout custody" };
  }

  if (!hasAccess(actor, booking)) {
    return {
      allowed: false,
      reason: "You do not have permission to perform this action",
    };
  }

  return { allowed: true };
}

export function getAllowedBookingActions(
  actor: ActorContext,
  booking: BookingContext,
  kind?: BookingKind,
): string[];
export function getAllowedBookingActions(
  actor: ActorContext,
  booking: BookingContext,
  options?: ActionOptions,
): string[];
export function getAllowedBookingActions(
  actor: ActorContext,
  booking: BookingContext,
  kindOrOptions?: BookingKind | ActionOptions,
): string[] {
  const kind = typeof kindOrOptions === "string" ? kindOrOptions : resolveKind(booking);
  if (!kind) return [];

  const includeServerActions = typeof kindOrOptions === "string"
    ? false
    : kindOrOptions?.includeServerActions ?? true;

  return allActionsForKind(kind, includeServerActions).filter((action) =>
    canPerformBookingAction(actor, booking, action, kind).allowed
  );
}
