import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    blast: { create: vi.fn() },
    blastRecipient: { createMany: vi.fn() },
    notification: { createMany: vi.fn() },
    $executeRaw: vi.fn(),
  };
  return {
    tx,
    db: {
      blast: { findUnique: vi.fn(), update: vi.fn() },
      blastRecipient: { findMany: vi.fn(), updateMany: vi.fn() },
      deviceToken: { findMany: vi.fn(), updateMany: vi.fn() },
      $transaction: vi.fn(async (run: (client: typeof tx) => unknown) => run(tx)),
    },
    targets: vi.fn(),
    deferPush: vi.fn(),
    sendPush: vi.fn(),
    sendWebPush: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/push/apns", () => ({ sendPush: mocks.sendPush }));
vi.mock("@/lib/push/web", () => ({ sendWebPushToUsers: mocks.sendWebPush }));
vi.mock("@/lib/services/notifications", () => ({ deferPush: mocks.deferPush }));
vi.mock("@/lib/services/blast-targeting", () => ({ MAX_BLAST_RECIPIENTS: 3, resolveBlastTargets: mocks.targets }));

import { cancelBlast, createAndSendBlast, listActiveBlastsForUser, sendBlastPush } from "@/lib/services/blasts";

const input = {
  title: "Lot closed",
  body: "Park at Lot 60 tonight",
  severity: "URGENT" as const,
  requiresAck: true,
  expiresAt: null,
  spec: { kind: "EVENT_CREW", eventId: "game" },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.targets.mockResolvedValue({ userIds: ["ada", "grace"], summary: "Football vs Iowa crew", eventId: "game" });
  mocks.tx.blast.create.mockResolvedValue({ id: "blast-1" });
  mocks.db.blast.update.mockResolvedValue({});
  mocks.db.blastRecipient.findMany.mockResolvedValue([]);
  mocks.sendWebPush.mockResolvedValue(new Map());
});

describe("createAndSendBlast", () => {
  it("freezes the recipients, writes inbox copies, marks it sent and queues the push", async () => {
    const result = await createAndSendBlast(input as never, { id: "staff-1", role: "STAFF" });

    expect(result).toEqual({ id: "blast-1", recipientCount: 2, targetSummary: "Football vs Iowa crew", sentAt: expect.any(Date) });
    expect(mocks.tx.blast.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "SENDING", targetKind: "EVENT_CREW", eventId: "game", recipientCount: 2, createdById: "staff-1" }),
    }));
    expect(mocks.tx.blastRecipient.createMany).toHaveBeenCalledWith({
      data: [{ blastId: "blast-1", userId: "ada" }, { blastId: "blast-1", userId: "grace" }],
      skipDuplicates: true,
    });
    expect(mocks.tx.notification.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
    const copies = mocks.tx.notification.createMany.mock.calls[0]?.[0].data as Array<Record<string, unknown>>;
    expect(copies.map((copy) => copy.dedupeKey)).toEqual(["blast:blast-1:ada", "blast:blast-1:grace"]);
    expect(copies[0]).toEqual(expect.objectContaining({ type: "blast", title: "Lot closed", channel: "IN_APP" }));
    expect(mocks.tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(mocks.db.blast.update).toHaveBeenCalledWith({ where: { id: "blast-1" }, data: { status: "SENT", sentAt: result.sentAt } });
    expect(mocks.deferPush).toHaveBeenCalledTimes(1);
  });

  it("refuses a target that reaches nobody or too many people", async () => {
    mocks.targets.mockResolvedValueOnce({ userIds: [], summary: "", eventId: null });
    await expect(createAndSendBlast(input as never, { id: "staff-1", role: "STAFF" })).rejects.toMatchObject({ status: 400, message: "That target matches nobody right now." });

    mocks.targets.mockResolvedValueOnce({ userIds: ["a", "b", "c", "d"], summary: "", eventId: null });
    await expect(createAndSendBlast(input as never, { id: "staff-1", role: "STAFF" })).rejects.toMatchObject({ message: "That target reaches more than 3 people. Narrow it first." });

    expect(mocks.tx.blast.create).not.toHaveBeenCalled();
  });
});

describe("sendBlastPush through the browser", () => {
  it("counts a browser delivery as sent and a dead browser subscription as failed", async () => {
    mocks.db.blast.findUnique.mockResolvedValue({ title: "Lot closed", body: "Park at Lot 60", status: "SENT" });
    mocks.db.blastRecipient.findMany.mockResolvedValue([
      { userId: "ada", user: { notificationPrefs: null } },
      { userId: "grace", user: { notificationPrefs: null } },
    ]);
    mocks.db.deviceToken.findMany.mockResolvedValue([]);
    mocks.sendWebPush.mockResolvedValue(new Map([
      ["ada", { devices: 1, delivered: 1 }],
      ["grace", { devices: 1, delivered: 0 }],
    ]));

    await sendBlastPush("blast-1");

    expect(mocks.sendPush).not.toHaveBeenCalled();
    expect(mocks.db.blastRecipient.updateMany).toHaveBeenCalledWith({ where: { blastId: "blast-1", userId: { in: ["ada"] } }, data: expect.objectContaining({ pushStatus: "SENT" }) });
    expect(mocks.db.blastRecipient.updateMany).toHaveBeenCalledWith({ where: { blastId: "blast-1", userId: { in: ["grace"] } }, data: expect.objectContaining({ pushStatus: "FAILED" }) });
  });

  it("stops after marking inactive people when nobody active remains", async () => {
    mocks.db.blast.findUnique.mockResolvedValue({ title: "t", body: "b", status: "SENT" });

    await sendBlastPush("blast-1");

    expect(mocks.db.blastRecipient.updateMany).toHaveBeenCalledTimes(1);
    expect(mocks.sendWebPush).not.toHaveBeenCalled();
  });
});

describe("cancelBlast", () => {
  it("cancels once and ignores a repeat", async () => {
    mocks.db.blast.findUnique.mockResolvedValueOnce({ id: "blast-1", cancelledAt: null });
    await cancelBlast("blast-1", { id: "staff-1" });
    expect(mocks.db.blast.update).toHaveBeenCalledWith({
      where: { id: "blast-1" },
      data: { status: "CANCELLED", cancelledAt: expect.any(Date), cancelledById: "staff-1" },
    });

    mocks.db.blast.update.mockClear();
    mocks.db.blast.findUnique.mockResolvedValueOnce({ id: "blast-1", cancelledAt: new Date() });
    await cancelBlast("blast-1", { id: "staff-1" });
    expect(mocks.db.blast.update).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown blast", async () => {
    mocks.db.blast.findUnique.mockResolvedValue(null);

    await expect(cancelBlast("nope", { id: "staff-1" })).rejects.toMatchObject({ status: 404 });
  });
});

describe("listActiveBlastsForUser", () => {
  it("lists live, unacknowledged blasts with the sender's name", async () => {
    const now = new Date("2026-10-25T18:00:00.000Z");
    const sentAt = new Date("2026-10-25T17:00:00.000Z");
    mocks.db.blastRecipient.findMany.mockResolvedValue([
      { readAt: null, blast: { id: "blast-1", title: "Lot closed", body: "b", severity: "URGENT", sentAt, requiresAck: true, createdBy: { name: "Erik" } } },
      { readAt: sentAt, blast: { id: "blast-2", title: "FYI", body: "b", severity: "INFO", sentAt, requiresAck: false, createdBy: null } },
    ]);

    const rows = await listActiveBlastsForUser("ada", now);

    expect(mocks.db.blastRecipient.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        userId: "ada",
        acknowledgedAt: null,
        blast: { status: "SENT", cancelledAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      },
      take: 5,
    }));
    expect(rows.map((row) => [row.id, row.senderName, row.readAt])).toEqual([
      ["blast-1", "Erik", null],
      ["blast-2", null, sentAt],
    ]);
  });
});
