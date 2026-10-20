import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("app shell bell popover and phone tabs", () => {
  it("reads and marks notifications in place and keeps the badge in sync", () => {
    const popover = source("src/components/NotificationsPopover.tsx");

    expect(popover).toContain("/api/notifications?limit=${POPOVER_LIMIT}");
    expect(popover).toContain('action: "mark_read"');
    expect(popover).toContain('action: "mark_all_read"');
    expect(popover).toContain("dispatchNotificationCountChanged");
    expect(popover).toContain("notificationDestinationPath(notification.payload, notification.type)");
    expect(popover).toContain('href="/settings/notifications"');
  });

  it("gives non-collaborators a More tab that opens the sidebar drawer", () => {
    const tabs = source("src/components/MobileTabBar.tsx");
    const appShell = source("src/components/AppShell.tsx");

    expect(tabs).toContain("setOpenMobile(!openMobile)");
    expect(tabs).toContain('aria-label="More pages"');
    expect(appShell).toContain("showMore={!isCollaborator}");
  });

  it("toggles the sidebar with [ outside text fields", () => {
    const sidebar = source("src/components/Sidebar.tsx");

    expect(sidebar).toContain('event.key !== "["');
    expect(sidebar).toContain('target?.closest("input, textarea, select');
  });
});
