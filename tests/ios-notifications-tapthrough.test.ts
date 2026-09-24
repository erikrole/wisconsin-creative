import { describe, expect, it } from "vitest";
import { scheduleSurfaceSource, source } from "./_helpers/source";

function slice(text: string, start: string, end: string) {
  const startIndex = text.indexOf(start);
  const endIndex = text.indexOf(end, startIndex);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return text.slice(startIndex, endIndex);
}

describe("iOS notification tap-through contracts", () => {
  it("sends shift gear-up APNs payloads with event routing context", () => {
    const notifications = source("src/lib/services/notifications.ts");
    const gearUp = slice(
      notifications,
      "export async function createShiftGearUpNotification",
      "type ShiftScheduleEvent",
    );

    expect(gearUp).toContain("const pushPayload = scheduleNotificationPayload({");
    expect(gearUp).toContain("assignmentId: assignment.id");
    expect(gearUp).toContain("shiftId: assignment.shiftId");
    expect(gearUp).toContain("eventId: event.id");
    expect(gearUp).toContain('category: categoryForScheduleNotificationType("shift_gear_up")');
  });

  it("sends shift schedule APNs payloads with event routing context", () => {
    const notifications = source("src/lib/services/notifications.ts");
    const schedule = slice(
      notifications,
      "export async function createShiftScheduleNotification",
      "type ReservationLifecycleEvent",
    );

    expect(schedule).toContain("const pushPayload = scheduleNotificationPayload({");
    expect(schedule).toContain("assignmentId: assignment.id");
    expect(schedule).toContain("shiftId: assignment.shiftId");
    expect(schedule).toContain("eventId: calendarEvent.id");
    expect(schedule).toContain("category,");
  });

  it("routes allowed event pushes into Schedule and drops inaccessible collaborator targets", () => {
    const appDelegate = source("ios/Wisconsin/App/AppDelegate.swift");
    const appTab = source("ios/Wisconsin/Views/AppTabView.swift").split("// MARK: - Profile")[0];
    const schedule = scheduleSurfaceSource();
    const notifications = source("ios/Wisconsin/Views/NotificationsSheet.swift");
    const notificationModels = source("ios/Wisconsin/Models/NotificationModels.swift");
    const router = source("ios/Wisconsin/Core/GearTrackerRoute.swift");

    expect(appDelegate).toContain("GearTrackerRouteParser.parseNotification(userInfo:");
    expect(appDelegate).toContain("sharedAppState?.apply(route)");

    expect(appTab).toContain(".onChange(of: appState.pendingPushEventId)");
    expect(appTab).toContain("private func routePendingEventPush()");
    expect(appTab).toContain('guard hasCapability("PUBLISHED_SCHEDULE_VIEW") else {');
    expect(appTab).toContain("appState.selectedTab = 4");
    expect(appTab).toContain("appState.pendingPushEventId = nil");

    expect(schedule).toContain(".onChange(of: appState.pendingPushEventId)");
    expect(schedule).toContain("appState.pendingPushEventId = nil");
    expect(schedule).toContain("navigationPath.append(ScheduleEventRoute(id: event.id))");
    expect(schedule).toContain("APIClient.shared.publishedScheduleEvent(eventId: eventId)");
    expect(schedule).toContain("navigationPath.append(PublishedScheduleRoute(id: eventId))");

    expect(notificationModels).toContain("let eventId: String?");
    expect(notifications).toContain("GearTrackerRouteParser.parseNotification(payload:");
    expect(router).toContain("if let eventId = string(userInfo[\"eventId\"])");
  });
});
