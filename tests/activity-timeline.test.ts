import { describe, expect, it } from "vitest";
import {
  coalesceEntries,
  describeAction,
  entityHref,
  formatDuration,
  formatTimestamp,
  getChainedChange,
  getDateGroup,
  getFieldChanges,
  isPhantomEntry,
  type AuditEntry,
} from "@/lib/activity-timeline";
import { formatDateTime } from "@/lib/format";

let seq = 0;
function entry(action: string, overrides: Partial<AuditEntry> = {}): AuditEntry {
  seq += 1;
  return {
    id: `audit-${seq}`,
    action,
    entityType: "asset",
    entityId: "asset-1",
    createdAt: "2026-10-22T15:00:00.000Z",
    beforeJson: null,
    afterJson: null,
    actor: { id: "user-1", name: "Avery" },
    ...overrides,
  };
}

describe("entityHref", () => {
  it("links each audited entity to its detail page", () => {
    expect(entityHref("asset", "a1", null)).toBe("/items/a1");
    expect(entityHref("user", "u1", null)).toBe("/staff/u1");
    expect(entityHref("bulk_sku", "b1", null)).toBe("/bulk-inventory/b1");
    expect(entityHref("kit", "k1", null)).toBe("/kits/k1");
    expect(entityHref("license", "l1", null)).toBeNull();
    expect(entityHref(undefined, "x", null)).toBeNull();
  });

  it("sends a booking to its checkout or reservation page, from the join or the payload", () => {
    expect(entityHref("booking", "b1", null, "CHECKOUT")).toBe("/checkouts/b1");
    expect(entityHref("booking", "b1", { kind: "RESERVATION" })).toBe("/reservations/b1");
    expect(entityHref("booking", "b1", null)).toBe("/bookings?id=b1");
  });
});

describe("formatDuration", () => {
  it("rounds to the largest sensible unit", () => {
    expect(formatDuration(60_000)).toBe("1 minute");
    expect(formatDuration(20 * 60_000)).toBe("20 minutes");
    expect(formatDuration(3 * 3_600_000)).toBe("3 hours");
    expect(formatDuration(2 * 86_400_000)).toBe("2 days");
  });
});

describe("describeAction", () => {
  it("reads in the voice of each surface", () => {
    const created = entry("created");
    expect(describeAction(created, "Avery", "item")).toBe("Created this item");
    expect(describeAction(created, "Avery", "booking")).toBe("Created this booking");
    expect(describeAction(created, "Avery", "report", "CAM-001")).toBe("Avery created CAM-001");
    expect(describeAction({ ...created, afterJson: { name: "A7 IV" } }, "Avery", "user")).toBe('Created item "A7 IV"');
  });

  it("names the booking an item's history refers to", () => {
    const booking = { entityType: "booking", entityId: "b1", entity: { label: "Sony kit", kind: "CHECKOUT" } };
    expect(describeAction(entry("cancelled", booking), "Avery", "item")).toBe('Cancelled checkout "Sony kit"');
    expect(describeAction(entry("kiosk_pickup", booking), "Avery", "item")).toBe('Picked up checkout "Sony kit" at a kiosk');
    expect(describeAction(entry("cancelled", { ...booking, entity: null }), "Avery", "item")).toBe("Cancelled the booking");
  });

  it("says where and what a kiosk returned", () => {
    expect(describeAction(entry("kiosk_checkin", { afterJson: { itemNames: ["CAM-001", "LENS-2", "MIC-3", "TRI-4"], kioskName: "Camp Randall kiosk" } }), "Avery", "booking"))
      .toBe("Returned CAM-001, LENS-2, MIC-3, and 1 more at the Camp Randall kiosk");
    expect(describeAction(entry("kiosk_checkin", { afterJson: { itemNames: ["CAM-001", "LENS-2"] } }), "Avery", "booking"))
      .toBe("Returned CAM-001 and LENS-2 at a kiosk");
    expect(describeAction(entry("kiosk_checkout_item_removed", { beforeJson: { unitNumber: 4 } }), "Avery", "booking"))
      .toBe("Removed unit #4 at a kiosk");
  });

  it("dates an extension", () => {
    const extended = entry("extended", { afterJson: { endsAt: "2026-10-25T22:00:00.000Z" } });
    expect(describeAction(extended, "Avery", "booking")).toBe(`Extended the checkout to ${formatDateTime("2026-10-25T22:00:00.000Z")}`);
    expect(describeAction(entry("extended"), "Avery", "report")).toBe("Avery Extended the checkout");
  });

  it("counts equipment added and removed", () => {
    expect(describeAction(entry("booking.items_added", { afterJson: { serializedAssetIds: ["a"], bulkItems: [1, 2] } }), "Avery", "booking"))
      .toBe("Added 1 serialized item, 2 item families");
    expect(describeAction(entry("booking.items_removed", { beforeJson: { serializedAssetIds: ["a", "b"] } }), "Avery", "booking"))
      .toBe("Removed 2 serialized items");
    expect(describeAction(entry("booking.items_removed"), "Avery", "booking")).toBe("Removed items");
  });

  it("names the one profile field that changed", () => {
    expect(describeAction(entry("profile_updated", { afterJson: { shoeSize: "10", updatedAt: "x" } }), "Avery", "user")).toBe("Updated their shoe size");
    expect(describeAction(entry("profile_updated", { afterJson: { shoeSize: "10", topSize: "M" } }), "Avery", "user")).toBe("Updated their profile (2 fields)");
  });

  it("describes a role change with what it was and what it became", () => {
    expect(describeAction(entry("role_changed", { beforeJson: { role: "STUDENT" }, afterJson: { role: "STAFF" } }), "Avery", "user"))
      .toBe("Changed role from STUDENT to STAFF");
    expect(describeAction(entry("role_changed", { afterJson: { role: "STAFF" } }), "Avery", "user")).toBe("Changed role to STAFF");
  });

  it("falls back to a readable sentence for an action it has no wording for", () => {
    const unknown = entry("license.seat_released", { entityType: "license" });
    expect(describeAction(unknown, "Avery", "item")).toBe("License seat released");
    expect(describeAction(unknown, "Avery", "user")).toBe("License seat released on a license");
    expect(describeAction(unknown, "Avery", "report")).toBe("Avery performed license seat released");
  });
});

describe("getFieldChanges", () => {
  it("shows readable labels and values, and hides internal fields", () => {
    const changes = getFieldChanges(entry("updated", {
      beforeJson: { status: "BOOKED", name: "Old", updatedAt: "a", locationId: null },
      afterJson: { status: "OPEN", name: "New", updatedAt: "b", locationId: "loc-2" },
    }));

    expect(changes).toEqual([
      { label: "Status", from: "Reserved", to: "Checked out" },
      { label: "Item name", from: "Old", to: "New", mono: false },
      // Raw ids mean nothing to a reader.
      { label: "Location", from: "", to: "set" },
    ]);
  });

  it("calls a kit rename a name change, not an item name change", () => {
    const changes = getFieldChanges(entry("updated", {
      entityType: "kit",
      beforeJson: { name: "Old kit" },
      afterJson: { name: "New kit" },
    }));

    expect(changes).toEqual([{ label: "Name", from: "Old kit", to: "New kit", mono: false }]);
  });

  it("formats dates and booleans, and strips the protocol from links", () => {
    const changes = getFieldChanges(entry("update", {
      beforeJson: { endsAt: "2026-10-24T22:00:00.000Z", linkUrl: "https://www.sony.com/a7" },
      afterJson: { endsAt: "2026-10-25T22:00:00.000Z", linkUrl: "https://sony.com/a7iv", availableForCheckout: false },
    }));

    expect(changes).toEqual([
      { label: "End date", from: formatDateTime("2026-10-24T22:00:00.000Z"), to: formatDateTime("2026-10-25T22:00:00.000Z") },
      { label: "Link", from: "sony.com/a7", to: "sony.com/a7iv", mono: true },
      { label: "Checkout availability", from: "", to: "disabled" },
    ]);
  });

  it("drops unchanged values, structured values and import metadata", () => {
    expect(getFieldChanges(entry("updated", {
      beforeJson: { brand: "Sony", serializedAssetIds: ["a"], notes: '{"cheqroomName":"x"}' },
      afterJson: { brand: "Sony", serializedAssetIds: ["a", "b"], notes: "Cleaned" },
    }))).toEqual([]);
  });

  it("only diffs actions that are edits", () => {
    expect(getFieldChanges(entry("created", { afterJson: { name: "New" } }))).toEqual([]);
  });
});

describe("isPhantomEntry", () => {
  it("hides an edit whose only changes are internal", () => {
    expect(isPhantomEntry(entry("updated", { afterJson: { updatedAt: "x" } }))).toBe(true);
    expect(isPhantomEntry(entry("updated", { afterJson: { name: "New" } }))).toBe(false);
    expect(isPhantomEntry(entry("avatar_uploaded", { afterJson: { updatedAt: "x" } }))).toBe(false);
  });
});

describe("getDateGroup", () => {
  const today = new Date("2026-10-22T17:00:00.000Z");

  it("labels today and yesterday in Central time, then the full date", () => {
    expect(getDateGroup("2026-10-22T13:00:00.000Z", today)).toBe("Today");
    // 03:00 UTC on the 22nd is still the 21st in Madison.
    expect(getDateGroup("2026-10-22T03:00:00.000Z", today)).toBe("Yesterday");
    expect(getDateGroup("2026-10-18T15:00:00.000Z", today)).toBe("October 18, 2026");
  });
});

describe("coalesceEntries", () => {
  const actor = { id: "user-1", name: "Avery" };
  const at = (minute: number) => `2026-10-22T15:${String(minute).padStart(2, "0")}:00.000Z`;

  it("folds a slow run of the same edit into one row", () => {
    // Newest first, a minute apart: each fold is measured from the oldest so far.
    const rows = coalesceEntries([
      entry("updated", { actor, createdAt: at(3) }),
      entry("updated", { actor, createdAt: at(2) }),
      entry("updated", { actor, createdAt: at(1) }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ createdAt: at(3), _count: 3, _oldest: at(1) });
    expect(rows[0]?._chain?.map((row) => row.createdAt)).toEqual([at(3), at(2), at(1)]);
    expect(formatTimestamp(rows[0]!)).toBe("10:01 AM–10:03 AM");
  });

  it("keeps different people, actions, entities and gaps apart", () => {
    const rows = coalesceEntries([
      entry("updated", { actor, createdAt: at(10) }),
      entry("updated", { actor: { id: "user-2", name: "Rowan" }, createdAt: at(10) }),
      entry("retired", { actor, createdAt: at(10) }),
      entry("retired", { actor, entityId: "asset-2", createdAt: at(10) }),
      entry("retired", { actor, entityId: "asset-2", createdAt: at(8) }),
    ]);

    expect(rows.map((row) => row._count)).toEqual([1, 1, 1, 1, 1]);
    expect(formatTimestamp(rows[0]!)).toBe("10:10 AM");
  });
});

describe("getChainedChange", () => {
  const actor = { id: "user-1", name: "Avery" };
  const ends = ["2026-05-04T21:00:00.000Z", "2026-05-08T21:00:00.000Z", "2026-05-27T21:00:00.000Z"];

  function extensions(values = ends) {
    // Newest first, as the feed delivers them.
    return coalesceEntries(values.slice(1).map((value, index) => entry("extended", {
      actor,
      entityType: "booking",
      entityId: "b1",
      createdAt: `2026-10-22T15:0${values.length - index}:00.000Z`,
      beforeJson: { endsAt: values[index] },
      afterJson: { endsAt: value },
    })).reverse())[0]!;
  }

  it("shows the path a repeatedly moved date took, and the net change", () => {
    expect(getChainedChange(extensions())).toEqual({
      label: "End date",
      values: ends.map((value) => formatDateTime(value)),
      delta: "+23 days",
      mono: false,
    });
  });

  it("leaves a single before and after to the ordinary pill", () => {
    expect(getChainedChange(extensions(ends.slice(0, 2)))).toBeNull();
  });

  it("does not chain edits that touched different fields", () => {
    const row = coalesceEntries([
      entry("updated", { actor, createdAt: "2026-10-22T15:02:00.000Z", afterJson: { name: "B" } }),
      entry("updated", { actor, createdAt: "2026-10-22T15:01:00.000Z", afterJson: { brand: "Sony" } }),
    ])[0]!;
    expect(getChainedChange(row)).toBeNull();
  });
});
