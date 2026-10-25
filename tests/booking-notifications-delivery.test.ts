import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createManyAndReturn: vi.fn(),
  userFindMany: vi.fn(),
  sendPush: vi.fn(),
  sendEmail: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    notification: { createManyAndReturn: mocks.createManyAndReturn },
    user: { findMany: mocks.userFindMany },
  },
}));
vi.mock("@/lib/services/notification-delivery", () => ({
  deferPush: (task: Promise<void>) => { void task; },
  sendPushToUser: mocks.sendPush,
  sendEmailToUser: mocks.sendEmail,
}));

import { createReservationLifecycleNotification, notifyItemReport } from "@/lib/services/booking-notifications";

const notifyReservation = (over: Partial<Parameters<typeof createReservationLifecycleNotification>[0]> = {}) =>
  createReservationLifecycleNotification({
    bookingId: "res-1",
    bookingTitle: "Football vs USC (ROAM2)",
    requesterUserId: "maya",
    actorUserId: "staff-1",
    event: "booked",
    ...over,
  });

const insertedRow = () => mocks.createManyAndReturn.mock.calls[0]![0].data[0];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createManyAndReturn.mockResolvedValue([{ id: "n1" }]);
  mocks.sendEmail.mockResolvedValue(undefined);
});

describe("createReservationLifecycleNotification", () => {
  it("tells the requester staff booked for them, in-app and by push", async () => {
    await notifyReservation();

    expect(insertedRow()).toMatchObject({
      userId: "maya",
      type: "reservation_booked",
      title: "Reservation confirmed",
      body: 'Your reservation "Football vs USC (ROAM2)" is confirmed.',
      payload: { bookingId: "res-1", href: "/reservations/res-1" },
      readAt: null,
      dedupeKey: "res-1:reservation_booked",
    });
    expect(mocks.createManyAndReturn.mock.calls[0]![0].skipDuplicates).toBe(true);
    expect(mocks.sendPush).toHaveBeenCalledWith("maya", expect.objectContaining({
      title: "Reservation confirmed",
      body: "Staff made this reservation for you.",
      notificationId: "n1",
      collapseId: "reservation-res-1",
    }));
  });

  it("gives each update its own row by version", async () => {
    await notifyReservation({ event: "updated", version: new Date("2026-10-24T20:00:00.000Z") });

    expect(insertedRow().dedupeKey).toBe("res-1:reservation_updated:2026-10-24T20:00:00.000Z");
  });

  it("keeps a self-made reservation as an already-read receipt without a push", async () => {
    await notifyReservation({ actorUserId: "maya" });

    expect(insertedRow().readAt).toEqual(insertedRow().sentAt);
    expect(mocks.sendPush).not.toHaveBeenCalled();
  });

  it("says nothing when someone cancels their own reservation", async () => {
    await notifyReservation({ event: "cancelled", actorUserId: "maya" });

    expect(mocks.createManyAndReturn).not.toHaveBeenCalled();
  });

  it("tells the requester when staff cancel it", async () => {
    await notifyReservation({ event: "cancelled" });

    expect(insertedRow()).toMatchObject({ type: "reservation_cancelled", body: expect.stringContaining("no longer held") });
    expect(mocks.sendPush).toHaveBeenCalled();
  });

  it("doesn't push a duplicate that was already recorded", async () => {
    mocks.createManyAndReturn.mockResolvedValue([]);

    await notifyReservation({ event: "pickup_ready" });

    expect(mocks.sendPush).not.toHaveBeenCalled();
  });

  it("never lets a failed insert break the booking flow", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.createManyAndReturn.mockRejectedValue(new Error("db down"));

    await expect(notifyReservation()).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe("notifyItemReport", () => {
  const supervisors = [
    { id: "erik", email: "erik@example.com" },
    { id: "staff-1", email: "staff@example.com" },
    { id: "staff-2", email: null },
  ];
  const report = (over: Partial<Parameters<typeof notifyItemReport>[0]> = {}) =>
    notifyItemReport({
      bookingId: "co-1",
      bookingTitle: "Volleyball shoot",
      assetId: "fx3-1",
      assetTag: "FX3-1",
      itemDescription: "Sony FX3",
      reportType: "DAMAGED",
      damageDescription: "Cracked LCD",
      reporterName: "Maya",
      ...over,
    });

  beforeEach(() => {
    mocks.userFindMany.mockResolvedValue(supervisors);
    mocks.createManyAndReturn.mockImplementation(async ({ data }: { data: Array<{ userId: string }> }) =>
      data.map((row) => ({ userId: row.userId })));
  });

  it("alerts every supervisor in-app and emails those with an address", async () => {
    await report({ evidenceImageUrl: "https://blob.example/fx3.jpg" });

    const rows = mocks.createManyAndReturn.mock.calls[0]![0].data;
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      type: "checkin_item_damaged",
      title: "Item reported damaged: FX3-1",
      body: 'Maya reported Sony FX3 (FX3-1) as damaged during check-in of "Volleyball shoot". Description: Cracked LCD',
      payload: expect.objectContaining({ href: "/checkouts/co-1", evidenceImageUrl: "https://blob.example/fx3.jpg" }),
      dedupeKey: "co-1:item_report:fx3-1:erik",
    });
    expect(mocks.sendEmail).toHaveBeenCalledTimes(2);
    expect(mocks.sendEmail).toHaveBeenCalledWith("erik", expect.objectContaining({ to: "erik@example.com", subject: "Item reported damaged: FX3-1" }), "itemReports");
  });

  it("emails only supervisors who got a new row on a repeat report", async () => {
    mocks.createManyAndReturn.mockResolvedValue([{ userId: "staff-1" }]);

    await report();

    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendEmail).toHaveBeenCalledWith("staff-1", expect.anything(), "itemReports");
  });

  it("emails everyone when the in-app insert fails, so the report isn't lost", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.createManyAndReturn.mockRejectedValue(new Error("db down"));

    await report({ reportType: "LOST" });

    expect(mocks.sendEmail).toHaveBeenCalledTimes(2);
    consoleError.mockRestore();
  });

  it("calls an item-page report missing and links both the alert and the email to Damage", async () => {
    await report({ bookingId: undefined, bookingTitle: undefined, reportId: "rep-9", reportType: "LOST" });

    const row = mocks.createManyAndReturn.mock.calls[0]![0].data[0];
    expect(row).toMatchObject({
      bookingId: null,
      body: "Maya reported Sony FX3 (FX3-1) as missing.",
      payload: expect.objectContaining({ href: "/damage" }),
      dedupeKey: "rep-9:item_report:fx3-1:erik",
    });
    const email = mocks.sendEmail.mock.calls[0]![1];
    expect(email.html).toContain("/damage");
    expect(email.html).not.toContain("/checkouts/undefined");
  });

  it("keeps a failed email from failing the report", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.sendEmail.mockRejectedValueOnce(new Error("Resend down"));

    await expect(report()).resolves.toBeUndefined();
    expect(mocks.sendEmail).toHaveBeenCalledTimes(2);
    consoleError.mockRestore();
  });
});
