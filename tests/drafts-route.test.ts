import { describe, it, expect, vi, beforeEach } from "vitest";
import { Role } from "@prisma/client";

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
}));

const mockTx = {
  calendarEvent: { findMany: vi.fn() },
  booking: { create: vi.fn(), update: vi.fn(), findFirst: vi.fn(), delete: vi.fn() },
  bookingSerializedItem: { deleteMany: vi.fn(), createMany: vi.fn() },
  bookingBulkItem: { deleteMany: vi.fn(), createMany: vi.fn() },
  bookingEvent: { deleteMany: vi.fn(), createMany: vi.fn() },
  auditLog: { create: vi.fn() },
};

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: vi.fn(async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx)),
    booking: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    location: { findFirst: vi.fn(), findUnique: vi.fn() },
  },
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  MAX_BULK_QUANTITY_PER_LINE,
  MAX_BULK_SKU_LINES_PER_REQUEST,
  MAX_EQUIPMENT_SELECTIONS_PER_REQUEST,
  MAX_LINKED_EVENTS_PER_BOOKING,
} from "@/lib/request-limits";
import { GET as GET_DRAFTS, POST } from "@/app/api/drafts/route";
import { DELETE, GET as GET_DRAFT } from "@/app/api/drafts/[id]/route";

const user = {
  id: "cm000000000000000000000001",
  email: "admin@test.com",
  name: "Admin",
  role: Role.ADMIN,
  avatarUrl: null,
};

function location(row: unknown) {
  return row as Awaited<ReturnType<typeof db.location.findFirst>>;
}

function draft(row: unknown) {
  return row as Awaited<ReturnType<typeof db.booking.findFirst>>;
}

function cuid(index: number) {
  return `cm${index.toString(36).padStart(23, "0")}`;
}

const noParams = { params: Promise.resolve({}) };
const draftParams = { params: Promise.resolve({ id: "cm000000000000000000000010" }) };

function makePostRequest(body: Record<string, unknown>) {
  return new Request("https://app.example.com/api/drafts", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "app.example.com",
      origin: "https://app.example.com",
    },
    body: JSON.stringify(body),
  });
}

function makeMalformedPostRequest() {
  return new Request("https://app.example.com/api/drafts", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "app.example.com",
      origin: "https://app.example.com",
    },
    body: "{not-json",
  });
}

function makeGetRequest() {
  return new Request("https://app.example.com/api/drafts/cm000000000000000000000010", {
    method: "GET",
    headers: { host: "app.example.com" },
  });
}

function makeDeleteRequest() {
  return new Request("https://app.example.com/api/drafts/cm000000000000000000000010", {
    method: "DELETE",
    headers: {
      host: "app.example.com",
      origin: "https://app.example.com",
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(user);
  vi.mocked(db.location.findFirst).mockResolvedValue(location({ id: "cm000000000000000000000002" }));
  vi.mocked(db.location.findUnique).mockResolvedValue(location({
    id: "cm000000000000000000000002",
    active: true,
    name: "Camp Randall",
  }));
  mockTx.auditLog.create.mockResolvedValue({});
});

describe("POST /api/drafts", () => {
  it("persists multi-event draft links in chronological order", async () => {
    const lateEventId = "cm000000000000000000000101";
    const earlyEventId = "cm000000000000000000000102";
    mockTx.calendarEvent.findMany.mockResolvedValue([
      { id: lateEventId, startsAt: new Date("2026-06-02T20:00:00Z") },
      { id: earlyEventId, startsAt: new Date("2026-05-30T20:00:00Z") },
    ]);
    mockTx.booking.create.mockResolvedValue({ id: "cm000000000000000000000010" });

    const res = await POST(
      makePostRequest({
        kind: "RESERVATION",
        title: "Regional road trip",
        eventIds: [lateEventId, earlyEventId, earlyEventId],
      }),
      noParams,
    );

    expect(res.status).toBe(201);
    expect(mockTx.booking.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ eventId: earlyEventId }),
    });
    expect(mockTx.bookingEvent.createMany).toHaveBeenCalledWith({
      data: [
        { bookingId: "cm000000000000000000000010", eventId: earlyEventId, ordinal: 0 },
        { bookingId: "cm000000000000000000000010", eventId: lateEventId, ordinal: 1 },
      ],
    });
  });

  it("allows five linked draft events and rejects a sixth before saving", async () => {
    const eventIds = Array.from(
      { length: MAX_LINKED_EVENTS_PER_BOOKING },
      (_, index) => cuid(index + 101),
    );
    mockTx.calendarEvent.findMany.mockResolvedValue(
      eventIds.map((id, index) => ({
        id,
        startsAt: new Date(Date.UTC(2026, 4, 30 + index, 20)),
      })),
    );
    mockTx.booking.create.mockResolvedValue({ id: "cm000000000000000000000010" });

    const accepted = await POST(
      makePostRequest({ kind: "RESERVATION", title: "Five-event draft", eventIds }),
      noParams,
    );

    expect(accepted.status).toBe(201);
    expect(mockTx.bookingEvent.createMany).toHaveBeenCalledWith({
      data: eventIds.map((eventId, ordinal) => ({
        bookingId: "cm000000000000000000000010",
        eventId,
        ordinal,
      })),
    });

    const rejected = await POST(
      makePostRequest({
        kind: "RESERVATION",
        title: "Six-event draft",
        eventIds: [...eventIds, cuid(200)],
      }),
      noParams,
    );

    expect(rejected.status).toBe(400);
    expect(mockTx.booking.create).toHaveBeenCalledTimes(1);
  });

  it("rejects payloads that mix legacy eventId with eventIds", async () => {
    const res = await POST(
      makePostRequest({
        kind: "CHECKOUT",
        eventId: "cm000000000000000000000101",
        eventIds: ["cm000000000000000000000102"],
      }),
      noParams,
    );

    expect(res.status).toBe(400);
    expect(mockTx.booking.create).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON before saving a draft", async () => {
    const res = await POST(makeMalformedPostRequest(), noParams);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Request body must be valid JSON");
    expect(mockTx.booking.create).not.toHaveBeenCalled();
    expect(mockTx.booking.update).not.toHaveBeenCalled();
  });

  it("normalizes draft sportCode before saving", async () => {
    mockTx.booking.create.mockResolvedValue({ id: "cm000000000000000000000010" });

    const res = await POST(
      makePostRequest({
        kind: "RESERVATION",
        title: "Volleyball draft",
        sportCode: "vb",
      }),
      noParams,
    );

    expect(res.status).toBe(201);
    expect(mockTx.booking.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ sportCode: "VB" }),
    });
  });

  it("rejects unknown draft sportCode before saving", async () => {
    const res = await POST(
      makePostRequest({
        kind: "RESERVATION",
        title: "Bad sport draft",
        sportCode: "volleyball",
      }),
      noParams,
    );

    expect(res.status).toBe(400);
    expect(mockTx.booking.create).not.toHaveBeenCalled();
    expect(mockTx.booking.update).not.toHaveBeenCalled();
  });

  it("accepts the equipment maxima and batches each collection into one write", async () => {
    const serializedAssetIds = Array.from(
      { length: MAX_EQUIPMENT_SELECTIONS_PER_REQUEST },
      (_, index) => cuid(index),
    );
    const bulkItems = Array.from(
      { length: MAX_BULK_SKU_LINES_PER_REQUEST },
      (_, index) => ({
        bulkSkuId: cuid(MAX_EQUIPMENT_SELECTIONS_PER_REQUEST + index),
        quantity: MAX_BULK_QUANTITY_PER_LINE,
      }),
    );
    mockTx.booking.create.mockResolvedValue({ id: "cm000000000000000000000010" });

    const res = await POST(
      makePostRequest({ kind: "RESERVATION", serializedAssetIds, bulkItems }),
      noParams,
    );

    expect(res.status).toBe(201);
    expect(mockTx.bookingSerializedItem.createMany).toHaveBeenCalledTimes(1);
    expect(mockTx.bookingSerializedItem.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ assetId: serializedAssetIds[0] }),
      ]),
    });
    expect(mockTx.bookingSerializedItem.createMany.mock.calls[0]?.[0].data).toHaveLength(
      MAX_EQUIPMENT_SELECTIONS_PER_REQUEST,
    );
    expect(mockTx.bookingBulkItem.createMany).toHaveBeenCalledTimes(1);
    expect(mockTx.bookingBulkItem.createMany.mock.calls[0]?.[0].data).toHaveLength(
      MAX_BULK_SKU_LINES_PER_REQUEST,
    );
  });

  it("denies collaborators without reservation-create capability", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ...user,
      role: Role.COLLABORATOR,
      capabilities: ["MY_GEAR_VIEW"],
    });

    const res = await POST(
      makePostRequest({ kind: "RESERVATION", title: "Unauthorized draft" }),
      noParams,
    );

    expect(res.status).toBe(403);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("forces student reservation drafts to the authenticated requester", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ...user,
      id: "cm000000000000000000000099",
      role: Role.STUDENT,
    });
    mockTx.booking.create.mockResolvedValue({ id: "cm000000000000000000000010" });

    const res = await POST(
      makePostRequest({
        kind: "RESERVATION",
        title: "Student draft",
        requesterUserId: "cm000000000000000000000088",
      }),
      noParams,
    );

    expect(res.status).toBe(201);
    expect(mockTx.booking.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        requesterUserId: "cm000000000000000000000099",
      }),
    });
  });

  it("writes the draft-created audit in the same transaction", async () => {
    mockTx.booking.create.mockResolvedValue({ id: "cm000000000000000000000010" });

    const res = await POST(
      makePostRequest({ kind: "RESERVATION", title: "Audited draft" }),
      noParams,
    );

    expect(res.status).toBe(201);
    expect(mockTx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: user.id,
        entityId: "cm000000000000000000000010",
        action: "draft_created",
      }),
    });
  });

  it("updates and audits an owned draft in one transaction", async () => {
    mockTx.booking.findFirst.mockResolvedValue({
      id: "cm000000000000000000000010",
      kind: "RESERVATION",
      title: "Before",
      requesterUserId: user.id,
      locationId: "cm000000000000000000000002",
      startsAt: new Date("2026-07-01T12:00:00.000Z"),
      endsAt: new Date("2026-07-01T16:00:00.000Z"),
      eventId: null,
      events: [],
      sportCode: null,
      notes: null,
      serializedItems: [],
      bulkItems: [],
    });

    const res = await POST(
      makePostRequest({
        id: "cm000000000000000000000010",
        kind: "RESERVATION",
        title: "After",
      }),
      noParams,
    );

    expect(res.status).toBe(200);
    expect(mockTx.booking.update).toHaveBeenCalledWith({
      where: { id: "cm000000000000000000000010" },
      data: expect.objectContaining({ title: "After" }),
    });
    expect(mockTx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entityId: "cm000000000000000000000010",
        action: "draft_updated",
        beforeJson: expect.objectContaining({ title: "Before" }),
        afterJson: expect.objectContaining({ title: "After" }),
      }),
    });
  });

  it("rejects serialized equipment above the request ceiling before opening a transaction", async () => {
    const serializedAssetIds = Array.from(
      { length: MAX_EQUIPMENT_SELECTIONS_PER_REQUEST + 1 },
      (_, index) => cuid(index),
    );

    const res = await POST(
      makePostRequest({ kind: "RESERVATION", serializedAssetIds }),
      noParams,
    );

    expect(res.status).toBe(400);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("rejects bulk lines above the request ceiling before opening a transaction", async () => {
    const bulkItems = Array.from(
      { length: MAX_BULK_SKU_LINES_PER_REQUEST + 1 },
      (_, index) => ({ bulkSkuId: cuid(index), quantity: 1 }),
    );

    const res = await POST(
      makePostRequest({ kind: "RESERVATION", bulkItems }),
      noParams,
    );

    expect(res.status).toBe(400);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("rejects bulk quantity above the per-line ceiling before opening a transaction", async () => {
    const res = await POST(
      makePostRequest({
        kind: "RESERVATION",
        bulkItems: [{
          bulkSkuId: "cm000000000000000000000004",
          quantity: MAX_BULK_QUANTITY_PER_LINE + 1,
        }],
      }),
      noParams,
    );

    expect(res.status).toBe(400);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("rejects invalid draft timestamps before opening a transaction", async () => {
    const res = await POST(
      makePostRequest({ kind: "RESERVATION", startsAt: "not-a-date" }),
      noParams,
    );

    expect(res.status).toBe(400);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("rejects duplicate serialized and bulk equipment lines before database constraints", async () => {
    const assetId = "cm000000000000000000000004";
    const bulkSkuId = "cm000000000000000000000005";
    const res = await POST(
      makePostRequest({
        kind: "RESERVATION",
        serializedAssetIds: [assetId, assetId],
        bulkItems: [
          { bulkSkuId, quantity: 1 },
          { bulkSkuId, quantity: 2 },
        ],
      }),
      noParams,
    );

    expect(res.status).toBe(400);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("rejects Field House reservation drafts before saving", async () => {
    vi.mocked(db.location.findUnique).mockResolvedValue(location({
      id: "cm000000000000000000000003",
      active: true,
      name: "UW Field House",
    }));

    const res = await POST(
      makePostRequest({
        kind: "RESERVATION",
        title: "Field House draft",
        locationId: "cm000000000000000000000003",
      }),
      noParams,
    );

    expect(res.status).toBe(400);
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(mockTx.booking.create).not.toHaveBeenCalled();
  });
});

describe("GET /api/drafts", () => {
  it("lists recent drafts without deleting expired rows from a read request", async () => {
    vi.mocked(db.booking.findMany).mockResolvedValue([]);

    const res = await GET_DRAFTS(
      new Request("https://app.example.com/api/drafts", {
        headers: { host: "app.example.com" },
      }),
      noParams,
    );

    expect(res.status).toBe(200);
    expect(db.booking.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "DRAFT", createdBy: user.id }),
      take: 10,
    }));
  });
});

describe("GET /api/drafts/[id]", () => {
  it("returns ordered linked events for draft resume", async () => {
    vi.mocked(db.booking.findFirst).mockResolvedValue(draft({
      id: "cm000000000000000000000010",
      kind: "RESERVATION",
      title: "Regional road trip",
      requesterUserId: user.id,
      locationId: "cm000000000000000000000002",
      location: { id: "cm000000000000000000000002", name: "Camp Randall" },
      startsAt: new Date("2026-05-30T18:00:00Z"),
      endsAt: new Date("2026-06-02T23:00:00Z"),
      eventId: "cm000000000000000000000102",
      event: null,
      events: [
        {
          ordinal: 0,
          event: {
            id: "cm000000000000000000000102",
            summary: "Regional opener",
            startsAt: new Date("2026-05-30T20:00:00Z"),
            endsAt: new Date("2026-05-30T22:00:00Z"),
            sportCode: "SB",
            isHome: false,
            opponent: "Minnesota",
            rawLocationText: "Minneapolis",
            location: null,
          },
        },
        {
          ordinal: 1,
          event: {
            id: "cm000000000000000000000101",
            summary: "Regional final",
            startsAt: new Date("2026-06-02T20:00:00Z"),
            endsAt: new Date("2026-06-02T22:00:00Z"),
            sportCode: "SB",
            isHome: false,
            opponent: "Iowa",
            rawLocationText: "Minneapolis",
            location: null,
          },
        },
      ],
      sportCode: "SB",
      notes: null,
      serializedItems: [],
      bulkItems: [],
      updatedAt: new Date("2026-05-07T02:00:00Z"),
    }));

    const res = await GET_DRAFT(makeGetRequest(), draftParams);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.events.map((event: { id: string }) => event.id)).toEqual([
      "cm000000000000000000000102",
      "cm000000000000000000000101",
    ]);
    expect(body.data.events[0].startsAt).toBe("2026-05-30T20:00:00.000Z");
  });
});

describe("DELETE /api/drafts/[id]", () => {
  it("deletes and audits an owned reservation draft atomically", async () => {
    mockTx.booking.findFirst.mockResolvedValue({
      id: "cm000000000000000000000010",
      kind: "RESERVATION",
      title: "Draft",
      requesterUserId: user.id,
    });

    const res = await DELETE(makeDeleteRequest(), draftParams);

    expect(res.status).toBe(200);
    expect(mockTx.booking.delete).toHaveBeenCalledWith({
      where: { id: "cm000000000000000000000010" },
    });
    expect(mockTx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entityId: "cm000000000000000000000010",
        action: "draft_discarded",
      }),
    });
  });
});
