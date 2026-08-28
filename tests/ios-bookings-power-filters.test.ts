import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

/**
 * GAP-34: the native Bookings list had no status scope or ordering control,
 * so a student could only ever see the default active set. These pin the
 * filter vocabulary to request shapes `/api/bookings` actually honours, and
 * pin the paging invariant that made the original sort contract necessary:
 * the client must never re-sort a page the server already ordered.
 */
describe("iOS bookings power filters", () => {
  const bookingsView = source("ios/Wisconsin/Views/BookingsView.swift");
  const apiClient = source("ios/Wisconsin/Core/APIClient.swift");
  const route = source("src/app/api/bookings/route.ts");
  const queries = source("src/lib/services/bookings-queries.ts");

  it("exposes one flat status scope list in product language", () => {
    expect(bookingsView).toContain("enum BookingStatusFilter: String, CaseIterable, Identifiable");
    for (const label of [
      "Active",
      "Overdue",
      "Due Today",
      "Reserved",
      "Pending Pickup",
      "Checked Out",
      "Completed",
      "Cancelled",
    ]) {
      expect(bookingsView).toContain(`case .${label.replace(/ (.)/g, (_m, c) => c.toUpperCase()).replace(/^./, (c) => c.toLowerCase())}: "${label}"`);
    }
    // Enum language never reaches the menu.
    expect(bookingsView).not.toContain('"PENDING_PICKUP"');
    expect(bookingsView).not.toContain('"BOOKED"');
  });

  it("maps each scope to a request shape the route reads", () => {
    const query = bookingsView.slice(
      bookingsView.indexOf("var query: (activeOnly: Bool"),
      bookingsView.indexOf("/// Ordering for the native Bookings list"),
    );
    // The route treats active / past / status as one scope selector.
    expect(query).toContain("case .active: (activeOnly: true, pastOnly: false, status: nil, filter: nil)");
    expect(query).toContain('filter: "overdue"');
    expect(query).toContain('filter: "due-today"');
    expect(query).toContain("status: .completed");
    expect(query).toContain("status: .cancelled");

    expect(route).toContain('const activeOnly = searchParams.get("active") === "true";');
    expect(route).toContain('const pastOnly = searchParams.get("past") === "true";');
    expect(route).toContain('const filter = searchParams.get("filter");');
    expect(route).toContain('filter === "overdue"');
    expect(route).toContain('filter === "due-today"');

    // The client has to be able to send `past`, or the closed scopes silently
    // fall back to the whole table.
    expect(apiClient).toContain('if past { items.append(.init(name: "past", value: "true")) }');
    expect(apiClient).toContain("pastOnly: Bool = false, status: BookingStatus? = nil");
  });

  it("only sends sort keys the server maps", () => {
    const map = queries.slice(
      queries.indexOf("export const BOOKING_SORT_MAP"),
      queries.indexOf("function parseSearchDate"),
    );
    const serverKey = bookingsView.slice(
      bookingsView.indexOf("var serverKey: String"),
      bookingsView.indexOf("var sortsLocally: Bool"),
    );
    for (const key of ["endsAt", "endsAt_desc", "title", "title_desc"]) {
      expect(serverKey).toContain(`"${key}"`);
      expect(map).toContain(`${key}:`);
    }
    expect(bookingsView).toContain("sort: sortOption.serverKey");
  });

  /**
   * The reason the original sort contract exists: a client re-sort of the
   * loaded prefix buries the rows a later page would have raised. The
   * operational default is the one deliberate exception, because it refines
   * the server's `endsAt` order rather than replacing it.
   */
  it("never re-sorts a page the server already ordered", () => {
    expect(bookingsView).toContain("var sortsLocally: Bool { self == .operational }");
    expect(bookingsView).toContain("func applyServerOrderIfNeeded()");
    expect(bookingsView).toContain("guard !sortOption.sortsLocally else { return }");
    expect(bookingsView).toContain("sortedBookings = bookings\n    }");
    // Still applied on every page append, not just on reset.
    const load = bookingsView.slice(
      bookingsView.indexOf("private func performLoad"),
      bookingsView.indexOf("private func fetchBookings"),
    );
    expect(load).toContain("applyServerOrderIfNeeded()");
  });

  it("caches only the unfiltered default list for offline use", () => {
    expect(bookingsView).toContain(
      'if reset && searchText.isEmpty && scope == .all && statusFilter == .active {',
    );
  });

  it("persists scope, status, and sort across launches", () => {
    expect(bookingsView).toContain('@AppStorage("bookingsScope")');
    expect(bookingsView).toContain('@AppStorage("bookingsStatusFilter")');
    expect(bookingsView).toContain('@AppStorage("bookingsSortOption")');
    expect(bookingsView).toContain("restoredScope: storedScope");
    expect(bookingsView).toContain("restoredStatusFilter: storedStatusFilter");
    expect(bookingsView).toContain("restoredSortOption: storedSortOption");
    // A private collaborator stays pinned to their own gear whatever the
    // stored scope says.
    expect(bookingsView).toContain(
      'scope = currentUserRole == "COLLABORATOR" ? .mine : restoredScope',
    );
  });

  it("keeps a non-default filter recoverable from the empty state", () => {
    expect(bookingsView).toContain('Label("Show Active Bookings", systemImage: "tray.full")');
    expect(bookingsView).toContain("if vm.statusFilter != .active { return vm.statusFilter.systemImage }");
  });

  it("puts the row actions one swipe away without a destructive full swipe", () => {
    const rowLink = bookingsView.slice(bookingsView.indexOf("private struct BookingRowLink"));
    expect(rowLink).toContain(".swipeActions(edge: .trailing, allowsFullSwipe: false)");
    expect(rowLink).toContain(".swipeActions(edge: .leading, allowsFullSwipe: false)");
    expect(rowLink).not.toContain("allowsFullSwipe: true");
    expect(rowLink).toContain('Label("Cancel", systemImage: "xmark.circle")');
    expect(rowLink).toContain('Label("Extend", systemImage: "clock.arrow.circlepath")');
    expect(rowLink).toContain('Label("Edit", systemImage: "pencil")');
    expect(rowLink).toContain('Label("Transfer", systemImage: "person.2")');
    // Swipe and long-press stay in agreement about what is allowed.
    expect(rowLink).toContain(".contextMenu {");
  });
});
