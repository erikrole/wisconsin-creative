import { describe, expect, it } from "vitest";
import {
  notificationDestinationPath,
  notificationOpenPath,
  withNotificationHref,
} from "@/lib/notification-destination";

describe("notificationDestinationPath", () => {
  it("prefers an explicit same-origin href", () => {
    expect(
      notificationDestinationPath({ href: "/events/evt_1", bookingId: "bk_1" }),
    ).toBe("/events/evt_1");
  });

  it("rejects protocol-relative and off-origin hrefs", () => {
    expect(notificationDestinationPath({ href: "//evil.example/phish" })).toBeNull();
    expect(notificationDestinationPath({ url: "https://evil.example/phish" })).toBeNull();
  });

  it("routes booking identities to the matching web detail", () => {
    expect(notificationDestinationPath({ bookingId: "bk_1" }, "checkout_due_now"))
      .toBe("/checkouts/bk_1");
    expect(notificationDestinationPath({ checkoutId: "bk_2" })).toBe("/checkouts/bk_2");
    expect(notificationDestinationPath({ bookingId: "bk_3" }, "reservation_booked"))
      .toBe("/reservations/bk_3");
  });

  it("routes schedule, item, badge, license, and blast families", () => {
    expect(notificationDestinationPath({ eventId: "evt_1" }, "shift_assigned"))
      .toBe("/events/evt_1");
    expect(notificationDestinationPath({ assetId: "ast_1" }, "checkin_item_damaged"))
      .toBe("/items/ast_1");
    expect(notificationDestinationPath({ userId: "usr_1" }, "badge_awarded"))
      .toBe("/users/usr_1?tab=badges");
    expect(notificationDestinationPath({ type: "license_expiry" })).toBe("/licenses");
    expect(notificationDestinationPath({ skuName: "Sony Battery" }, "low_stock"))
      .toBe("/items?search=Sony%20Battery");
    expect(notificationDestinationPath({ blastId: "bl_1" })).toBe("/");
  });

  it("does not treat a recipient userId as a destination", () => {
    expect(notificationDestinationPath({ userId: "usr_1" }, "shift_assigned")).toBeNull();
  });

  it("falls back to the inbox for unknown families", () => {
    expect(notificationOpenPath({})).toBe("/notifications");
    expect(notificationOpenPath(null)).toBe("/notifications");
  });

  it("fills href onto payloads that only have identity keys", () => {
    expect(withNotificationHref({ bookingId: "bk_1" })).toEqual({
      bookingId: "bk_1",
      href: "/checkouts/bk_1",
    });
    expect(withNotificationHref({ href: "/events/evt_1", eventId: "evt_1" })).toEqual({
      href: "/events/evt_1",
      eventId: "evt_1",
    });
    expect(withNotificationHref({ blastId: "bl_1" })).toEqual({
      blastId: "bl_1",
      href: "/",
    });
  });
});
