import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

/**
 * The booking list routes default to `startsAt desc`. iOS re-sorted each page
 * by due date, which looks correct under one page of rows and silently buries
 * the most urgent booking on the last page past that. These lock the client to
 * an explicit server sort, and lock that sort key to one the server accepts.
 */
describe("iOS booking list sort contract", () => {
  const client = source("ios/Wisconsin/Core/APIClient.swift");
  const bookingsView = source("ios/Wisconsin/Views/BookingsView.swift");
  const queries = source("src/lib/services/bookings-queries.ts");

  it("sends an explicit sort on booking list requests", () => {
    expect(client).toContain('items.append(.init(name: "sort", value: sort))');
  });

  it("defaults the merged list to soonest-finishing", () => {
    const bookings = client.slice(
      client.indexOf("func bookings("),
      client.indexOf("func reservations(")
    );
    expect(bookings).toContain('path: "/api/bookings"');
    expect(bookings).toContain('sort: String? = "endsAt"');
  });

  /**
   * Global search shares the single-kind calls and wants the server's recency
   * order, so those default to nil. Any caller that takes a *window* off the
   * top of an operational list has to say `endsAt` itself, or the rows it
   * misses are the urgent ones.
   */
  it("makes windowed operational callers request endsAt explicitly", () => {
    const liveActivity = source("ios/Wisconsin/LiveActivities/CheckoutReturnLiveActivityManager.swift");
    expect(liveActivity).toContain('sort: "endsAt"');

    const whatsOut = source("ios/Wisconsin/App/AppIntentsData.swift");
    expect(whatsOut).toContain('sort: "endsAt"');

    const search = source("ios/Wisconsin/Core/SearchService.swift");
    expect(search).not.toContain("sort:");
  });

  it("uses sort keys the server actually maps", () => {
    const map = queries.slice(
      queries.indexOf("export const BOOKING_SORT_MAP"),
      queries.indexOf("function parseSearchDate")
    );
    // An unmapped key falls through to the `startsAt desc` default silently,
    // which is the exact failure this contract exists to catch.
    expect(map).toContain('endsAt: [{ endsAt: "asc" }, { id: "asc" }]');
    expect(queries).toContain('const sortParam = searchParams.get("sort");');
  });

  it("orders each loaded page by its next operational handoff", () => {
    expect(bookingsView).toContain(
      "booking.kind == .reservation ? booking.startsAt : booking.endsAt",
    );
    expect(bookingsView).toContain(
      "sortedBookings = bookings.sorted(by: Self.operationalTimeSort)",
    );
  });

  /**
   * Checkouts and reservations render as one time-ordered list. It must stay a
   * single paginated stream — merging two independently paged calls client-side
   * would let a later page insert rows above ones already on screen.
   */
  it("backs the merged list with one paginated stream", () => {
    expect(bookingsView).toContain("APIClient.shared.bookings(");
    expect(bookingsView).not.toContain("APIClient.shared.checkouts(");
    expect(bookingsView).not.toContain("APIClient.shared.reservations(");
    expect(bookingsView).not.toContain("hasMoreCheckouts");
    expect(bookingsView).not.toContain("hasMoreReservations");
    // One offset cursor, not one per kind.
    expect(bookingsView).toContain("private var offset = 0");
  });
});
