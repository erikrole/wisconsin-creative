import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { QUARTER_HOUR_MINUTES, roundUpToQuarterHour } from "@/lib/quarter-hour";

function source(relativePath: string) {
  return readFileSync(`${process.cwd()}/${relativePath}`, "utf8");
}

describe("web Event and Schedule quarter-hour contract", () => {
  it("rounds an explicitly saved time forward without moving a quarter-hour boundary", () => {
    expect(roundUpToQuarterHour(new Date("2026-08-26T14:07:00.000Z")).toISOString())
      .toBe("2026-08-26T14:15:00.000Z");
    expect(roundUpToQuarterHour(new Date("2026-08-26T14:15:00.000Z")).toISOString())
      .toBe("2026-08-26T14:15:00.000Z");
  });

  it("uses a native 15-minute step and forward normalization for manual events", () => {
    const newEvent = source("src/app/(app)/schedule/_components/NewEventSheet.tsx");
    const eventDetail = source("src/app/(app)/events/[id]/page.tsx");
    const stepContract = `step={QUARTER_HOUR_MINUTES * 60}`;

    expect(QUARTER_HOUR_MINUTES).toBe(15);
    expect(newEvent).toContain(stepContract);
    expect(newEvent).toContain("return roundUpToQuarterHour(d).toISOString()");
    expect(eventDetail.match(new RegExp(stepContract.replace(/[{}*]/g, "\\$&"), "g"))?.length).toBe(1);
    expect(eventDetail).toContain("Preserve untouched legacy off-grid values");
    expect(eventDetail).toContain("!timingModeChanged && !startTimingTouched");
    expect(eventDetail).toContain("!timingModeChanged && !endTimingTouched");
    expect(eventDetail).toContain("roundUpToQuarterHour(new Date(draftStartsAt))");
    expect(eventDetail).toContain("roundUpToQuarterHour(new Date(draftEndsAt))");
  });

  it("uses the same 15-minute policy for live and working-copy call windows", () => {
    const liveEditor = source("src/components/shift-detail/CallWindowEditor.tsx");
    const workingEditor = source("src/app/(app)/schedule/_components/WorkingCrewEditor.tsx");

    expect(liveEditor.match(/step=\{QUARTER_HOUR_MINUTES \* 60\}/g)?.length).toBe(2);
    expect(liveEditor).toContain("roundUpToQuarterHour(new Date(callStartsAt))");
    expect(liveEditor).toContain("roundUpToQuarterHour(new Date(callEndsAt))");
    expect(workingEditor.match(/step=\{QUARTER_HOUR_MINUTES \* 60\}/g)?.length).toBe(4);
    expect(workingEditor.match(/roundUpToQuarterHour\(new Date\(/g)?.length).toBe(4);
  });

  it("keeps all-day and imported-event ownership boundaries intact", () => {
    const newEvent = source("src/app/(app)/schedule/_components/NewEventSheet.tsx");
    const eventDetail = source("src/app/(app)/events/[id]/page.tsx");

    expect(newEvent).toContain("buildAllDayEndDate(endDate)");
    expect(eventDetail).toContain("{!event.source && (");
    expect(eventDetail).toContain("date.getDate() + (isEnd ? 1 : 0)");
    expect(eventDetail).toContain("Existing gear reservation windows stay unchanged.");
  });
});
