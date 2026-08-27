import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (file: string) => readFileSync(file, "utf8");

describe("student shift claim surfaces", () => {
  it("keeps one approval-aware action in Schedule disclosure and Event detail", () => {
    const helper = source("src/components/ClaimShiftAction.tsx");
    const schedule = source("src/app/(app)/schedule/_components/ListView.tsx");
    const eventDetail = source("src/app/(app)/events/[id]/_components/ShiftCoverageCard.tsx");
    const panel = source("src/components/ShiftDetailPanel.tsx");
    const area = source("src/components/shift-detail/ShiftAreaSection.tsx");
    const slot = source("src/components/shift-detail/ShiftSlotCard.tsx");

    expect(schedule).toContain("<ClaimShiftAction");
    expect(eventDetail).toContain("<ClaimShiftAction");
    expect(helper).toContain('"/api/shift-assignments/pickup"');
    expect(helper).toContain("/withdraw");
    expect(helper).toContain("Awaiting approval");
    expect(helper).toContain("onChanged");
    expect(panel).not.toContain("onRequest");
    expect(area).not.toContain("onRequest");
    expect(slot).not.toContain("Claim this shift");
    expect(slot).not.toContain("userHasRequested");
  });

  it("returns only the viewer's pending request to prevent duplicate claims", () => {
    const route = source("src/app/api/shift-groups/route.ts");
    const scheduleTypes = source("src/app/(app)/schedule/_components/types.ts");
    const eventTypes = source("src/app/(app)/events/[id]/_utils.ts");

    expect(route).toContain('userId: user.id, status: "REQUESTED"');
    expect(route).toContain("viewerRequestByShiftId");
    expect(route).toContain("viewerRequest: viewerRequestByShiftId.get(s.id) ?? null");
    expect(scheduleTypes).toContain("viewerRequest?: ShiftViewerRequest | null");
    expect(eventTypes).toContain("viewerRequest?: {");
  });

  it("loads the complete native schedule window through total-aware pages", () => {
    const apiClient = source("ios/Wisconsin/Core/APIClient.swift");
    const schedule = source("ios/Wisconsin/Views/ScheduleView.swift");
    const models = source("ios/Wisconsin/Models/ScheduleModels.swift");
    const eventDetail = source("ios/Wisconsin/Views/EventDetailSheet.swift");

    expect(apiClient).toContain("func allCalendarEvents(");
    expect(apiClient).toContain("offset + pageCount < response.total");
    expect(apiClient).toContain("func allMyShifts(");
    expect(source("src/app/api/calendar-events/route.ts")).toContain(
      'orderBy: [{ startsAt: "asc" }, { id: "asc" }]',
    );
    expect(source("src/app/api/my-shifts/route.ts")).toContain(
      'orderBy: [{ shift: { startsAt: "asc" } }, { id: "asc" }]',
    );
    expect(schedule).toContain("APIClient.shared.allCalendarEvents(includePast: requestedIncludePast)");
    expect(schedule).toContain("APIClient.shared.allMyShifts()");
    expect(models).toContain("let viewerRequest: ViewerShiftRequest?");
    expect(eventDetail).toContain("$0.viewerRequest == nil");
    expect(eventDetail).toContain("pendingStudentClaimShifts");
  });

  it("fans out every claim-review notification only to active admins", () => {
    const pickup = source("src/app/api/shift-assignments/pickup/handler.ts");
    const notifications = source("src/lib/services/notifications.ts");
    const claimReviewNotifications = source("src/lib/services/claim-review-notifications.ts");
    const reviewerFanout = notifications.slice(
      notifications.indexOf("export async function notifyPickupRequestReviewers"),
      notifications.indexOf("export async function createPublishedShiftGroupNotifications"),
    );

    expect(pickup).toContain("notifyPickupRequestReviewers(assignment.id)");
    expect(reviewerFanout).toContain('role: "ADMIN"');
    expect(reviewerFanout).not.toContain('role: { in: ["ADMIN", "STAFF"] }');
    expect(reviewerFanout).toContain('type: "shift_request_review"');
    expect(reviewerFanout).toContain("skipDuplicates: true");
    expect(reviewerFanout).toContain("sendPushToUser(reviewer.id");
    expect(claimReviewNotifications).toContain('visibleActiveUserWhere({ role: "ADMIN" })');
    expect(claimReviewNotifications).not.toContain('role: { in: ["ADMIN", "STAFF"] }');
  });
});
