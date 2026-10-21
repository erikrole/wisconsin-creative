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

  it("filters the bell between All and Unread through the API", () => {
    const popover = source("src/components/NotificationsPopover.tsx");
    expect(popover).toContain('role="tablist"');
    expect(popover).toContain('"&unread=true"');
    expect(popover).toContain("}, [open, view]);");
    expect(popover).toContain("Nothing unread");
  });

  it("lets people hide sidebar pages and restore defaults, without losing the current page", () => {
    const sidebar = source("src/components/Sidebar.tsx");
    const dialog = source("src/components/SidebarCustomizeDialog.tsx");
    expect(sidebar).toContain('const HIDDEN_KEY = "sidebar:hidden";');
    expect(sidebar).toContain("!hiddenHrefs.includes(item.href) || item.href === activeHref");
    expect(dialog).toContain("aria-label={hidden ? `Show ${item.label}` : `Hide ${item.label}`}");
    expect(dialog).toContain("if (hidden && pinnedHrefs.includes(href)) togglePinned(href, false);");
    expect(dialog).toContain("Restore defaults");
    expect(dialog).not.toContain("Unpin all");
  });
});
