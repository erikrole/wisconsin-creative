import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = vi.hoisted(() => ({
  booking: { findUnique: vi.fn(), update: vi.fn() },
  systemConfig: { findUnique: vi.fn() },
  auditLog: { create: vi.fn() },
}));

vi.mock("@/lib/db", () => ({
  db: {
    ...tx,
    user: { findMany: vi.fn().mockResolvedValue([{ id: "u1", name: "Maddy Pehler" }]) },
    $transaction: vi.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
  },
}));

import { checklistFromMarkdown, groupChecklist, parseChecklistChecks, parseChecklistItems } from "@/lib/shared-case-checklist";
import { loadTripChecklist, setTripCheck } from "@/lib/services/shared-case-checklist";

const list = { items: [
  { id: "a", label: "XLR cables", section: "Audio" },
  { id: "b", label: "Towels", section: null },
] };

describe("shared case checklist parsing", () => {
  it("reads items and ticks defensively", () => {
    expect(parseChecklistItems({ items: [...list.items, { id: 1 }, { id: "c", label: " " }] })).toHaveLength(2);
    expect(parseChecklistItems(null)).toEqual([]);
    expect(parseChecklistChecks({ a: { at: "x", by: "u" }, b: { at: 1 } })).toEqual({ a: { at: "x", by: "u" } });
  });

  it("groups consecutive items by section", () => {
    expect(groupChecklist(parseChecklistItems(list)).map((g) => g.section)).toEqual(["Audio", null]);
  });

  it("brings list items over from a guide's markdown with their headings", () => {
    const md = "# Football Travel Case\nIntro\n## Audio\n- [ ] **XLR** cables\n* [Towels](https://x)\n```\n- not this\n```\n1. Sensor kit";
    expect(checklistFromMarkdown(md)).toEqual([
      { label: "XLR cables", section: "Audio" },
      { label: "Towels", section: "Audio" },
      { label: "Sensor kit", section: "Audio" },
    ]);
  });
});

describe("trip checklist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tx.systemConfig.findUnique.mockResolvedValue({ value: list });
  });

  it("is only on shared case bookings", async () => {
    tx.booking.findUnique.mockResolvedValue({ id: "c1", custodyScope: "PERSON", sourceReservationId: null, packingChecks: null });
    expect(await loadTripChecklist("c1")).toBeNull();
  });

  it("reads and writes ticks on the reservation a checkout came from", async () => {
    tx.booking.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
      where.id === "c1"
        ? { id: "c1", custodyScope: "SHARED", sourceReservationId: "r1", packingChecks: null }
        : { id: "r1", packingChecks: { b: { at: "2026-11-01T20:00:00Z", by: "u1" }, gone: { at: "x", by: "u1" } } });

    const loaded = await loadTripChecklist("c1");
    expect(loaded).toMatchObject({ tripId: "r1", total: 2, checked: 1, names: { u1: "Maddy Pehler" } });

    await setTripCheck("c1", { itemId: "a", checked: true }, { id: "u1", role: "STUDENT" });
    const update = tx.booking.update.mock.calls[0]?.[0];
    expect(update.where).toEqual({ id: "r1" });
    expect(Object.keys(update.data.packingChecks).sort()).toEqual(["a", "b", "gone"]);
    expect(tx.auditLog.create.mock.calls[0]?.[0].data.action).toBe("packing_item_checked");
  });

  it("refuses items no longer on the list", async () => {
    tx.booking.findUnique.mockResolvedValue({ id: "c1", custodyScope: "SHARED", sourceReservationId: null, packingChecks: null });
    await expect(setTripCheck("c1", { itemId: "zzz", checked: true }, { id: "u1", role: "STUDENT" })).rejects.toThrow("no longer on the checklist");
  });
});
