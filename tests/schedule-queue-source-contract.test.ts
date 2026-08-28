import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SCHEDULE_QUEUE_META } from "@/lib/schedule-queues";

function source(path: string) {
  return readFileSync(path, "utf8");
}

describe("schedule queue source contract", () => {
  it("keeps schedule queue state URL-backed", () => {
    const hook = source("src/hooks/use-schedule-data.ts");

    expect(hook).toContain('searchParams.get("queue")');
    expect(hook).toContain('params.set("queue", queue)');
    expect(hook).toContain('params.delete("queue")');
    expect(hook).toContain("router.replace");
    expect(hook).toContain("filterEntriesForScheduleQueue");
  });

  it("routes readiness cards into named queues", () => {
    const readiness = source("src/app/(app)/schedule/_components/ScheduleReadiness.tsx");

    for (const queue of [
      "needs-staffing",
      "my-calls-today",
      "trade-approval",
      "pending-requests",
      "conflicts",
      "gear-gaps",
      "data-quality",
      "stale-source",
    ]) {
      expect(readiness).toContain(`"${queue}"`);
    }

    expect(SCHEDULE_QUEUE_META["my-calls-today"]).toMatchObject({
      label: "My calls today",
      shortLabel: "My calls",
      emptyTitle: "No calls today",
    });
    expect(readiness).toContain('label: "My calls today"');
    expect(readiness).not.toContain('label: "My shifts"');
    expect(readiness).toContain('queue: "my-calls-today"');
    expect(readiness).toContain("value: myCallsTodayCount");
  });

  it("opens trade approval through claimed trades instead of a generic board", () => {
    const page = source("src/app/(app)/schedule/page.tsx");
    const tradeBoard = source("src/components/TradeBoard.tsx");

    expect(page).toContain('queue === "trade-approval"');
    // Claim review is Admin-only, so the CLAIMED preset is gated on that too.
    expect(page).toContain('initialStatusFilter={canReviewClaims && data.filters.queue === "trade-approval" ? "CLAIMED" : undefined}');
    expect(tradeBoard).toContain("initialStatusFilter");
    expect(tradeBoard).toContain("setStatusFilter(initialStatusFilter)");
  });
});
