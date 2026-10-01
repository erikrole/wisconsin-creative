import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";
import { HttpError } from "@/lib/http";

const mocks = vi.hoisted(() => ({
  bookingFindUnique: vi.fn(),
  bookingFindUniqueOrThrow: vi.fn(),
  userFindFirst: vi.fn(),
  eventFindFirst: vi.fn(),
  updateReservation: vi.fn(),
  updateCheckout: vi.fn(),
  updateBookingEvents: vi.fn(),
  updateBookingEventsTx: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    booking: { findUnique: mocks.bookingFindUnique, findUniqueOrThrow: mocks.bookingFindUniqueOrThrow },
    user: { findFirst: mocks.userFindFirst },
    calendarEvent: { findFirst: mocks.eventFindFirst },
  },
}));

vi.mock("@/lib/api", () => ({
  withKiosk: <P extends Record<string, string>>(
    handler: (req: Request, ctx: { params: P; kiosk: { kioskId: string } }) => Promise<Response>,
  ) => async (req: Request, ctx: { params: Promise<P> }) =>
    handler(req, { params: await ctx.params, kiosk: { kioskId: "kiosk-1" } }),
}));

vi.mock("@/lib/services/bookings-lifecycle", () => ({
  updateReservation: mocks.updateReservation,
  updateCheckout: mocks.updateCheckout,
  updateBookingEvents: mocks.updateBookingEvents,
  updateBookingEventsTx: mocks.updateBookingEventsTx,
}));
vi.mock("@/lib/services/notifications", () => ({ dispatchScheduleAssignmentNotifications: vi.fn() }));

import { PATCH } from "@/app/api/kiosk/pickup/[id]/details/route";

const snapshot = "2026-09-16T18:00:00.000Z";
const later = "2099-09-20T22:00:00.000Z";

function booking(over: Record<string, unknown> = {}) {
  return {
    id: "rv-1",
    kind: "RESERVATION",
    status: "BOOKED",
    custodyScope: "PERSON",
    requesterUserId: "david",
    updatedAt: new Date(snapshot),
    ...over,
  };
}

function patch(body: Record<string, unknown>) {
  return PATCH(new Request("http://test", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ actorId: "david", expectedUpdatedAt: snapshot, ...body }),
  }), { params: Promise.resolve({ id: "rv-1" }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updateReservation.mockReset();
  mocks.bookingFindUnique.mockResolvedValue(booking());
  mocks.userFindFirst.mockResolvedValue({ id: "david", role: Role.STUDENT, collaboratorPolicy: null });
  mocks.bookingFindUniqueOrThrow.mockResolvedValue({
    id: "rv-1", title: "Volleyball vs Minnesota", endsAt: new Date(later), updatedAt: new Date(), eventId: null,
  });
});

describe("PATCH /api/kiosk/pickup/[id]/details", () => {
  it("renames and moves the due time of a reservation through updateReservation", async () => {
    const res = await patch({ title: "Media day", endsAt: later });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(mocks.updateReservation).toHaveBeenCalledWith(
      "rv-1", "david", { title: "Media day", endsAt: new Date(later) }, new Date(snapshot),
    );
    expect(mocks.updateCheckout).not.toHaveBeenCalled();
    expect(mocks.updateBookingEvents).not.toHaveBeenCalled();
    expect(json.data?.booking ?? json.booking).toMatchObject({ id: "rv-1", eventId: null });
  });

  it("uses updateCheckout for a legacy PENDING_PICKUP checkout", async () => {
    mocks.bookingFindUnique.mockResolvedValue(booking({ kind: "CHECKOUT", status: "PENDING_PICKUP" }));
    await patch({ endsAt: later });
    expect(mocks.updateCheckout).toHaveBeenCalledWith(
      "rv-1", "david", { title: undefined, endsAt: new Date(later) }, new Date(snapshot),
    );
  });

  it("links an event inside the title update's transaction and takes its name as the title", async () => {
    mocks.eventFindFirst.mockResolvedValue({ id: "ev-1", summary: "Volleyball vs Minnesota" });
    const tx = { marker: "tx" };
    mocks.updateReservation.mockImplementation(async (_id, _actor, _updates, _expected, options) => {
      await options.afterUpdateTx(tx);
    });
    await patch({ eventId: "ev-1" });
    expect(mocks.updateReservation).toHaveBeenCalledWith(
      "rv-1", "david", { title: "Volleyball vs Minnesota", endsAt: undefined }, new Date(snapshot),
      expect.objectContaining({ afterUpdateTx: expect.any(Function) }),
    );
    expect(mocks.updateBookingEventsTx).toHaveBeenCalledWith(tx, expect.objectContaining({
      bookingId: "rv-1", actorUserId: "david", eventIds: ["ev-1"],
    }));
    expect(mocks.updateBookingEvents).not.toHaveBeenCalled();
  });

  it("commits nothing of the link when the title/time update is refused", async () => {
    mocks.eventFindFirst.mockResolvedValue({ id: "ev-1", summary: "Volleyball vs Minnesota" });
    mocks.updateReservation.mockRejectedValue(new HttpError(409, "FX3 1 is reserved then"));
    await expect(patch({ eventId: "ev-1", endsAt: later })).rejects.toMatchObject({ status: 409 });
    expect(mocks.updateBookingEvents).not.toHaveBeenCalled();
    expect(mocks.updateBookingEventsTx).not.toHaveBeenCalled();
  });

  it("unlinks the event in the same transaction when a custom purpose replaces it", async () => {
    mocks.updateReservation.mockImplementation(async (_id, _actor, _updates, _expected, options) => {
      await options.afterUpdateTx({});
    });
    await patch({ title: "Media day", eventId: null });
    expect(mocks.updateBookingEventsTx).toHaveBeenCalledWith({}, expect.objectContaining({ eventIds: [] }));
  });

  it("rejects an event that is no longer available", async () => {
    mocks.eventFindFirst.mockResolvedValue(null);
    await expect(patch({ eventId: "ev-gone" })).rejects.toMatchObject({ status: 400 });
    expect(mocks.updateReservation).not.toHaveBeenCalled();
  });

  it("lets staff edit someone else's pickup but not another student", async () => {
    mocks.userFindFirst.mockResolvedValue({ id: "staff", role: Role.STAFF, collaboratorPolicy: null });
    await expect(patch({ actorId: "staff", title: "Media day" })).resolves.toBeInstanceOf(Response);

    mocks.userFindFirst.mockResolvedValue({ id: "other", role: Role.STUDENT, collaboratorPolicy: null });
    await expect(patch({ actorId: "other", title: "Media day" })).rejects.toMatchObject({ status: 403 });
  });

  it("rejects a stale snapshot, a past time, and an open checkout", async () => {
    await expect(patch({ title: "x", expectedUpdatedAt: "2026-09-16T17:00:00.000Z" })).rejects.toMatchObject({ status: 409 });
    await expect(patch({ endsAt: "2020-01-01T00:00:00.000Z" })).rejects.toMatchObject({ status: 400 });
    mocks.bookingFindUnique.mockResolvedValue(booking({ kind: "CHECKOUT", status: "OPEN" }));
    await expect(patch({ title: "x" })).rejects.toMatchObject({ status: 404 });
    expect(mocks.updateReservation).not.toHaveBeenCalled();
  });

  it("passes an availability conflict from the lifecycle service through", async () => {
    mocks.updateReservation.mockRejectedValue(new HttpError(409, "FX3 1 is reserved then"));
    await expect(patch({ endsAt: later })).rejects.toMatchObject({ status: 409, message: "FX3 1 is reserved then" });
  });
});
