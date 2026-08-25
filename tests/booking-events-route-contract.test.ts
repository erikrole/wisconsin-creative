import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookingKind, Role } from "@prisma/client";

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/services/bookings", () => ({
  getBookingDetail: vi.fn(),
  updateBookingEvents: vi.fn(),
}));

vi.mock("@/lib/services/booking-rules", () => ({
  getAllowedBookingActions: vi.fn(() => ["edit", "transfer-owner"]),
  requireBookingAction: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import { requireAuth } from "@/lib/auth";
import { getBookingDetail, updateBookingEvents } from "@/lib/services/bookings";
import { requireBookingAction } from "@/lib/services/booking-rules";
import { MAX_LINKED_EVENTS_PER_BOOKING } from "@/lib/request-limits";
import { POST } from "@/app/api/bookings/[id]/events/route";

const studentUser = {
  id: "cm000000000000000000000002",
  email: "student@example.com",
  name: "Student One",
  role: Role.STUDENT,
  avatarUrl: null,
};

const baseDetail = {
  id: "cm000000000000000000000001",
  kind: BookingKind.RESERVATION,
  title: "Volleyball Media Day",
  requesterUserId: studentUser.id,
  createdBy: studentUser.id,
  locationId: "cm000000000000000000000003",
  startsAt: new Date("2026-07-09T16:00:00.000Z"),
  endsAt: new Date("2026-07-09T18:00:00.000Z"),
  updatedAt: new Date("2026-07-09T16:00:00.500Z"),
  events: [
    { id: "cm000000000000000000000101" },
    { id: "cm000000000000000000000102" },
  ],
  event: null,
};

const eventIds = [
  "cm000000000000000000000101",
  "cm000000000000000000000102",
];

function request(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Request(`${"https://app.example.com"}/api/bookings/${baseDetail.id}/events`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "app.example.com",
      origin: "https://app.example.com",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function bookingDetail(row: unknown) {
  return row as Awaited<ReturnType<typeof getBookingDetail>>;
}

function bookingActionResult(row: unknown) {
  return row as Awaited<ReturnType<typeof requireBookingAction>>;
}

function updateEventsResult(row: unknown) {
  return row as Awaited<ReturnType<typeof updateBookingEvents>>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(studentUser);
  vi.mocked(getBookingDetail).mockResolvedValue(bookingDetail(baseDetail));
  vi.mocked(requireBookingAction).mockResolvedValue(bookingActionResult(baseDetail));
  vi.mocked(updateBookingEvents).mockResolvedValue(updateEventsResult(baseDetail));
});

describe("booking event-link route contract", () => {
  it("requires an optimistic-lock header", async () => {
    const res = await POST(
      request({ eventIds }),
      { params: Promise.resolve({ id: baseDetail.id }) },
    );

    expect(res.status).toBe(428);
    expect(requireBookingAction).not.toHaveBeenCalled();
    expect(updateBookingEvents).not.toHaveBeenCalled();
  });

  it("rejects a stale snapshot before dispatching the service", async () => {
    vi.mocked(getBookingDetail).mockResolvedValue(bookingDetail({
      ...baseDetail,
      events: [{ id: "cm000000000000000000000103" }],
    }));

    const res = await POST(
      request(
        { eventIds },
        { "if-unmodified-since": "Thu, 09 Jul 2026 15:59:59 GMT" },
      ),
      { params: Promise.resolve({ id: baseDetail.id }) },
    );

    expect(res.status).toBe(409);
    expect(requireBookingAction).not.toHaveBeenCalled();
    expect(updateBookingEvents).not.toHaveBeenCalled();
  });

  it("treats stale duplicate event links as idempotent success", async () => {
    const res = await POST(
      request(
        { eventIds: [...eventIds].reverse() },
        { "if-unmodified-since": "Thu, 09 Jul 2026 15:59:59 GMT" },
      ),
      { params: Promise.resolve({ id: baseDetail.id }) },
    );

    expect(res.status).toBe(200);
    expect(requireBookingAction).toHaveBeenCalledWith(baseDetail.id, studentUser, "edit");
    expect(updateBookingEvents).not.toHaveBeenCalled();
  });

  it("rejects duplicate eventIds at the route boundary", async () => {
    const res = await POST(
      request(
        { eventIds: [eventIds[0], eventIds[0]] },
        { "if-unmodified-since": "Thu, 09 Jul 2026 16:00:00 GMT" },
      ),
      { params: Promise.resolve({ id: baseDetail.id }) },
    );

    expect(res.status).toBe(400);
    expect(requireBookingAction).not.toHaveBeenCalled();
    expect(updateBookingEvents).not.toHaveBeenCalled();
  });

  it("allows five eventIds at the route boundary", async () => {
    const maximumEventIds = [
      "cm000000000000000000000101",
      "cm000000000000000000000102",
      "cm000000000000000000000103",
      "cm000000000000000000000104",
      "cm000000000000000000000105",
    ];
    const res = await POST(
      request(
        { eventIds: maximumEventIds },
        { "if-unmodified-since": "Thu, 09 Jul 2026 16:00:00 GMT" },
      ),
      { params: Promise.resolve({ id: baseDetail.id }) },
    );

    expect(res.status).toBe(200);
    expect(updateBookingEvents).toHaveBeenCalledWith(
      baseDetail.id,
      studentUser.id,
      maximumEventIds,
      new Date("2026-07-09T16:00:00.000Z"),
    );
  });

  it("rejects more than five eventIds at the route boundary", async () => {
    const res = await POST(
      request(
        {
          eventIds: Array.from(
            { length: MAX_LINKED_EVENTS_PER_BOOKING + 1 },
            (_, index) => `cm00000000000000000000010${index + 1}`,
          ),
        },
        { "if-unmodified-since": "Thu, 09 Jul 2026 16:00:00 GMT" },
      ),
      { params: Promise.resolve({ id: baseDetail.id }) },
    );

    expect(res.status).toBe(400);
    expect(requireBookingAction).not.toHaveBeenCalled();
    expect(updateBookingEvents).not.toHaveBeenCalled();
  });

  it("dispatches fresh event links to the service", async () => {
    const res = await POST(
      request(
        { eventIds },
        { "if-unmodified-since": "Thu, 09 Jul 2026 16:00:00 GMT" },
      ),
      { params: Promise.resolve({ id: baseDetail.id }) },
    );

    expect(res.status).toBe(200);
    expect(requireBookingAction).toHaveBeenCalledWith(baseDetail.id, studentUser, "edit");
    expect(updateBookingEvents).toHaveBeenCalledWith(
      baseDetail.id,
      studentUser.id,
      eventIds,
      new Date("2026-07-09T16:00:00.000Z"),
    );
  });

  it("allows clearing linked events", async () => {
    const res = await POST(
      request(
        { eventIds: [] },
        { "if-unmodified-since": "Thu, 09 Jul 2026 16:00:00 GMT" },
      ),
      { params: Promise.resolve({ id: baseDetail.id }) },
    );

    expect(res.status).toBe(200);
    expect(updateBookingEvents).toHaveBeenCalledWith(
      baseDetail.id,
      studentUser.id,
      [],
      new Date("2026-07-09T16:00:00.000Z"),
    );
  });

  it("allows checkout bookings", async () => {
    vi.mocked(getBookingDetail).mockResolvedValue(bookingDetail({
      ...baseDetail,
      kind: BookingKind.CHECKOUT,
    }));

    const res = await POST(
      request(
        { eventIds },
        { "if-unmodified-since": "Thu, 09 Jul 2026 16:00:00 GMT" },
      ),
      { params: Promise.resolve({ id: baseDetail.id }) },
    );

    expect(res.status).toBe(200);
    expect(requireBookingAction).toHaveBeenCalledWith(baseDetail.id, studentUser, "edit");
    expect(updateBookingEvents).toHaveBeenCalledWith(
      baseDetail.id,
      studentUser.id,
      eventIds,
      new Date("2026-07-09T16:00:00.000Z"),
    );
  });

  it("rejects an invalid optimistic-lock header", async () => {
    const res = await POST(
      request(
        { eventIds },
        { "if-unmodified-since": "not-a-date" },
      ),
      { params: Promise.resolve({ id: baseDetail.id }) },
    );

    expect(res.status).toBe(400);
    expect(updateBookingEvents).not.toHaveBeenCalled();
  });
});
