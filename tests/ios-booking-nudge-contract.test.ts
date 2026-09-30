import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

// Staff act on overdue gear from their phone; the web dashboard banner was the
// only place a nudge could be sent.
describe("iOS booking detail Nudge", () => {
  const detail = source("ios/Wisconsin/Views/BookingDetailView.swift");
  const api = source("ios/Wisconsin/Core/APIClient.swift");

  it("posts to the existing booking nudge route", () => {
    expect(api).toContain('request(path: "/api/bookings/\\(id)/nudge", method: "POST")');
  });

  it("follows server allowedActions so students and shared checkouts never see it", () => {
    expect(detail).toContain('booking.allows("nudge") == true');
    expect(detail).toContain("booking.kind == .checkout");
    expect(detail).toContain("booking.status == .open");
    expect(detail).toContain("booking.endsAt < Date.now");
  });

  it("shows sending and sent states and blocks repeat taps", () => {
    expect(detail).toContain("guard nudgeState == .idle else { return }");
    expect(detail).toContain('Label("Nudge Sent", systemImage: "checkmark")');
    expect(detail).toContain(".allowsHitTesting(nudge == .idle)");
    expect(detail).toContain("Color.statusText(nudge == .sent ? .green : .red)");
  });
});
