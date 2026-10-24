import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookingCustodyScope, Role } from "@prisma/client";
import { authUser, CUID_A, CUID_B, CUID_C, jsonRequest } from "./_helpers/route-request";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  checkRateLimit: vi.fn(),
  mergeReservations: vi.fn(),
  previewReservationMerge: vi.fn(),
  notify: vi.fn(),
  deferRefresh: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth, requireKiosk: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/services/bookings", () => ({
  mergeReservations: mocks.mergeReservations,
  previewReservationMerge: mocks.previewReservationMerge,
}));
vi.mock("@/lib/services/notifications", () => ({ createReservationLifecycleNotification: mocks.notify }));
vi.mock("@/lib/services/companion-projection-publisher", () => ({
  deferCompanionProjectionRefresh: vi.fn(),
  deferCompanionProjectionRefreshForCommittedMutation: mocks.deferRefresh,
}));

import { POST as merge } from "@/app/api/reservations/merge/route";
import { POST as preview } from "@/app/api/reservations/merge/preview/route";

const ctx = { params: Promise.resolve({}) };
const staff = authUser(Role.STAFF);

function merged(custodyScope: BookingCustodyScope) {
  return {
    id: CUID_A,
    title: "Volleyball vs. Nebraska",
    requesterUserId: "student-1",
    updatedAt: new Date("2026-10-24T18:00:00Z"),
    custodyScope,
  };
}

beforeEach(() => {
  mocks.requireAuth.mockResolvedValue(staff);
  mocks.checkRateLimit.mockResolvedValue({ allowed: true });
  mocks.mergeReservations.mockResolvedValue(merged(BookingCustodyScope.PERSON));
  mocks.previewReservationMerge.mockResolvedValue({ items: [] });
});

describe("POST /api/reservations/merge", () => {
  it("merges into the surviving reservation, notifies the requester and reports the absorbed ids", async () => {
    const res = await merge(jsonRequest("/api/reservations/merge", "POST", { ids: [CUID_A, CUID_B, CUID_C] }), ctx);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mocks.mergeReservations).toHaveBeenCalledWith({ ids: [CUID_A, CUID_B, CUID_C], actorUserId: staff.id, actorRole: Role.STAFF });
    expect(body.meta.mergedReservationIds).toEqual([CUID_B, CUID_C]);
    expect(body.meta.message).toBe("Merged 3 reservations into Volleyball vs. Nebraska.");
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ bookingId: CUID_A, requesterUserId: "student-1", event: "updated" }));
    expect(mocks.deferRefresh).toHaveBeenCalledTimes(1);
  });

  it("does not send a personal notification for shared custody bookings", async () => {
    mocks.mergeReservations.mockResolvedValue(merged(BookingCustodyScope.SHARED));
    const res = await merge(jsonRequest("/api/reservations/merge", "POST", { ids: [CUID_A, CUID_B] }), ctx);
    expect(res.status).toBe(200);
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("forbids students before touching any booking", async () => {
    mocks.requireAuth.mockResolvedValue(authUser(Role.STUDENT));
    const res = await merge(jsonRequest("/api/reservations/merge", "POST", { ids: [CUID_A, CUID_B] }), ctx);
    expect(res.status).toBe(403);
    expect(mocks.mergeReservations).not.toHaveBeenCalled();
  });

  it("rejects a single id, more than 25 ids and unknown fields", async () => {
    for (const body of [
      { ids: [CUID_A] },
      { ids: Array.from({ length: 26 }, () => CUID_A) },
      { ids: [CUID_A, CUID_B], force: true },
      { ids: ["not-a-cuid", CUID_B] },
    ]) {
      const res = await merge(jsonRequest("/api/reservations/merge", "POST", body), ctx);
      expect(res.status).toBe(400);
    }
    expect(mocks.mergeReservations).not.toHaveBeenCalled();
  });

  it("returns 429 when the merge rate limit is spent", async () => {
    mocks.checkRateLimit.mockResolvedValue({ allowed: false });
    const res = await merge(jsonRequest("/api/reservations/merge", "POST", { ids: [CUID_A, CUID_B] }), ctx);
    expect(res.status).toBe(429);
    expect(mocks.mergeReservations).not.toHaveBeenCalled();
  });
});

describe("POST /api/reservations/merge/preview", () => {
  it("previews for staff and forbids students", async () => {
    const okRes = await preview(jsonRequest("/api/reservations/merge/preview", "POST", { ids: [CUID_A, CUID_B] }), ctx);
    expect(okRes.status).toBe(200);
    expect(mocks.previewReservationMerge).toHaveBeenCalledWith([CUID_A, CUID_B]);

    mocks.requireAuth.mockResolvedValue(authUser(Role.STUDENT));
    const denied = await preview(jsonRequest("/api/reservations/merge/preview", "POST", { ids: [CUID_A, CUID_B] }), ctx);
    expect(denied.status).toBe(403);
  });
});
