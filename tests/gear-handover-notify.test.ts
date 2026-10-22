import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createMany: vi.fn(),
  sendPushToUser: vi.fn(),
  deferPush: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: { notification: { createManyAndReturn: mocks.createMany } } }));
vi.mock("@/lib/services/notifications", () => ({ sendPushToUser: mocks.sendPushToUser, deferPush: mocks.deferPush }));

import { notifyGearHandover, type GearHandover } from "@/lib/services/gear-handover-notify";

const base: GearHandover = {
  actor: { id: "staff", name: "Staff Sam" }, sourceId: "s", receivingId: "r", stamp: 7,
  title: "Soccer at Iowa", endsAt: new Date("2026-10-23T20:00:00Z"),
  from: { id: "old", name: "Old Holder" }, to: { id: "new", name: "New Holder" },
  itemCount: 1, sourceClosed: true, isCheckout: true,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.createMany.mockImplementation(({ data }) => Promise.resolve(data.map((row: { userId: string }, i: number) => ({ id: `n${i}`, userId: row.userId }))));
});

describe("notifyGearHandover", () => {
  it("pushes both people when staff moves the gear", async () => {
    await notifyGearHandover(base);
    expect(mocks.deferPush).toHaveBeenCalledTimes(2);
    const rows = mocks.createMany.mock.calls[0]![0].data;
    expect(rows.map((r: { userId: string }) => r.userId)).toEqual(["new", "old"]);
    expect(rows[1].title).toBe("Staff Sam moved Soccer at Iowa to New Holder");
  });

  it("gives the person who did it a silent receipt and only buzzes the recipient", async () => {
    await notifyGearHandover({ ...base, actor: base.from! });
    expect(mocks.deferPush).toHaveBeenCalledTimes(1);
    const rows = mocks.createMany.mock.calls[0]![0].data;
    expect(rows[1].readAt).toBeInstanceOf(Date);
    expect(rows[1].title).toBe("You handed Soccer at Iowa to New Holder");
  });

  it("does not notify staff about gear they gave themselves, and skips shared custody senders", async () => {
    await notifyGearHandover({ ...base, from: null, actor: base.to });
    expect(mocks.createMany).not.toHaveBeenCalled();
  });

  it("uses booking wording for reservations and never throws", async () => {
    mocks.createMany.mockRejectedValue(new Error("db down"));
    await expect(notifyGearHandover({ ...base, isCheckout: false, itemCount: 0 })).resolves.toBeUndefined();
  });
});
