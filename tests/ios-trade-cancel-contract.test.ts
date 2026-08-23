import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

describe("iOS trade cancel contract", () => {
  it("uses the server PATCH route and decodes the returned trade", () => {
    const apiClient = source("ios/Wisconsin/Core/APIClient.swift");
    const route = source("src/app/api/shift-trades/[id]/cancel/route.ts");

    expect(route).toContain("export const PATCH");
    expect(route).toContain("return ok({ data: trade });");
    expect(apiClient).toContain("func cancelShiftTrade(id: String) async throws -> ShiftTrade");
    expect(apiClient).toContain("request(path: \"/api/shift-trades/\\(id)/cancel\", method: \"PATCH\")");
    expect(apiClient).toContain("let resp: DataWrapper<ShiftTrade> = try await perform(req)");
    expect(apiClient).toContain("return resp.data");
    expect(apiClient).not.toContain("request(path: \"/api/shift-trades/\\(id)/cancel\", method: \"POST\")");
  });

  it("updates the board from server truth instead of deleting optimistically", () => {
    const sheet = source("ios/Wisconsin/Views/Schedule/TradeBoardSheet.swift");

    expect(sheet).toContain("let updated = try await APIClient.shared.cancelShiftTrade(id: id)");
    expect(sheet).toContain("trades[idx] = updated");
    expect(sheet).not.toContain("trades.removeAll { $0.id == id }");
    expect(sheet).toContain("var myTrades: [ShiftTrade] { sections.myTrades }");
    expect(sheet).toContain("trade.postedBy.id == currentUserId");
    expect(sheet).toContain("trade.postedBy.id == currentUserId, trade.status == .open");
    expect(sheet).toContain("next.myTrades.append(trade)");
  });
});
