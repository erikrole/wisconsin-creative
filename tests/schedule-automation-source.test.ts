import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("schedule automation source contract", () => {
  it("keeps schedule automation under morning-refresh instead of adding another cron route", () => {
    const cronRoutes = readdirSync("src/app/api/cron").sort();
    const morningRefresh = source("src/app/api/cron/morning-refresh/route.ts");

    expect(cronRoutes).toEqual(["audit-archive", "live-activities", "morning-refresh", "notifications", "rehost-images"]);
    expect(morningRefresh).toContain("getScheduleAutomationDigest");
    expect(morningRefresh).toContain("scheduleAutomation");
  });

  it("keeps the automation API staff/admin-only and read-only", () => {
    const route = source("src/app/api/schedule/automation/route.ts");

    expect(route).toContain("withAuth");
    expect(route).toContain('requireRole(user.role, ["ADMIN", "STAFF"])');
    expect(route).toContain("getScheduleAutomationDigest");
    expect(route).not.toContain("POST");
    expect(route).not.toContain("PATCH");
    expect(route).not.toContain("DELETE");
  });

  it("surfaces automation digest cards from the Schedule page data flow", () => {
    const hook = source("src/hooks/use-schedule-data.ts");
    const page = source("src/app/(app)/schedule/page.tsx");
    const readiness = source("src/app/(app)/schedule/_components/ScheduleReadiness.tsx");
    const component = source("src/app/(app)/schedule/_components/ScheduleAutomationDigest.tsx");

    expect(hook).toContain("/api/schedule/automation?");
    expect(hook).toContain("scheduleAutomation");
    expect(page).toContain("ScheduleReadiness");
    expect(page).toContain("digest={data.scheduleAutomation}");
    expect(readiness).toContain("ScheduleAutomationCards");
    expect(component).toContain("Suggestions only");
    expect(component).toContain("onShowQueue(action.queue)");
    expect(component).toContain("onOpenTradeBoard()");
  });
});
