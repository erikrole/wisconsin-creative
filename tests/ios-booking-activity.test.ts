import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

const detail = () => source("ios/Wisconsin/Views/BookingDetailView.swift");
const screen = () => source("ios/Wisconsin/Views/Booking/BookingActivityView.swift");
const models = () => source("ios/Wisconsin/Models/BookingActivityModels.swift");
const client = () => source("ios/Wisconsin/Core/APIClient.swift");
const project = () => source("ios/Wisconsin.xcodeproj/project.pbxproj");

describe("iOS booking activity", () => {
  it("opens a read-only history from the booking and leaves Extend as the main action", () => {
    const booking = detail();
    const activity = screen();
    const api = client();
    const method = api.slice(api.indexOf("func bookingActivity"), api.indexOf("func bookingReusePlan"));

    expect(booking).toContain("BookingActivityAccess.canRead(role: session.currentUser?.role)");
    expect(booking).toContain("BookingActivityView(bookingId: booking.id)");
    expect(booking).toContain('Text("Activity")');
    expect(booking).toContain("What changed on this booking.");
    expect(booking).toContain("if canExtendBooking");
    expect(booking).toContain("BookingExtendBar(");

    expect(activity).toContain("ProgressView(\"Loading activity\")");
    expect(activity).toContain("Couldn't load activity");
    expect(activity).toContain("Couldn't refresh. The list is unchanged.");
    expect(activity).toContain("self.error = \"Couldn't load activity.\"");
    expect(activity).toContain("self.error = \"Couldn't refresh. The list is unchanged.\"");
    expect(activity).toContain("No activity yet");
    expect(activity).toContain("No matching activity.");
    expect(activity).toContain("Older activity stays on the website.");
    expect(activity).toContain("BookingActivityFilter.allCases");
    expect(activity).not.toMatch(/method:\s*"(POST|PATCH|DELETE|PUT)"/);
    expect(activity).not.toMatch(/\.foregroundStyle\(\.(red|green|blue|orange|purple)\)/);

    expect(method).toContain('path: "/api/bookings/\\(id)"');
    expect(method).not.toMatch(/method:\s*"(POST|PATCH|DELETE|PUT)"/);
    expect(method).not.toContain("/audit-logs");
  });

  it("matches the website gate and keeps decoded fields writable", () => {
    const catalog = models();

    expect(catalog).toContain('role == "ADMIN" || role == "STAFF" || role == "STUDENT"');
    expect(catalog).not.toContain('"COLLABORATOR"');
    expect(catalog).toContain("var auditLogs: [BookingActivityEntry]?");
    expect(catalog).toContain("var hasMoreAuditLogs: Bool?");
    expect(catalog).toContain("var avatarUrl: String?");
    expect(catalog).toContain("requesterEmail");
    expect(catalog).not.toMatch(/let auditLogs: \[BookingActivityEntry\]\? =/);
    expect(catalog).not.toMatch(/let avatarUrl: String\? =/);
    expect(catalog).toContain("Booking changes");
    expect(catalog).toContain("Equipment changes");
    expect(catalog).toContain("Transferred ownership to");
    expect(catalog).toContain("Extended the checkout to");
    expect(catalog).toContain("booking.items_added");
    expect(catalog).toContain("booking.items_removed");
    expect(catalog).toContain("Updated notes");
  });

  it("registers the new files in the XcodeGen project", () => {
    const pbx = project();

    expect(pbx).toContain("BookingActivityView.swift in Sources");
    expect(pbx).toContain("BookingActivityModels.swift in Sources");
    expect(pbx).toContain("path = BookingActivityView.swift");
    expect(pbx).toContain("path = BookingActivityModels.swift");
  });
});
