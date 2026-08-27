import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

describe("trade board review surface", () => {
  it("keeps a student's own claim on the default board", () => {
    // "Waiting on Admin" — and the Withdraw claim button that only lives there —
    // is built from the same filtered list. A claimed trade is neither OPEN nor
    // posted by the claimer, so dropping it takes the whole section with it.
    const web = source("src/components/TradeBoard.tsx");

    expect(web).toContain("|| trade.claimedBy?.id === currentUserId,");
    expect(web).toContain('trade.status === "CLAIMED" && trade.claimedBy?.id === currentUserId');
    expect(web).toContain("/api/shift-trades/${trade.id}/withdraw");
  });

  it("orders the Admin review queue by the shift, not by the post", () => {
    const web = source("src/components/TradeBoard.tsx");
    const models = source("ios/Wisconsin/Models/ShiftTradeModels.swift");

    expect(web).toContain("function effectiveStartMs(");
    // Personal call window, then the slot's, then the shift — same precedence
    // the server uses for staleness and review deadlines.
    expect(web).toContain("assignmentCallStartsAt ?? shift.callStartsAt ?? shift.startsAt");
    expect(models).toContain("var effectiveStartsAt: Date { callStartsAt ?? shift.effectiveStartsAt }");
    expect(models).toContain("var effectiveStartsAt: Date { callStartsAt ?? startsAt }");
  });

  it("renders trade claims and pickup requests as one interleaved queue", () => {
    // Two consecutive groups sort separately: a request four days out lands
    // above a claim on tomorrow's shift, which looks ordered without being it.
    const web = source("src/components/TradeBoard.tsx");
    const sheet = source("ios/Wisconsin/Views/Schedule/TradeBoardSheet.swift");

    expect(web).toContain("const reviewQueue: ReviewQueueItem[] = [");
    expect(web).toContain("].sort((a, b) => a.startsAtMs - b.startsAtMs);");
    expect(web).toContain("{reviewQueue.map((item) => (");
    expect(web).not.toContain("{requestsAwaitingReview.map((request) => {");
    expect(web).not.toContain("{tradesAwaitingReview.map((trade) => {");

    expect(sheet).toContain("enum TradeReviewItem: Identifiable");
    expect(sheet).toContain("ForEach(vm.reviewQueue) { item in");
    expect(sheet).toContain(".sorted { $0.effectiveStartsAt < $1.effectiveStartsAt }");
  });

  it("says whose claim a cancellation takes down", () => {
    const web = source("src/components/TradeBoard.tsx");

    expect(web).toContain('const claimerName = trade.status === "CLAIMED" ? trade.claimedBy?.name ?? null : null;');
    expect(web).toContain("pending claim is cancelled");
  });

  it("never promises the deadline will approve a claim", () => {
    // Auto-approval re-runs every conflict, availability, and refill check, and
    // stands down on a 4xx. Both audiences get "check", never "will be approved".
    const web = source("src/components/TradeBoard.tsx");

    expect(web).toContain("Auto-approval check by");
    expect(web).not.toContain("it is approved automatically");
    expect(web).not.toContain("Approves automatically at");
  });

  it("meters both halves of every review pair", () => {
    for (const route of [
      "src/app/api/shift-assignments/[id]/approve/route.ts",
      "src/app/api/shift-assignments/[id]/decline/route.ts",
      "src/app/api/shift-trades/[id]/approve/route.ts",
      "src/app/api/shift-trades/[id]/decline/route.ts",
    ]) {
      expect(source(route)).toContain("enforceRateLimit");
    }
  });

  it("keeps every human approval surface Admin-only", () => {
    const permissions = source("src/lib/permissions.ts");
    const openWork = source("src/lib/services/schedule-open-work.ts");
    const notifications = source("src/lib/services/claim-review-notifications.ts");
    const trades = source("src/lib/services/shift-trades.ts");
    const web = source("src/components/TradeBoard.tsx");
    const slot = source("src/components/shift-detail/ShiftSlotCard.tsx");
    const sheet = source("ios/Wisconsin/Views/Schedule/TradeBoardSheet.swift");
    const eventDetail = source("ios/Wisconsin/Views/EventDetailSheet.swift");

    expect(permissions).toContain('shift_assignment: {\n    view: ["ADMIN", "STAFF", "STUDENT"],\n    assign: ["ADMIN", "STAFF"],\n    request: ["ADMIN", "STAFF", "STUDENT"],\n    approve: ["ADMIN"],');
    expect(permissions).toContain('shift_trade: {\n    view: ["ADMIN", "STAFF", "STUDENT"],\n    post: ["ADMIN", "STAFF", "STUDENT"],\n    claim: ["ADMIN", "STAFF", "STUDENT"],\n    approve: ["ADMIN"],');
    expect(openWork).toContain('filters.role === "ADMIN"');
    expect(notifications).toContain('visibleActiveUserWhere({ role: "ADMIN" })');
    expect(trades).toContain('visibleActiveUserWhere({ role: "ADMIN" })');
    expect(web).toContain('const canReview = currentUserRole === "ADMIN";');
    expect(web).toContain('const tradesAwaitingReview = canReview');
    expect(web).toContain('const requestsAwaitingReview = canReview');
    expect(slot).toContain('{canReviewClaims && (');
    expect(sheet).toContain('var canReview: Bool { currentUserRole == "ADMIN" }');
    expect(sheet).toContain('if vm.canReview, vm.reviewCount > 0');
    expect(eventDetail).toContain('private var canReviewClaims: Bool');
    expect(eventDetail).toContain('onApprove: canReviewClaims');
  });

  it("uses Admin approval language on web and native claim surfaces", () => {
    const web = source("src/components/TradeBoard.tsx");
    const sheet = source("ios/Wisconsin/Views/Schedule/TradeBoardSheet.swift");

    expect(web).toContain('title="Admin Review"');
    expect(web).toContain('title="Waiting on Admin"');
    expect(sheet).toContain('title: "Admin Review"');
    expect(sheet).toContain('title: "Waiting on Admin"');
    expect(web).not.toMatch(/staff (review|approval)|waiting on staff/i);
    expect(sheet).not.toMatch(/staff (review|approval)|waiting on staff/i);
  });

  it("writes the trade decline audit entry beside the row it changes", () => {
    // Decline is the one review outcome that leaves no trace on the trade —
    // the claimer is cleared — so the entry has to be in the transaction.
    const service = source("src/lib/services/shift-trades.ts");
    const route = source("src/app/api/shift-trades/[id]/decline/route.ts");

    expect(service).toContain("export async function declineTrade(tradeId: string, actor: TradeApprovalActor = null)");
    expect(service).toContain('action: "trade_declined"');
    expect(route).toContain('declineTrade(id, { id: user.id, role: user.role })');
    expect(route).not.toContain("createAuditEntry");
  });
});
