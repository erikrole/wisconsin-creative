import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    booking: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    escalationRule: { findMany: vi.fn() },
    systemConfig: { findUnique: vi.fn(), findMany: vi.fn() },
    user: { findMany: vi.fn() },
    notification: { findMany: vi.fn(), create: vi.fn() },
  },
  push: vi.fn(),
  email: vi.fn(),
  policies: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/services/checkout-policies", () => ({ loadCheckoutPolicies: mocks.policies }));
vi.mock("@/lib/email", () => ({ buildNotificationEmail: vi.fn(() => ({ html: "<p>email</p>", text: "email" })) }));
vi.mock("@/lib/services/notification-delivery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/notification-delivery")>()),
  deferPush: (task: Promise<void>) => { void task; },
  sendPushToUser: mocks.push,
  sendEmailToUser: mocks.email,
}));

import {
  getCheckoutEscalationStageTiming,
  processCheckoutEscalationStage,
  processOverdueNotifications,
} from "@/lib/services/checkout-escalation-notifications";

const DUE = new Date("2026-10-24T22:00:00.000Z");
const hoursAfterDue = (hours: number) => new Date(DUE.getTime() + hours * 3_600_000);

const erik = { id: "erik", name: "Erik", email: "erik@example.com", role: "ADMIN" };
const casey = { id: "casey", name: "Casey", email: "casey@example.com", role: "STAFF" };
const pat = { id: "pat", name: "Pat", email: "pat@example.com", role: "STAFF" };

function checkout(over: Record<string, unknown> = {}) {
  return {
    id: "co-1",
    kind: "CHECKOUT",
    status: "OPEN",
    title: "Volleyball shoot",
    requesterUserId: "maya",
    custodyScope: "PERSON",
    locationId: "cr",
    createdBy: "casey",
    endsAt: DUE,
    requester: { id: "maya", name: "Maya", email: "maya@example.com" },
    ...over,
  };
}

function created() {
  return mocks.db.notification.create.mock.calls.map(([arg]) => ({
    userId: arg.data.userId,
    type: arg.data.type,
    kind: arg.data.payload.recipientKind,
  }));
}

beforeEach(() => {
  mocks.db.escalationRule.findMany.mockResolvedValue([]); // the built-in schedule
  mocks.policies.mockResolvedValue({ gracePeriodHours: 0.25 });
  mocks.db.systemConfig.findUnique.mockResolvedValue(null);
  mocks.db.systemConfig.findMany.mockResolvedValue([]);
  mocks.db.user.findMany.mockResolvedValue([erik, casey, pat]);
  mocks.db.notification.findMany.mockResolvedValue([]);
  mocks.db.notification.create.mockImplementation(async () => ({ id: `n-${mocks.db.notification.create.mock.calls.length}` }));
  mocks.db.booking.findUnique.mockResolvedValue(checkout());
  mocks.push.mockResolvedValue(undefined);
  mocks.email.mockResolvedValue(undefined);
});

describe("one escalation stage for one checkout", () => {
  it("tells only the holder when the checkout is due in two hours, by push without email", async () => {
    const result = await processCheckoutEscalationStage({
      bookingId: "co-1", expectedEndsAt: DUE, stageType: "checkout_due_2h", now: hoursAfterDue(-1.9),
    });

    expect(result).toEqual({ status: "sent", notificationsCreated: 1 });
    expect(created()).toEqual([{ userId: "maya", type: "checkout_due_2h", kind: "requester" }]);
    expect(mocks.push).toHaveBeenCalledWith("maya", expect.objectContaining({
      subtitle: "Volleyball shoot",
      collapseId: "checkout-co-1",
      quietOvernight: false,
    }));
    expect(mocks.email).not.toHaveBeenCalled();
  });

  it("names the grace period in the due-now message", async () => {
    await processCheckoutEscalationStage({
      bookingId: "co-1", expectedEndsAt: DUE, stageType: "checkout_due_now", now: hoursAfterDue(0.05),
    });

    expect(mocks.db.notification.create.mock.calls[0]![0].data.body)
      .toBe("\"Volleyball shoot\" is due now. The 15-minute return grace period has started.");
  });

  it("at four hours overdue also reaches the person who made the checkout, quietly overnight", async () => {
    const result = await processCheckoutEscalationStage({
      bookingId: "co-1", expectedEndsAt: DUE, stageType: "checkout_overdue_4h", now: hoursAfterDue(4.1),
    });

    expect(result.notificationsCreated).toBe(2);
    expect(created()).toEqual([
      { userId: "maya", type: "checkout_overdue_4h", kind: "requester" },
      { userId: "casey", type: "checkout_overdue_4h", kind: "responder" },
    ]);
    expect(mocks.email).toHaveBeenCalledTimes(1);
    expect(mocks.email).toHaveBeenCalledWith("maya", expect.objectContaining({ subject: "4 hours overdue: Volleyball shoot" }), "checkoutOverdue");
    expect(mocks.push).toHaveBeenCalledWith("casey", expect.objectContaining({
      title: "Checkout 4 hours overdue",
      body: "Maya hasn't returned it. Follow up with them.",
      collapseId: "checkout-co-1-followup",
      quietOvernight: true,
    }));
  });

  it("prefers the location's configured responders over the creator", async () => {
    mocks.db.systemConfig.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) => (
      where.key === "overdue_responders:cr" ? { value: { userIds: ["pat", "ghost"] } } : null
    ));

    await processCheckoutEscalationStage({
      bookingId: "co-1", expectedEndsAt: DUE, stageType: "checkout_overdue_4h", now: hoursAfterDue(4.1),
    });

    expect(created().filter((row) => row.kind !== "requester")).toEqual([
      { userId: "pat", type: "checkout_overdue_4h", kind: "responder" },
    ]);
  });

  it("falls back to admins when the creator is the holder", async () => {
    mocks.db.booking.findUnique.mockResolvedValue(checkout({ createdBy: "maya" }));

    await processCheckoutEscalationStage({
      bookingId: "co-1", expectedEndsAt: DUE, stageType: "checkout_overdue_4h", now: hoursAfterDue(4.1),
    });

    expect(created().filter((row) => row.kind !== "requester")).toEqual([
      { userId: "erik", type: "checkout_overdue_4h", kind: "responder" },
    ]);
  });

  it("never escalates a staff member's own overdue checkout back to them", async () => {
    mocks.db.booking.findUnique.mockResolvedValue(checkout({
      requesterUserId: "erik",
      createdBy: "erik",
      requester: { id: "erik", name: "Erik", email: "erik@example.com" },
    }));

    await processCheckoutEscalationStage({
      bookingId: "co-1", expectedEndsAt: DUE, stageType: "checkout_overdue_24h", now: hoursAfterDue(24.1),
    });

    const operational = created().filter((row) => row.kind !== "requester");
    expect(operational.map((row) => row.userId)).not.toContain("erik");
  });

  it("at a day overdue emails admins as well as the responder", async () => {
    await processCheckoutEscalationStage({
      bookingId: "co-1", expectedEndsAt: DUE, stageType: "checkout_overdue_24h", now: hoursAfterDue(24.1),
    });

    expect(created()).toEqual([
      { userId: "maya", type: "checkout_overdue_24h", kind: "requester" },
      { userId: "casey", type: "checkout_overdue_24h", kind: "responder" },
      { userId: "erik", type: "checkout_overdue_24h", kind: "admin" },
    ]);
    expect(mocks.email).toHaveBeenCalledWith("erik", expect.any(Object), "checkoutOverdue");
    expect(mocks.push).not.toHaveBeenCalledWith("erik", expect.anything());
  });

  it("does not message a holder for shared gear; staff follow up instead", async () => {
    mocks.db.booking.findUnique.mockResolvedValue(checkout({ custodyScope: "SHARED" }));

    await processCheckoutEscalationStage({
      bookingId: "co-1", expectedEndsAt: DUE, stageType: "checkout_overdue_4h", now: hoursAfterDue(4.1),
    });

    expect(created()).toEqual([{ userId: "casey", type: "checkout_overdue_4h", kind: "responder" }]);
    expect(mocks.db.notification.create.mock.calls[0]![0].data.payload.requesterName).toBe("Shared checkout");
  });

  it("is idempotent: a stage that already went out is not sent again", async () => {
    mocks.db.notification.findMany.mockResolvedValue([
      { dedupeKey: `co-1:${DUE.toISOString()}:checkout_due_2h:requester:maya`, payload: { dueVersion: DUE.toISOString(), recipientKind: "requester" } },
    ]);

    const result = await processCheckoutEscalationStage({
      bookingId: "co-1", expectedEndsAt: DUE, stageType: "checkout_due_2h", now: hoursAfterDue(-1.9),
    });

    expect(result).toEqual({ status: "deduped", notificationsCreated: 0 });
    expect(mocks.db.notification.create).not.toHaveBeenCalled();
  });

  it("treats a concurrent duplicate insert as already sent", async () => {
    mocks.db.notification.create.mockRejectedValue(Object.assign(new Error("Unique constraint"), { code: "P2002" }));

    const result = await processCheckoutEscalationStage({
      bookingId: "co-1", expectedEndsAt: DUE, stageType: "checkout_due_2h", now: hoursAfterDue(-1.9),
    });

    expect(result).toEqual({ status: "deduped", notificationsCreated: 0 });
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("stops at the per-due-date cap for the holder", async () => {
    mocks.db.systemConfig.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) => (
      where.key === "escalation" ? { value: { maxRequesterNotificationsPerDueDate: 1 } } : null
    ));
    mocks.db.notification.findMany.mockResolvedValue([
      { dedupeKey: "older", payload: { dueVersion: DUE.toISOString(), recipientKind: "requester" } },
    ]);

    await processCheckoutEscalationStage({
      bookingId: "co-1", expectedEndsAt: DUE, stageType: "checkout_due_now", now: hoursAfterDue(0.05),
    });

    expect(mocks.db.notification.create).not.toHaveBeenCalled();
  });

  it("starts a fresh count when the due time was extended", async () => {
    mocks.db.systemConfig.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) => (
      where.key === "escalation" ? { value: { maxRequesterNotificationsPerDueDate: 1 } } : null
    ));
    mocks.db.notification.findMany.mockResolvedValue([
      { dedupeKey: "older", payload: { dueVersion: "2026-10-23T22:00:00.000Z", recipientKind: "requester" } },
    ]);

    await processCheckoutEscalationStage({
      bookingId: "co-1", expectedEndsAt: DUE, stageType: "checkout_due_now", now: hoursAfterDue(0.05),
    });

    expect(mocks.db.notification.create).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["the checkout was returned", { status: "COMPLETED" }, "closed"],
    ["the booking is gone", null, "closed"],
  ])("sends nothing when %s", async (_label, over, status) => {
    mocks.db.booking.findUnique.mockResolvedValue(over === null ? null : checkout(over));

    const result = await processCheckoutEscalationStage({
      bookingId: "co-1", expectedEndsAt: DUE, stageType: "checkout_overdue_4h", now: hoursAfterDue(4.1),
    });

    expect(result).toEqual({ status, notificationsCreated: 0 });
    expect(mocks.db.notification.create).not.toHaveBeenCalled();
  });

  it("sends nothing for a due time that was since extended", async () => {
    const result = await processCheckoutEscalationStage({
      bookingId: "co-1", expectedEndsAt: hoursAfterDue(-24), stageType: "checkout_overdue_4h", now: hoursAfterDue(4.1),
    });

    expect(result).toEqual({ status: "superseded", notificationsCreated: 0 });
  });

  it("waits when the stage fires early", async () => {
    const result = await processCheckoutEscalationStage({
      bookingId: "co-1", expectedEndsAt: DUE, stageType: "checkout_overdue_4h", now: hoursAfterDue(3),
    });

    expect(result).toMatchObject({ status: "not_eligible", triggerAt: hoursAfterDue(4).toISOString() });
    expect(mocks.db.notification.create).not.toHaveBeenCalled();
  });

  it("collapses a late stage into the newest one so the holder gets one message, not a backlog", async () => {
    const result = await processCheckoutEscalationStage({
      bookingId: "co-1", expectedEndsAt: DUE, stageType: "checkout_due_2h", now: hoursAfterDue(4.1),
    });

    expect(result).toEqual({ status: "collapsed", collapsedInto: "checkout_overdue_4h", notificationsCreated: 0 });
  });

  it("honors a stage an admin turned off", async () => {
    mocks.db.escalationRule.findMany.mockResolvedValue([
      { hoursFromDue: -2, type: "checkout_due_2h", title: "Due back in 2 hours", notifyRequester: true, notifyAdmins: false, enabled: true, sortOrder: 0 },
    ]);

    const result = await processCheckoutEscalationStage({
      bookingId: "co-1", expectedEndsAt: DUE, stageType: "checkout_overdue_4h", now: hoursAfterDue(4.1),
    });

    expect(result).toEqual({ status: "disabled", notificationsCreated: 0 });
  });
});

describe("stage timing for the durable workflow", () => {
  it("schedules the grace stage after the grace period", async () => {
    const timing = await getCheckoutEscalationStageTiming({ bookingId: "co-1", expectedEndsAt: DUE, stageType: "checkout_overdue_grace" });

    expect(timing).toEqual({ status: "scheduled", triggerAt: hoursAfterDue(0.25).toISOString() });
  });

  it("stops the workflow once the checkout closes or its due time moves", async () => {
    mocks.db.booking.findUnique.mockResolvedValueOnce({ kind: "CHECKOUT", status: "COMPLETED", custodyScope: "PERSON", endsAt: DUE });
    await expect(getCheckoutEscalationStageTiming({ bookingId: "co-1", expectedEndsAt: DUE, stageType: "checkout_due_now" }))
      .resolves.toEqual({ status: "closed" });

    mocks.db.booking.findUnique.mockResolvedValueOnce({ kind: "CHECKOUT", status: "OPEN", custodyScope: "PERSON", endsAt: hoursAfterDue(2) });
    await expect(getCheckoutEscalationStageTiming({ bookingId: "co-1", expectedEndsAt: DUE, stageType: "checkout_due_now" }))
      .resolves.toEqual({ status: "superseded" });
  });
});

describe("daily overdue repair sweep", () => {
  it("sends each open checkout only its newest due stage and reports the backlog", async () => {
    const now = Date.now();
    mocks.db.booking.findMany.mockResolvedValue([
      checkout({ id: "late", endsAt: new Date(now - 5 * 3_600_000) }),
      checkout({ id: "later", endsAt: new Date(now + 10 * 3_600_000) }),
    ]);
    mocks.db.booking.count.mockResolvedValue(503);

    const result = await processOverdueNotifications();

    expect(result).toEqual({ scanned: 2, notificationsCreated: 2, remaining: 501, truncated: true });
    expect(created()).toEqual([
      { userId: "maya", type: "checkout_overdue_4h", kind: "requester" },
      { userId: "casey", type: "checkout_overdue_4h", kind: "responder" },
    ]);
  });

  it("does nothing when nothing is out", async () => {
    mocks.db.booking.findMany.mockResolvedValue([]);
    mocks.db.booking.count.mockResolvedValue(0);

    await expect(processOverdueNotifications()).resolves.toEqual({ scanned: 0, notificationsCreated: 0, remaining: 0, truncated: false });
    expect(mocks.db.notification.findMany).not.toHaveBeenCalled();
  });
});
