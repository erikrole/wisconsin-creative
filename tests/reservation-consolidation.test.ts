import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookingKind, BookingStatus, Role } from "@prisma/client";

vi.mock("@/lib/db", () => ({
  db: {
    booking: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/services/availability", () => ({ checkAvailability: vi.fn() }));
vi.mock("@/lib/audit", () => ({ createAuditEntryTx: vi.fn() }));
vi.mock("@/lib/serialization", () => ({ withSerializationRetry: vi.fn() }));

import { db } from "@/lib/db";
import { mergeReservations, previewReservationMerge } from "@/lib/services/reservation-consolidation";

const ids = ["cm000000000000000000000001", "cm000000000000000000000002"];
const eventId = "cm000000000000000000000003";

function reservation(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    kind: BookingKind.RESERVATION,
    status: BookingStatus.BOOKED,
    title: "Volleyball Photo",
    requesterUserId: "cm000000000000000000000004",
    locationId: "cm000000000000000000000005",
    startsAt: new Date("2026-09-05T18:00:00.000Z"),
    endsAt: new Date("2026-09-06T04:00:00.000Z"),
    createdAt: new Date(id === ids[0] ? "2026-09-01T10:00:00.000Z" : "2026-09-01T11:00:00.000Z"),
    notes: null,
    eventId,
    events: [{ eventId }],
    serializedItems: [{ assetId: `${id}-asset`, allocationStatus: "active" }],
    bulkItems: [{ bulkSkuId: "cm000000000000000000000006", plannedQuantity: 2, checkedOutQuantity: 0 }],
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("reservation consolidation", () => {
  it("previews one canonical plan with additive gear totals", async () => {
    vi.mocked(db.booking.findMany).mockResolvedValue([
      reservation(ids[1]!),
      reservation(ids[0]!),
    ] as never);

    await expect(previewReservationMerge(ids)).resolves.toEqual({
      targetReservationId: ids[0],
      sourceReservationIds: [ids[1]],
      title: "Volleyball Photo",
      requesterUserId: "cm000000000000000000000004",
      eventIds: [eventId],
      serializedItemCount: 2,
      bulkQuantity: 4,
    });
  });

  it("rejects plans whose titles or event context differ", async () => {
    vi.mocked(db.booking.findMany).mockResolvedValue([
      reservation(ids[0]!),
      reservation(ids[1]!, { title: "Volleyball Video" }),
    ] as never);

    await expect(previewReservationMerge(ids)).rejects.toMatchObject({ status: 409 });
  });

  it("rejects a merge after pickup has started", async () => {
    vi.mocked(db.booking.findMany).mockResolvedValue([
      reservation(ids[0]!),
      reservation(ids[1]!, {
        serializedItems: [{ assetId: "picked-up-asset", allocationStatus: "picked_up" }],
      }),
    ] as never);

    await expect(previewReservationMerge(ids)).rejects.toMatchObject({ status: 409 });
  });

  it("keeps merge repair staff-only", async () => {
    await expect(mergeReservations({
      ids,
      actorUserId: "cm000000000000000000000007",
      actorRole: Role.STUDENT,
    })).rejects.toMatchObject({ status: 403 });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
