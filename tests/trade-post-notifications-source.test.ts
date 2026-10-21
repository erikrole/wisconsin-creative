import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("trade post notifications", () => {
  it("tells only eligible students, once, after the post commits", () => {
    const service = source("src/lib/services/trade-post-notifications.ts");
    const route = source("src/app/api/shift-trades/route.ts");

    expect(route).toContain("await notifyEligibleStudentsOfTradePost(trade.id)");
    expect(service).toContain("shiftClaimEligibilityReason");
    expect(service).toContain('role: "STUDENT"');
    expect(service).toContain("id: { not: trade.postedByUserId }");
    expect(service).toContain("dedupeKey: `trade_available_${trade.id}_${user.id}`");
    expect(service).toContain('category: "trade"');
    expect(source("src/lib/notification-catalog.ts")).toContain('trade_available: "trade"');
  });
});
