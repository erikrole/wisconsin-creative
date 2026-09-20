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

  it("rejects invalid statuses inside multi-status filters", async () => {
    await expect(
      listBookings(BookingKind.CHECKOUT, new URLSearchParams("status_in=OPEN,NOPE")),
    ).rejects.toBeInstanceOf(HttpError);
  });

  it("wires the Checkouts tab default to checked-out and pending-pickup work", () => {
    const component = source("src/app/(app)/bookings/page.tsx");
    expect(component).toContain('defaultStatusFilters: isPastScope ? [] : ["OPEN", "PENDING_PICKUP"]');
    expect(component).not.toContain('defaultStatusFilter: isPastScope ? "" : "OPEN"');
  });
});
