import { afterEach, describe, expect, it, vi } from "vitest";
import { formatNotificationTime, notificationMeta } from "@/lib/notification-meta";

describe("notificationMeta", () => {
  it.each([
    ["checkout_due_soon", "Overdue", "orange"],
    ["checkout_overdue_2h", "Overdue", "orange"],
    ["overdue_nudge", "Overdue", "orange"],
    ["shift_gear_up", "Shift", "green"],
    ["trade_available", "Trade", "blue"],
    ["trade_completed", "Trade", "blue"],
    ["trade_declined", "Trade", "red"],
    ["trade_expired", "Trade", "red"],
    ["badge_awarded", "Recognition", "purple"],
    ["calendar_sync_failure", "Calendar", "red"],
    ["firmware_update_released", "Inventory", "orange"],
    ["low_stock", "Inventory", "orange"],
    ["reservation_reminder", "Reservation", "purple"],
    ["shift_assigned", "Schedule", "blue"],
    ["time_off_approved", "Schedule", "blue"],
    ["license_expiring", "License", "orange"],
  ])("labels %s as %s", (type, label, tone) => {
    const meta = notificationMeta(type);

    expect(meta.label).toBe(label);
    expect(meta.toneClass).toContain(`--${tone}-bg`);
  });

  it("falls back to a neutral notice", () => {
    expect(notificationMeta("something_new")).toEqual(expect.objectContaining({ label: "Notice", toneClass: "bg-muted text-muted-foreground" }));
  });
});

describe("formatNotificationTime", () => {
  const now = new Date("2026-10-25T18:00:00.000Z");

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    [30_000, "just now"],
    [5 * 60_000, "5m ago"],
    [59 * 60_000, "59m ago"],
    [60 * 60_000, "1h ago"],
    [3 * 3_600_000, "3h ago"],
    [2 * 86_400_000, "2d ago"],
    [6 * 86_400_000 + 23 * 3_600_000, "6d ago"],
  ])("shows %i ms ago as %s", (ago, label) => {
    vi.useFakeTimers({ now });

    expect(formatNotificationTime(new Date(now.getTime() - ago).toISOString())).toBe(label);
  });

  it("shows a date from a week on", () => {
    vi.useFakeTimers({ now });
    const old = new Date(now.getTime() - 7 * 86_400_000);

    expect(formatNotificationTime(old.toISOString())).toBe(old.toLocaleDateString());
  });
});
