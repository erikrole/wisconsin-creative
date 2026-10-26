import { describe, expect, it } from "vitest";
import { describeAction, type AuditEntry } from "@/lib/activity-timeline";
import { formatDateTime } from "@/lib/format";

function entry(action: string, overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: `audit-${action}`,
    action,
    entityType: "asset",
    entityId: "asset-1234567890",
    createdAt: "2026-10-22T15:00:00.000Z",
    beforeJson: null,
    afterJson: null,
    actor: { id: "user-1", name: "Avery" },
    ...overrides,
  };
}

describe("describeAction fixed wording", () => {
  it.each([
    ["events_updated", "Updated linked events"],
    ["deleted", "Deleted this item"],
    ["retired", "Retired this item"],
    ["checkin_completed", "Completed check-in"],
    ["checkin_items", "Checked in items"],
    ["checkout_completed", "Completed checkout"],
    ["scan_completed", "Completed scan"],
    ["cancelled_by_checkout_conversion", "Converted reservation to checkout"],
    ["items_returned", "All items returned"],
    ["items_returned_partial", "Some items returned"],
    ["partial_checkin", "Recorded partial return"],
    ["auto_completed_by_partial_checkin", "Auto-completed after partial check-in"],
    ["auto_completed_by_kiosk_checkin", "Booking completed by the kiosk return"],
    ["auto_completed_by_bulk_checkin", "Booking completed by the bulk return"],
    ["marked_maintenance", "Marked as needs maintenance"],
    ["cleared_maintenance", "Cleared maintenance status"],
    ["duplicated", "Duplicated this item"],
    ["qr_generated", "Generated new QR code"],
    ["admin_override", "Admin override"],
    ["auto_escalation", "System auto-escalated overdue notification"],
    ["cron_notification", "System sent scheduled notification"],
    ["auto_complete", "System auto-completed"],
    ["booking.items_qty_changed", "Changed item quantities"],
    ["edit", "Updated details"],
    ["bulk_move_location", "Moved location"],
    ["image_uploaded", "Uploaded a photo"],
    ["image_deleted", "Removed a photo"],
    ["escalation_config_updated", "Updated escalation settings"],
    ["escalation_rule_updated", "Updated an escalation rule"],
    ["avatar_uploaded", "Updated their profile photo"],
    ["avatar_deleted", "Removed their profile photo"],
    ["avatar_updated", "Updated their profile photo"],
    ["avatar_removed", "Removed their profile photo"],
    ["draft_discarded", "Discarded a draft booking"],
    ["password_reset_requested", "Requested a password reset"],
    ["password_reset_completed", "Reset their password"],
    ["password_reset_self", "Reset their password"],
    ["user_deactivated", "Deactivated a user account"],
    ["user_activated", "Activated a user account"],
    ["login", "Signed in"],
    ["logout", "Signed out"],
    ["registered", "Created an account"],
    ["kiosk_activated", "Kiosk device activated"],
    ["asset_created", "Created this item"],
    ["bulk_sku_image_set", "Set the photo"],
    ["asset_image_uploaded", "Uploaded a photo"],
    ["bulk_sku_image_removed", "Removed the photo"],
    ["favorite_added", "Added to favorites"],
    ["favorite_removed", "Removed from favorites"],
    ["retire", "Retired this item"],
    ["reactivated", "Reactivated this item"],
    ["duplicate", "Duplicated this item"],
    ["csv_import", "Imported via CSV"],
    ["convert_to_numbered", "Converted to numbered units"],
    ["adjust", "Adjusted stock quantity"],
    ["add_units", "Added units"],
    ["mark_labels_printed", "Marked labels as printed"],
    ["bulk_units_auto_lost", "System marked overdue units as lost"],
    ["repair_stale_checked_out", "Repaired stale checked-out units"],
    ["kiosk_checkout", "Checked out gear at a kiosk"],
    ["kiosk_checkout_updated", "Updated the checkout at a kiosk"],
    ["partial_bulk_checkin", "Recorded partial return"],
    ["pending_pickup_expired", "Pickup window expired"],
    ["fulfilled_by_kiosk_pickup", "Fulfilled by kiosk pickup"],
    ["partially_fulfilled_by_kiosk_pickup", "Recorded partial kiosk pickup"],
    ["admin_force_completed_checkout", "Closed the checkout without a scan"],
    ["admin_force_checkout", "Force-checked out the reservation without a kiosk scan"],
    ["reservation_closed_remaining_released", "Closed the reservation and released the gear that was never picked up"],
    ["completed_after_plan_edit", "Completed the reservation after the remaining gear was removed"],
    ["booking.item_substituted", "Swapped a reserved item for the one scanned at pickup"],
    ["overdue_nudge_sent", "Sent a reminder"],
  ])("labels %s on an item page", (action, label) => {
    expect(describeAction(entry(action), "Avery", "item")).toBe(label);
  });

  it("names the target by type and short id in the report view", () => {
    expect(describeAction(entry("updated", { entityType: "kit", entityId: "kit-abcdefghijk" }), "Avery", "report"))
      .toBe("Avery updated kit kit-abcd");
    expect(describeAction(entry("updated", { entityType: undefined }), "Avery", "report")).toBe("Avery updated this resource");
  });

  it("keeps system and device rows free of an actor", () => {
    expect(describeAction(entry("auto_escalation"), "Avery", "report")).toBe("System auto-escalated overdue notification");
    expect(describeAction(entry("pending_pickup_expired"), "Avery", "report")).toBe("Pickup window expired");
    expect(describeAction(entry("kiosk_activated"), "Avery", "report")).toBe("Kiosk device activated");
  });
});

describe("describeAction wording built from the entry", () => {
  it("names the new owner on a transfer", () => {
    expect(describeAction(entry("owner_transferred", { afterJson: { requesterName: "Jordan" } }), "Avery", "booking"))
      .toBe("Transferred ownership to Jordan");
    expect(describeAction(entry("owner_transferred"), "Avery", "booking")).toBe("Transferred ownership");
  });

  it("names the new end time on an extension", () => {
    const endsAt = "2026-10-25T23:00:00.000Z";
    expect(describeAction(entry("extended", { afterJson: { endsAt } }), "Avery", "booking"))
      .toBe(`Extended the checkout to ${formatDateTime(endsAt)}`);
    expect(describeAction(entry("extend", {
      entityType: "booking",
      entity: { label: "Sony kit", kind: "RESERVATION" },
    }), "Avery", "item")).toBe('Extended reservation "Sony kit"');
  });

  it("counts gear added to or removed from a booking", () => {
    expect(describeAction(entry("booking.items_added", { afterJson: { serializedAssetIds: ["a"], bulkItems: [{}, {}] } }), "Avery", "booking"))
      .toBe("Added 1 serialized item, 2 item families");
    expect(describeAction(entry("booking.items_removed", { beforeJson: { serializedAssetIds: ["a", "b"], bulkItems: [{}] } }), "Avery", "booking"))
      .toBe("Removed 2 serialized items, 1 item family");
    expect(describeAction(entry("booking.items_added", { afterJson: {} }), "Avery", "booking")).toBe("Added items");
    expect(describeAction(entry("booking.items_removed"), "Avery", "booking")).toBe("Removed items");
  });

  it("names attachments moved between items", () => {
    expect(describeAction(entry("accessory_attached", { afterJson: { name: "Battery grip" } }), "Avery", "item")).toBe('Attached item "Battery grip"');
    expect(describeAction(entry("accessory_attached"), "Avery", "item")).toBe("Attached an item");
    expect(describeAction(entry("accessory_detached", { beforeJson: { accessoryName: "Cage" } }), "Avery", "item")).toBe('Detached item "Cage"');
    expect(describeAction(entry("accessory_detached"), "Avery", "item")).toBe("Detached an item");
    expect(describeAction(entry("accessory_moved", { afterJson: { name: "Cage" } }), "Avery", "item")).toBe('Moved attachment "Cage" to another item');
    expect(describeAction(entry("accessory_moved"), "Avery", "item")).toBe("Moved an attachment to another item");
  });

  it("names a single profile field and counts several, ignoring hidden fields", () => {
    expect(describeAction(entry("profile_updated", { afterJson: { phone: "555", _actorRole: "STUDENT" } }), "Avery", "user"))
      .toBe("Updated their phone");
    expect(describeAction(entry("profile_update", { afterJson: { phone: "555", shoeSize: "10" } }), "Avery", "user"))
      .toBe("Updated their profile (2 fields)");
    expect(describeAction(entry("profile_updated", { afterJson: { _actorRole: "STUDENT" } }), "Avery", "user"))
      .toBe("Updated their profile");
  });

  it("describes a role change with whatever sides were recorded", () => {
    expect(describeAction(entry("role_changed", { beforeJson: { role: "STUDENT" }, afterJson: { role: "STAFF" } }), "Avery", "user"))
      .toBe("Changed role from STUDENT to STAFF");
    expect(describeAction(entry("role_changed", { afterJson: { role: "ADMIN" } }), "Avery", "user")).toBe("Changed role to ADMIN");
    expect(describeAction(entry("role_changed"), "Avery", "user")).toBe("Changed a user's role");
  });

  it("names the item and kiosk for kiosk line edits", () => {
    expect(describeAction(entry("kiosk_checkout_item_added", { afterJson: { itemName: " ROAM2 ", kioskName: "Field House kiosk" } }), "Avery", "booking"))
      .toBe("Added ROAM2 at the Field House kiosk");
    expect(describeAction(entry("kiosk_checkout_item_added", { afterJson: { tagName: "SLOW1" } }), "Avery", "booking"))
      .toBe("Added SLOW1 at a kiosk");
    expect(describeAction(entry("kiosk_checkout_item_removed", { beforeJson: { unitNumber: 4 } }), "Avery", "booking"))
      .toBe("Removed unit #4 at a kiosk");
    expect(describeAction(entry("kiosk_checkout_item_removed", { beforeJson: { itemName: "  " } }), "Avery", "booking"))
      .toBe("Removed an item at a kiosk");
  });

  it("lists returned items naturally", () => {
    const returned = (itemNames: unknown[]) => describeAction(entry("kiosk_checkin", { afterJson: { itemNames } }), "Avery", "booking");
    expect(returned(["CAM-001"])).toBe("Returned CAM-001 at a kiosk");
    expect(returned(["CAM-001", "LENS-2"])).toBe("Returned CAM-001 and LENS-2 at a kiosk");
    expect(returned(["CAM-001", "LENS-2", "MIC-3"])).toBe("Returned CAM-001, LENS-2, and MIC-3 at a kiosk");
    expect(returned(["", 7])).toBe("Returned gear at a kiosk");
  });

  it("calls an edit on a booking row an updated booking", () => {
    expect(describeAction(entry("edit", { entityType: "booking" }), "Avery", "item")).toBe("Updated booking");
  });
});

describe("describeAction on a person's activity", () => {
  it.each([
    [{ entityType: "user" }, "Updated their profile"],
    [{ entityType: "booking", afterJson: { title: "Media day" } }, 'Updated booking "Media day"'],
    [{ entityType: "booking", beforeJson: { title: "Old title" } }, 'Updated booking "Old title"'],
    [{ entityType: "booking" }, "Updated a booking"],
    [{ entityType: "asset" }, "Updated an item"],
    [{ entityType: "kit", afterJson: { name: "Sony kit" } }, 'Updated kit "Sony kit"'],
    [{ entityType: "kit" }, "Updated a kit"],
    [{ entityType: "license" }, "Updated a license"],
    [{ entityType: "bulk_sku" }, "Updated a bulk sku"],
    [{ entityType: undefined }, "Updated this resource"],
  ])("names the target of %j", (overrides, label) => {
    expect(describeAction(entry("updated", overrides as Partial<AuditEntry>), "Avery", "user")).toBe(label);
  });

  it("cancels and humanizes unknown actions against the target", () => {
    expect(describeAction(entry("cancelled", { entityType: "booking", afterJson: { title: "Media day" } }), "Avery", "user"))
      .toBe('Cancelled booking "Media day"');
    expect(describeAction(entry("label.reprinted", { entityType: "kit" }), "Avery", "user")).toBe("Label reprinted on a kit");
    expect(describeAction(entry("label.reprinted"), "Avery", "report")).toBe("Avery performed label reprinted");
    expect(describeAction(entry("label.reprinted"), "Avery", "item")).toBe("Label reprinted");
  });
});
