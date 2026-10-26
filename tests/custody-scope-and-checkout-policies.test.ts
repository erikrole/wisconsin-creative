import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookingCustodyScope, BookingKind, BookingStatus, Role } from "@prisma/client";
import { authUser, jsonRequest } from "./_helpers/route-request";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  bookingFindUnique: vi.fn(),
  bookingUpdate: vi.fn(),
  userFindUnique: vi.fn(),
  configFindUnique: vi.fn(),
  configUpsert: vi.fn(),
  createAuditEntry: vi.fn(),
  createAuditEntryTx: vi.fn(),
  enforceRateLimit: vi.fn(),
  txOptions: [] as unknown[],
}));

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth, requireKiosk: vi.fn() }));
vi.mock("@/lib/db", () => {
  const tx = {
    booking: { findUnique: mocks.bookingFindUnique, update: mocks.bookingUpdate },
    user: { findUnique: mocks.userFindUnique },
  };
  return {
    db: {
      $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>, options?: unknown) => {
        mocks.txOptions.push(options);
        return fn(tx);
      }),
      systemConfig: { findUnique: mocks.configFindUnique, upsert: mocks.configUpsert },
    },
  };
});
vi.mock("@/lib/audit", () => ({ createAuditEntry: mocks.createAuditEntry, createAuditEntryTx: mocks.createAuditEntryTx }));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  enforceRateLimit: mocks.enforceRateLimit,
}));

import { HttpError } from "@/lib/http";
import { updateBookingCustodyScope } from "@/lib/services/booking-custody";
import { GET, PUT } from "@/app/api/settings/checkout-policies/route";

const SNAPSHOT = new Date("2026-10-24T20:00:00.000Z");

function checkout(over: Record<string, unknown> = {}) {
  return {
    id: "co-1",
    kind: BookingKind.CHECKOUT,
    status: BookingStatus.OPEN,
    custodyScope: BookingCustodyScope.PERSON,
    updatedAt: SNAPSHOT,
    ...over,
  };
}

const share = (over: Partial<Parameters<typeof updateBookingCustodyScope>[0]> = {}) =>
  updateBookingCustodyScope({
    bookingId: "co-1",
    actorUserId: "staff-1",
    custodyScope: BookingCustodyScope.SHARED,
    expectedUpdatedAt: SNAPSHOT,
    ...over,
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.txOptions.length = 0;
  mocks.bookingFindUnique.mockResolvedValue(checkout());
  mocks.userFindUnique.mockResolvedValue({ role: Role.STAFF });
  mocks.bookingUpdate.mockImplementation(async ({ data }: { data: { custodyScope: BookingCustodyScope } }) =>
    checkout({ custodyScope: data.custodyScope, updatedAt: new Date("2026-10-24T20:05:00.000Z") }));
});

describe("updateBookingCustodyScope", () => {
  it("lets staff move an open checkout to shared custody, audited, in a serializable transaction", async () => {
    const result = await share();

    expect(result.custodyScope).toBe(BookingCustodyScope.SHARED);
    expect(mocks.createAuditEntryTx).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      actorId: "staff-1",
      actorRole: Role.STAFF,
      entityId: "co-1",
      action: "custody_scope_changed",
      before: { custodyScope: BookingCustodyScope.PERSON },
      after: { custodyScope: BookingCustodyScope.SHARED },
    }));
    expect(mocks.txOptions[0]).toEqual({ isolationLevel: "Serializable" });
  });

  it("does nothing when the checkout already has that custody", async () => {
    mocks.bookingFindUnique.mockResolvedValue(checkout({ custodyScope: BookingCustodyScope.SHARED }));

    await share();

    expect(mocks.bookingUpdate).not.toHaveBeenCalled();
    expect(mocks.createAuditEntryTx).not.toHaveBeenCalled();
  });

  it.each([Role.STUDENT, Role.COLLABORATOR])("refuses a %s", async (role) => {
    mocks.userFindUnique.mockResolvedValue({ role });

    await expect(share()).rejects.toMatchObject({ status: 403 });
    expect(mocks.bookingUpdate).not.toHaveBeenCalled();
  });

  it("refuses an unknown actor", async () => {
    mocks.userFindUnique.mockResolvedValue(null);

    await expect(share()).rejects.toMatchObject({ status: 403 });
  });

  it("answers 404 for a missing checkout", async () => {
    mocks.bookingFindUnique.mockResolvedValue(null);

    await expect(share()).rejects.toMatchObject({ status: 404 });
  });

  it("only applies to checkouts", async () => {
    mocks.bookingFindUnique.mockResolvedValue(checkout({ kind: BookingKind.RESERVATION, status: BookingStatus.BOOKED }));

    await expect(share()).rejects.toThrow("Shared custody is available only for checkouts");
  });

  it.each([BookingStatus.COMPLETED, BookingStatus.CANCELLED, BookingStatus.DRAFT])("refuses a %s checkout", async (status) => {
    mocks.bookingFindUnique.mockResolvedValue(checkout({ status }));

    await expect(share()).rejects.toThrow("Custody cannot be changed for this checkout state");
  });

  it.each([BookingStatus.BOOKED, BookingStatus.PENDING_PICKUP])("allows a %s checkout", async (status) => {
    mocks.bookingFindUnique.mockResolvedValue(checkout({ status }));

    await expect(share()).resolves.toMatchObject({ custodyScope: BookingCustodyScope.SHARED });
  });

  it("refuses a change made against a stale copy", async () => {
    await expect(share({ expectedUpdatedAt: new Date("2026-10-24T19:00:00.000Z") })).rejects.toMatchObject({ status: 409 });
    expect(mocks.bookingUpdate).not.toHaveBeenCalled();
  });
});

describe("/api/settings/checkout-policies", () => {
  const policies = { defaultLoanDays: 5, gracePeriodHours: 2, maxItemsPerUser: 12 };
  const put = (body: unknown) => PUT(jsonRequest("/api/settings/checkout-policies", "PUT", body), { params: Promise.resolve({}) });
  const get = () => GET(jsonRequest("/api/settings/checkout-policies", "GET"), { params: Promise.resolve({}) });

  beforeEach(() => {
    mocks.requireAuth.mockResolvedValue(authUser(Role.ADMIN, "erik"));
    mocks.configFindUnique.mockResolvedValue(null);
  });

  it("returns the defaults when nothing is saved", async () => {
    const res = await get();

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ defaultLoanDays: 3, gracePeriodHours: 0, maxItemsPerUser: null });
  });

  it("repairs out-of-range saved values on read", async () => {
    mocks.configFindUnique.mockResolvedValue({ value: { defaultLoanDays: 900, gracePeriodHours: -1, maxItemsPerUser: 4.4 } });

    expect((await (await get()).json()).data).toEqual({ defaultLoanDays: 3, gracePeriodHours: 0, maxItemsPerUser: 4 });
  });

  it("saves new policies and audits the before and after", async () => {
    mocks.configFindUnique.mockResolvedValue({ value: { defaultLoanDays: 3, gracePeriodHours: 0, maxItemsPerUser: null } });

    const res = await put(policies);

    expect(res.status).toBe(200);
    expect(mocks.enforceRateLimit).toHaveBeenCalledWith("checkout-policies:write:erik", expect.anything());
    expect(mocks.configUpsert).toHaveBeenCalledWith(expect.objectContaining({ update: { value: policies } }));
    expect(mocks.createAuditEntry).toHaveBeenCalledWith(expect.objectContaining({
      action: "checkout_policies_updated",
      before: { defaultLoanDays: 3, gracePeriodHours: 0, maxItemsPerUser: null },
      after: policies,
    }));
  });

  it.each([
    ["a zero-day loan", { ...policies, defaultLoanDays: 0 }],
    ["a fractional loan length", { ...policies, defaultLoanDays: 2.5 }],
    ["a grace period over a week", { ...policies, gracePeriodHours: 169 }],
    ["an item cap over 100", { ...policies, maxItemsPerUser: 101 }],
  ])("rejects %s", async (_label, body) => {
    const res = await put(body);

    expect(res.status).toBe(400);
    expect(mocks.configUpsert).not.toHaveBeenCalled();
  });

  it.each([Role.STAFF, Role.STUDENT])("is admin only (%s refused)", async (role) => {
    mocks.requireAuth.mockResolvedValue(authUser(role));

    expect((await get()).status).toBe(403);
    expect((await put(policies)).status).toBe(403);
    expect(mocks.configUpsert).not.toHaveBeenCalled();
  });

  it("stops at the rate limit before writing", async () => {
    mocks.enforceRateLimit.mockRejectedValue(new HttpError(429, "Too many requests"));

    expect((await put(policies)).status).toBe(429);
    expect(mocks.configUpsert).not.toHaveBeenCalled();
  });
});
