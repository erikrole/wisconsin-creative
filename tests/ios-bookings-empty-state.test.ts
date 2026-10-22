import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("iOS bookings empty state recovery", () => {
  const source = readFileSync("ios/Wisconsin/Views/BookingsView.swift", "utf8");

  it("keeps no-result states actionable", () => {
    expect(source).toContain('Label("Clear Search", systemImage: "xmark.circle")');
    expect(source).toContain('Label("View All Bookings", systemImage: "person.2")');
    expect(source).toContain('Label("New Reservation", systemImage: "plus")');
    // The per-section "No active reservations" nudge went away with the
    // Checkouts/Reservations split; creation now lives in the toolbar and the
    // whole-list empty state.
    expect(source).not.toContain("ReservationEmptyRow");
  });

  it("uses the native unavailable view with scope-aware wording and a green primary action", () => {
    expect(source).toContain("ContentUnavailableView {");
    expect(source).toContain("Label(emptyTitle, systemImage: emptyIcon)");
    expect(source).toContain('case .mine: return "You\'re all clear"');
    expect(source).toContain('return vm.scope == .mine ? "checkmark.circle" : "calendar.badge.plus"');
    expect(source).toContain("You don't have any active checkouts or reservations.");
    expect(source).toContain(".buttonStyle(.borderedProminent)");
    expect(source).toContain(".tint(Color.statusText(.green))");
    expect(source).not.toContain("BookingEmptyState");
    expect(source).not.toContain('Label("Show all visible bookings"');
  });

  it("reloads the booking list after recovery actions", () => {
    expect(source).toContain("vm.searchText = \"\"");
    expect(source).toContain("vm.scope = .all");
    expect(source.match(/Task \{ await vm\.load\(reset: true, clearExistingRows: true\) \}/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("renders one chronological list grouped by day instead of separated sections or top tabs", () => {
    expect(source).toContain("var sortedBookings: [Booking]");
    // Checkouts and reservations interleave on the next operational handoff:
    // reservation pickup time or checkout due-back time.
    expect(source).toContain("booking.kind == .reservation ? booking.startsAt : booking.endsAt");
    expect(source).toContain("sortedBookings = bookings.sorted(by: Self.operationalTimeSort)");
    // Overdue and missed pickups lead; everything else sits under its day.
    expect(source).toContain('title: "Overdue"');
    expect(source).toContain("time.operationalDayLabel(now: now)");
    // An explicit sort or closed scope is one plain section named for the scope.
    expect(source).toContain('vm.statusFilter == .active ? "Active" : vm.statusFilter.label');
    expect(source).not.toContain('BookingListSection(title: "Checkouts"');
    expect(source).not.toContain('BookingListSection(title: "Reservations"');
    expect(source).toContain('"Search bookings..."');
    // Everyone / Mine is a system segmented control, not an unlabeled icon.
    expect(source).toContain('Picker("Bookings", selection: $vm.scope)');
    expect(source).toContain(".pickerStyle(.segmented)");
    expect(source).not.toContain("person.crop.circle");
    expect(source).toContain(".navigationBarTitleDisplayMode(.inline)");
    expect(source).toContain(".refreshable");
    expect(source).not.toContain("Picker(\"Booking type\"");
    expect(source).not.toContain("case needsAttention");
    expect(source).not.toContain("BookingFreshnessFooter");
    expect(source).not.toContain("enum BookingTab");
  });

  it("keeps operational status labels and names the requester in text", () => {
    expect(source).toContain('if isOverdue { return "Overdue" }');
    expect(source).toContain('if status == .booked { return "Reserved" }');
    expect(source).toContain('if status == .open { return "Checked Out" }');
    expect(source).toContain("if showsRequester { parts.append(booking.requester.name) }");
  });
});
