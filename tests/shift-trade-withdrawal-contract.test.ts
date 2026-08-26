import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

describe("shift trade and request withdrawal contract", () => {
  it("exposes authenticated PATCH routes with the correct permissions", () => {
    const tradeRoute = source("src/app/api/shift-trades/[id]/withdraw/route.ts");
    const requestRoute = source("src/app/api/shift-assignments/[id]/withdraw/route.ts");

    expect(tradeRoute).toContain("export const PATCH");
    expect(tradeRoute).toContain('requirePermission(user.role, "shift_trade", "claim")');
    expect(tradeRoute).toContain("withdrawTradeClaim");
    expect(tradeRoute).toContain('return ok({ data: trade });');
    expect(requestRoute).toContain("export const PATCH");
    expect(requestRoute).toContain('requirePermission(user.role, "shift_assignment", "request")');
    expect(requestRoute).toContain("withdrawPickupRequest");
    expect(requestRoute).toContain('return ok({ data: assignment });');
  });

  it("keeps both native clients on the same server endpoints", () => {
    const apiClient = source("ios/Wisconsin/Core/APIClient.swift");
    const sheet = source("ios/Wisconsin/Views/Schedule/TradeBoardSheet.swift");
    const web = source("src/components/TradeBoard.tsx");

    expect(apiClient).toContain("func withdrawShiftTradeClaim(id: String) async throws -> ShiftTrade");
    expect(apiClient).toContain('request(path: "/api/shift-trades/\\(id)/withdraw", method: "PATCH")');
    expect(apiClient).toContain("func withdrawShiftRequest(id: String) async throws");
    expect(apiClient).toContain('request(path: "/api/shift-assignments/\\(id)/withdraw", method: "PATCH")');
    expect(sheet).toContain("func withdrawClaim(id: String) async throws");
    expect(sheet).toContain("func withdrawRequest(id: String) async throws");
    expect(sheet).toContain("withdrawAction");
    expect(web).toContain("/api/shift-trades/${trade.id}/withdraw");
    expect(web).toContain("/api/shift-assignments/${request.id}/withdraw");
  });

  it("surfaces the review deadline without treating auto-approval as a guarantee", () => {
    const web = source("src/components/TradeBoard.tsx");
    const models = source("ios/Wisconsin/Models/ShiftTradeModels.swift");
    const openWork = source("src/lib/services/schedule-open-work.ts");
    const trades = source("src/lib/services/shift-trades.ts");

    expect(web).toContain("Auto-approval check by");
    expect(models).toContain("let reviewAutoApprovesAt: Date?");
    expect(openWork).toContain("claimReviewDeadlines");
    expect(trades).toContain("reviewAutoApprovesAt");
  });
});
