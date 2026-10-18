import { describe, expect, it, vi } from "vitest";
import { source } from "./_helpers/source";
import {
  gapCountCaption,
  itemsShortcut,
  parentSearchOutcome,
  publishedEventsFromPayload,
  reservationCandidatesFromPayload,
  restoreDialogFocus,
  rowKeyActivates,
  scheduleEventActionName,
} from "@/lib/a11y-resilience";

const pageShortcut = {
  metaKey: false,
  ctrlKey: false,
  searchFocused: false,
  hasSelection: false,
  canGoBack: true,
  canGoForward: true,
} as const;

describe("row keyboard activation", () => {
  const row = {};
  const nested = {};

  it("opens the row only when the row itself is the key target", () => {
    expect(rowKeyActivates({ key: "Enter", target: row, currentTarget: row })).toBe(true);
    expect(rowKeyActivates({ key: " ", target: row, currentTarget: row })).toBe(true);
    expect(rowKeyActivates({ key: " ", target: nested, currentTarget: row })).toBe(false);
    expect(rowKeyActivates({ key: "Escape", target: row, currentTarget: row })).toBe(false);
  });
});

describe("items list shortcuts", () => {
  it("pages only from the page, not from a dialog, menu, or toggle group", () => {
    expect(itemsShortcut({ ...pageShortcut, key: "ArrowRight", context: "page" })).toEqual({ type: "next-page" });
    expect(itemsShortcut({ ...pageShortcut, key: "ArrowLeft", context: "page" })).toEqual({ type: "previous-page" });
    expect(itemsShortcut({ ...pageShortcut, key: "ArrowRight", context: "widget" })).toBeNull();
    expect(itemsShortcut({ ...pageShortcut, key: "ArrowLeft", context: "overlay" })).toBeNull();
    expect(itemsShortcut({ ...pageShortcut, key: "/", context: "overlay" })).toBeNull();
  });

  it("lets Escape close an overlay instead of clearing the list selection", () => {
    expect(itemsShortcut({
      ...pageShortcut,
      key: "Escape",
      context: "overlay",
      hasSelection: true,
      searchFocused: true,
    })).toBeNull();
    expect(itemsShortcut({
      ...pageShortcut,
      key: "Escape",
      context: "page",
      hasSelection: true,
    })).toEqual({ type: "clear-selection" });
  });
});

describe("status and failed loads", () => {
  it("names the venue in the schedule control", () => {
    expect(scheduleEventActionName("Manage crew for", "Football vs Iowa", "Home"))
      .toBe("Manage crew for Football vs Iowa, Home");
  });

  it("treats an unreadable schedule as a failure, and an empty array as empty", () => {
    expect(publishedEventsFromPayload(null)).toEqual({ ok: false });
    expect(publishedEventsFromPayload({ data: {} })).toEqual({ ok: false });
    expect(publishedEventsFromPayload({ data: [] })).toEqual({ ok: true, events: [] });
  });

  it("does not describe a failed parent search as no results", () => {
    expect(parentSearchOutcome({ query: "sony", ok: false, payload: null })).toEqual({ status: "error" });
    expect(parentSearchOutcome({ query: "sony", ok: true, payload: {} })).toEqual({ status: "error" });
    expect(parentSearchOutcome({ query: "sony", ok: true, payload: { data: [] } })).toEqual({ status: "hits", hits: [] });
    expect(parentSearchOutcome({ query: "s", ok: false, payload: null })).toEqual({ status: "idle" });
  });

  it("rejects an unreadable existing-reservation check", () => {
    expect(() => reservationCandidatesFromPayload(null)).toThrow(/existing reservations/);
    expect(reservationCandidatesFromPayload({ data: [] })).toEqual([]);
  });

  it("does not claim every gap is filled when the count failed", () => {
    expect(gapCountCaption(0, true)).toBe("Count unavailable");
    expect(gapCountCaption(0, false)).toBe("All items have a value");
    expect(gapCountCaption(null, false)).toBe("Counting...");
    expect(gapCountCaption(2, false)).toBe("2 items missing");
  });
});

describe("dialog focus return", () => {
  it("focuses a still-mounted opener and leaves a removed one alone", () => {
    const focus = vi.fn();
    const preventDefault = vi.fn();
    expect(restoreDialogFocus({ isConnected: true, focus }, { preventDefault })).toBe(true);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();

    const gone = vi.fn();
    const ignored = vi.fn();
    expect(restoreDialogFocus({ isConnected: false, focus: gone }, { preventDefault: ignored })).toBe(false);
    expect(gone).not.toHaveBeenCalled();
    expect(ignored).not.toHaveBeenCalled();
    expect(restoreDialogFocus(null, { preventDefault: ignored })).toBe(false);
  });
});

describe("high-traffic screens use the recovery contracts", () => {
  it("keeps nested item and booking controls from activating the row", () => {
    expect(source("src/app/(app)/items/data-table.tsx")).toContain("rowKeyActivates");
    expect(source("src/components/booking-list/BookingRow.tsx")).toContain("rowKeyActivates");
  });

  it("names rows per page and shows venue words on the calendar", () => {
    expect(source("src/app/(app)/items/components/items-pagination.tsx")).toContain('aria-label="Rows per page"');
    const calendar = source("src/app/(app)/schedule/_components/CalendarView.tsx");
    const chip = calendar.slice(calendar.indexOf("function EventChip"), calendar.indexOf("function MobileCalendarEvent"));
    expect(chip).toContain("{venueTone.label}");
    expect(chip).toContain("scheduleEventActionName");
    expect(source("src/app/(app)/schedule/_components/WeekView.tsx")).toContain("scheduleEventActionName");
  });

  it("offers Try again when a schedule, reservation check, or parent search fails", () => {
    expect(source("src/app/(app)/schedule/_components/CollaboratorSchedule.tsx")).toContain('actionLabel="Try again"');
    expect(source("src/app/(app)/schedule/_components/CollaboratorSchedule.tsx")).toContain("publishedEventsFromPayload");
    expect(source("src/components/booking-wizard/BookingWizard.tsx")).toContain("Could not check for an existing reservation on this event.");
    expect(source("src/components/booking-wizard/BookingWizard.tsx")).toContain("Try again");
    expect(source("src/app/(app)/items/cleanup-wizard-dialog.tsx")).toContain("Parent search did not load.");
    expect(source("src/app/(app)/items/cleanup-wizard-dialog.tsx")).toContain("Try again");
    expect(source("src/app/(app)/items/[id]/ItemSettingsTab.tsx")).toContain("Try again");
    expect(source("src/app/(app)/items/gap-wizard-dialog.tsx")).toContain("gapCountCaption");
  });

  it("returns focus when confirmation and kiosk dialogs close", () => {
    expect(source("src/components/ConfirmDialog.tsx")).toContain("restoreDialogFocus");
    expect(source("src/components/ConfirmDialog.tsx")).toContain("requestAnimationFrame");
    expect(source("src/app/(app)/items/page.tsx")).toContain("restoreDialogFocus");
    expect(source("src/app/(app)/settings/kiosk-devices/page.tsx")).toContain("restoreDialogFocus");
    expect(source("src/app/(app)/bookings/BookingDetailPage.tsx")).toContain("shortcutContext");
  });
});
