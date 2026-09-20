import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    auditLog: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));
vi.mock("@/lib/services/bookings", () => ({
  getBookingDetail: vi.fn(),
  updateReservation: vi.fn(),
  updateCheckout: vi.fn(),
  updateBookingEvents: vi.fn(),
}));
vi.mock("@/lib/services/booking-rules", () => ({
  getAllowedBookingActions: vi.fn(() => ["edit", "extend", "cancel"]),
  requireBookingAction: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({ createAuditEntry: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getBookingDetail, updateBookingEvents } from "@/lib/services/bookings";
import { requireBookingAction } from "@/lib/services/booking-rules";
import { PATCH as patchBooking } from "@/app/api/bookings/[id]/route";
import { POST as updateEvents } from "@/app/api/bookings/[id]/events/route";
import { GET as getAuditLogs } from "@/app/api/bookings/[id]/audit-logs/route";

const collaborator = {
  id: "btn-1",
  email: "trey@example.com",
  name: "Trey",
  role: Role.COLLABORATOR,
  affiliation: "BIG_TEN_NETWORK" as const,
  collaboratorProfile: "BTN_STANDARD" as const,
  capabilities: [
    "MY_GEAR_VIEW" as const,
    "RESERVATION_EDIT_OWN" as const,
  ],
  avatarUrl: null,
};

const privateDetail = {
  id: "cm000000000000000000000001",
  refNumber: "RV-1001",
  kind: "RESERVATION",
  status: "BOOKED",
  title: "Game Gear",
  requesterUserId: collaborator.id,
  createdBy: collaborator.id,
  locationId: "cm000000000000000000000002",
  startsAt: new Date("2026-09-01T17:00:00.000Z"),
  endsAt: new Date("2026-09-01T23:00:00.000Z"),
  createdAt: new Date("2026-08-01T12:00:00.000Z"),
  updatedAt: new Date("2026-08-01T12:05:00.000Z"),
  notes: "Collaborator-owned note",
  location: { id: "cm000000000000000000000002", name: "Camp Randall" },
  requester: { id: collaborator.id, name: "Trey", email: collaborator.email, avatarUrl: null },
  creator: { id: collaborator.id, name: "Trey", email: collaborator.email, avatarUrl: null },
  serializedItems: [{
    id: "line-1",
    assetId: "asset-1",
    allocationStatus: "active",
    asset: {
      id: "asset-1",
      assetTag: "CAM-1",
      brand: "Brand",
      model: "Model",
      serialNumber: "PRIVATE-SERIAL",
      imageUrl: null,
    },
  }],
  bulkItems: [],
  event: { id: "cm000000000000000000000003", summary: "Wisconsin vs Michigan" },
  events: [{ id: "cm000000000000000000000003", summary: "Wisconsin vs Michigan" }],
  auditLogs: [{ id: "audit-1", beforeJson: { secret: true } }],
  photos: [{ id: "photo-1", imageUrl: "https://private.example/photo.jpg" }],
};

function mutationRequest(path: string, body: Record<string, unknown>, method = "POST") {
  return new Request(`https://app.example.com${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      host: "app.example.com",
      origin: "https://app.example.com",
      "if-unmodified-since": "Fri, 01 Aug 2026 12:00:00 GMT",
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(collaborator);
  vi.mocked(getBookingDetail).mockResolvedValue(privateDetail as unknown as Awaited<ReturnType<typeof getBookingDetail>>);
  vi.mocked(requireBookingAction).mockResolvedValue(privateDetail as unknown as Awaited<ReturnType<typeof requireBookingAction>>);
});

describe("collaborator booking route hardening", () => {
  it("BUG: sanitizes an idempotent stale booking edit response", async () => {
    const request = mutationRequest(`/api/bookings/${privateDetail.id}`, { title: privateDetail.title }, "PATCH");

    const response = await patchBooking(request, { params: Promise.resolve({ id: privateDetail.id }) });
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(serialized).not.toContain("PRIVATE-SERIAL");
    expect(serialized).not.toContain("auditLogs");
    expect(serialized).not.toContain("photos");
    expect(serialized).not.toContain("creator");
    expect(body.data.requester).not.toHaveProperty("email");
    expect(body.data).not.toHaveProperty("event");
    expect(body.data).not.toHaveProperty("events");
  });

  it("BUG: sanitizes an idempotent booking-event edit response", async () => {
    const response = await updateEvents(
      mutationRequest(`/api/bookings/${privateDetail.id}/events`, { eventIds: ["cm000000000000000000000003"] }),
      { params: Promise.resolve({ id: privateDetail.id }) },
    );
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(updateBookingEvents).not.toHaveBeenCalled();
    expect(serialized).not.toContain("PRIVATE-SERIAL");
    expect(serialized).not.toContain("auditLogs");
    expect(serialized).not.toContain("photos");
    expect(body.data).not.toHaveProperty("event");
    expect(body.data).not.toHaveProperty("events");
  });

  it("BUG: denies collaborator access to booking audit history", async () => {
    const response = await getAuditLogs(
      new Request(`https://app.example.com/api/bookings/${privateDetail.id}/audit-logs`, {
        headers: { host: "app.example.com" },
      }),
      { params: Promise.resolve({ id: privateDetail.id }) },
    );

    expect(response.status).toBe(403);
    expect(requireBookingAction).not.toHaveBeenCalled();
    expect(db.auditLog.findMany).not.toHaveBeenCalled();
  });

  it("rejects booking audit cursors outside the requested booking", async () => {
    const staffUser = { ...collaborator, role: Role.STAFF, affiliation: undefined, collaboratorProfile: undefined, capabilities: undefined };
    vi.mocked(requireAuth).mockResolvedValue(staffUser as unknown as Awaited<ReturnType<typeof requireAuth>>);
    vi.mocked(db.auditLog.findFirst).mockResolvedValue(null);

    const response = await getAuditLogs(
      new Request(`https://app.example.com/api/bookings/${privateDetail.id}/audit-logs?cursor=other-log`, {
        headers: { host: "app.example.com" },
      }),
      { params: Promise.resolve({ id: privateDetail.id }) },
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("Invalid audit cursor");
    expect(db.auditLog.findMany).not.toHaveBeenCalled();
  });
});
