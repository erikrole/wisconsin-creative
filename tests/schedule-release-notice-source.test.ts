import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatScheduleReleaseCountdown } from "@/lib/schedule-release";

function source(path: string) {
  return readFileSync(path, "utf8");
}

describe("schedule release notification notice", () => {
  it("explains the notification timer from the accepted contract", () => {
    const notice = source("src/components/ScheduleReleaseNotice.tsx");

    expect(notice).toContain("formatScheduleReleaseCountdown");
    expect(notice).toContain("hasWorkingCopy");
    expect(notice).toContain("eventEndsAt");
    expect(notice).toContain("autoReleaseAt");
    expect(notice).toContain("autoReleaseError");
    expect(notice).toContain("Each new edit restarts the timer");
    expect(notice).toContain('role={hasReleaseError ? "alert" : "status"}');
  });

  it("formats the shared countdown in the same language as Schedule", () => {
    const now = Date.parse("2026-08-18T15:00:00.000Z");

    expect(formatScheduleReleaseCountdown("2026-08-18T15:09:01.000Z", now, "Affected users"))
      .toBe("Affected users notified in 10 minutes");
    expect(formatScheduleReleaseCountdown("2026-08-18T15:00:00.000Z", now, "Affected users"))
      .toBe("Affected users notified now");
    expect(formatScheduleReleaseCountdown(null, now, "Affected users"))
      .toBe("Affected users notified after this change is released");
  });

  it("is reused by Event detail Crew and the read-only shift detail panel", () => {
    const eventCrew = source("src/app/(app)/events/[id]/_components/ShiftCoverageCard.tsx");
    const shiftPanel = source("src/components/ShiftDetailPanel.tsx");

    for (const consumer of [eventCrew, shiftPanel]) {
      expect(consumer).toContain("<ScheduleReleaseNotice");
      expect(consumer).toContain("hasWorkingCopy=");
      expect(consumer).toContain("eventEndsAt=");
      expect(consumer).toContain("autoReleaseAt=");
      expect(consumer).toContain("autoReleaseError=");
    }
    expect(eventCrew).toContain("onRefresh={onUpdated}");
    expect(shiftPanel).toContain("onRefresh={fetchGroup}");
  });

  it("returns pending release timing only through staff-facing shift-group reads", () => {
    const listRoute = source("src/app/api/shift-groups/route.ts");
    const detailRoute = source("src/app/api/shift-groups/[id]/route.ts");

    for (const route of [listRoute, detailRoute]) {
      expect(route).toContain("autoReleaseAt: true");
      expect(route).toContain("autoReleaseError: true");
      expect(route).toContain("staffCanSeeWorkingState");
      expect(route).toContain("pendingRelease");
    }
  });
});
