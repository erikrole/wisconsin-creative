import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookingKind, BookingStatus } from "@prisma/client";

vi.mock("@/lib/db", () => ({
  db: {
    booking: {
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
    },
    auditLog: {
      findMany: vi.fn(),
    },
  },
}));

import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { listBookings } from "@/lib/services/bookings-queries";
import { source } from "./_helpers/source";

describe("listBookings status filters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.booking.findMany).mockResolvedValue([]);
    vi.mocked(db.booking.count).mockResolvedValue(0);
  });

  it("supports multi-status filters for active checkout work queues", async () => {
    await listBookings(
      BookingKind.CHECKOUT,
      new URLSearchParams("status_in=OPEN,PENDING_PICKUP"),
    );

    expect(db.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          kind: BookingKind.CHECKOUT,
          status: { in: [BookingStatus.OPEN, BookingStatus.PENDING_PICKUP] },
        }),
      }),
    );
    expect(db.booking.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          kind: BookingKind.CHECKOUT,
          status: { in: [BookingStatus.OPEN, BookingStatus.PENDING_PICKUP] },
        }),
      }),
    );
  });

  it("lets explicit single-status filters override multi-status defaults", async () => {
    await listBookings(
      BookingKind.CHECKOUT,
      new URLSearchParams("status=OPEN&status_in=OPEN,PENDING_PICKUP"),
    );

    expect(db.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: BookingStatus.OPEN,
        }),
      }),
    );
  });

  it("keeps the reservation due-today window when a start range is also set", async () => {
    const todayStart = new Date("2026-10-17T05:00:00.000Z");
    const todayEnd = new Date("2026-10-18T05:00:00.000Z");
    const from = new Date("2020-01-01T00:00:00.000Z");

    await listBookings(
      BookingKind.RESERVATION,
      new URLSearchParams(`filter=due-today&from=${from.toISOString()}`),
      {
        status: BookingStatus.BOOKED,
        startsAt: { gte: todayStart, lt: todayEnd },
      },
    );

    expect(db.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: BookingStatus.BOOKED,
          startsAt: { gte: todayStart, lt: todayEnd },
          AND: [{ startsAt: { gte: from } }],
        }),
      }),
    );
  });

  it("still applies a start range directly when the special filter does not set one", async () => {
    const from = new Date("2026-10-01T00:00:00.000Z");
    await listBookings(
      BookingKind.CHECKOUT,
      new URLSearchParams(`from=${from.toISOString()}`),
      { status: BookingStatus.OPEN, endsAt: { gte: from } },
    );

    const where = vi.mocked(db.booking.findMany).mock.calls[0]?.[0]?.where;
    expect(where).toMatchObject({
      status: BookingStatus.OPEN,
      endsAt: { gte: from },
      startsAt: { gte: from },
    });
    expect(where?.AND).toBeUndefined();
  });

  it("rejects invalid statuses inside multi-status filters", async () => {
    await expect(
      listBookings(BookingKind.CHECKOUT, new URLSearchParams("status_in=OPEN,NOPE")),
    ).rejects.toBeInstanceOf(HttpError);
  });

  it("wires the Checkouts tab default to checked-out and pending-pickup work", () => {
    const component = source("src/app/(app)/bookings/BookingsPageClient.tsx");
    expect(component).toContain('defaultStatusFilters: isPastScope ? [] : ["OPEN", "PENDING_PICKUP"]');
    expect(component).not.toContain('defaultStatusFilter: isPastScope ? "" : "OPEN"');
  });
});
