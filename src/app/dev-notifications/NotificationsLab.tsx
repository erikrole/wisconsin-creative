"use client";

import NotificationsPage from "@/app/(app)/notifications/page";
import LabShell, { type LabRoute } from "@/app/dev-lab/LabShell";

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const NOTIFICATIONS = [
  ["n1", "checkout_overdue", "FX6-A is overdue", "Maddy Pehler had it due back at 5:00 PM for Football vs. Iowa.", { bookingId: "bk-1" }, 12, false],
  ["n2", "trade_available", "Shift up for trade: Volleyball vs. Nebraska", "Jordan Ruiz posted a video shift for Thursday at 4:00 PM.", { shiftGroupId: "g-1" }, 95, false],
  ["n3", "reservation_confirmed", "Reservation confirmed: Hockey vs. Minnesota", "3 items are held for you Friday at 3:00 PM.", { bookingId: "bk-2", bookingKind: "RESERVATION" }, 240, false],
  ["n4", "shift_gear_up", "Gear up for Football vs. Iowa", "Your call is 9:00 AM Saturday at Camp Randall.", { shiftGroupId: "g-2" }, 60 * 26, true],
  ["n5", "badge_awarded", "You earned the Iron Man badge", "Ten shifts in a month.", null, 60 * 30, true],
  ["n6", "low_stock", "Low stock: AA batteries", "4 packs left in the equipment cage.", null, 60 * 72, true],
  ["n7", "trade_approved", "Trade approved", "Tess Olson is taking your Wrestling vs. Purdue shift.", { shiftGroupId: "g-3" }, 60 * 24 * 9, true],
].map(([id, type, title, body, payload, minutes, read]) => ({
  id, type, title, body, payload, channel: "IN_APP",
  readAt: read ? ago((minutes as number) - 5) : null,
  sentAt: ago(minutes as number),
  createdAt: ago(minutes as number),
}));

const route: LabRoute = (url) => {
  if (url.pathname === "/api/notifications") {
    const unreadOnly = url.searchParams.get("unread") === "true";
    const data = NOTIFICATIONS.filter((n) => !unreadOnly || !n.readAt);
    return { data, total: data.length, inboxTotal: NOTIFICATIONS.length, unreadCount: NOTIFICATIONS.filter((n) => !n.readAt).length };
  }
  return undefined;
};

export default function NotificationsLab({ fontClass }: { fontClass: string }) {
  return (
    <LabShell fontClass={fontClass} route={route}>
      <NotificationsPage />
    </LabShell>
  );
}
