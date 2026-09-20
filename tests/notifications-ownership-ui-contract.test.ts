import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("Notifications ownership UI contracts", () => {
  it("falls back to createdAt for legacy rows without sentAt", () => {
    const page = source("src/app/(app)/notifications/page.tsx");
    const bookingNudge = source("src/app/api/bookings/[id]/nudge/route.ts");

    expect(page).toContain("notification.sentAt ?? notification.createdAt");
    expect(bookingNudge).toContain("sentAt: new Date()");
  });

  it("keeps unread-only optimistic mutations visually honest", () => {
    const page = source("src/app/(app)/notifications/page.tsx");

    expect(page).toContain("unreadOnly ? 0 : prev.total");
    expect(page).toContain(".filter((n) => n.id !== id)");
    expect(page).toContain("page >= totalPages");
  });

  it("synchronizes read mutations with the app-shell unread badge", () => {
    const page = source("src/app/(app)/notifications/page.tsx");
    const shell = source("src/components/AppShell.tsx");

    expect(page).toContain("dispatchNotificationCountChanged");
    expect(shell).toContain("NOTIFICATION_COUNT_CHANGED_EVENT");
    expect(shell).toContain("setUnreadNotifications(Math.max(0, unreadCount))");
  });

  it("renders generic documented destinations and a preferences handoff", () => {
    const page = source("src/app/(app)/notifications/page.tsx");

    expect(page).toContain('href="/settings/notifications"');
    expect(page).toContain('return "Open settings"');
    expect(page).toContain('return "Open items"');
    expect(page).toContain('return "Open details"');
  });

  it("keeps cached inbox data visible when a background refresh fails", () => {
    const page = source("src/app/(app)/notifications/page.tsx");

    expect(page).toContain("error && !data");
    expect(page).toContain("refreshing");
  });
});
