import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

describe("iOS badge reward celebration", () => {
  it("uses a per-user recent-award cursor without replaying history", () => {
    const app = source("ios/Wisconsin/App/WisconsinApp.swift");
    const client = source("ios/Wisconsin/Core/APIClient.swift");
    expect(app).toContain('WisconsinBadgeRewardCursor.\\(userId)');
    expect(app).toContain("earnedBadgeQueue.appendUnique");
    expect(app).toContain("Task.sleep(for: .seconds(15))");
    expect(app).toContain("statusCode == 400");
    expect(app).toContain("removeObject(forKey: cursorKey)");
    expect(app).toContain("guard !badgeRewardPollInFlight else { return }");
    const foregroundRefresh = app.slice(app.indexOf("private func refreshBadgeRewardsForAppOpen"));
    expect(foregroundRefresh.indexOf("await pollBadgeRewards(for: userId)")).toBeLessThan(
      foregroundRefresh.indexOf("recordBadgeAppOpen()"),
    );
    expect(client).toContain('request(path: "/api/badges/recent"');
  });

  it("shares a reduced-motion-safe native reward view and complete icon map", () => {
    const reward = source("ios/Wisconsin/Shared/BadgeEarnedCelebration.swift");
    for (const icon of [
      "Clock3",
      "ScanLine",
      "CalendarDays",
      "Handshake",
      "Trophy",
    ]) {
      expect(reward).toContain(`"${icon}"`);
    }
    expect(reward).toContain("accessibilityReduceMotion");
    expect(reward).toContain("Badge earned.");
  });

  it("carries completion rewards into the kiosk success moment", () => {
    const api = source("ios/Wisconsin/Kiosk/KioskAPIClient.swift");
    const checkout = source("ios/Wisconsin/Kiosk/KioskCheckoutView.swift");
    const pickup = source("ios/Wisconsin/Kiosk/KioskPickupView.swift");
    const checkin = source("ios/Wisconsin/Kiosk/KioskReturnView.swift");
    const success = source("ios/Wisconsin/Kiosk/KioskSuccessView.swift");

    expect(api).not.toContain("scanAttemptId");
    expect(api).toContain("let earnedBadges: [EarnedBadgeReward]?");
    for (const flow of [checkout, pickup, checkin]) {
      expect(flow).toContain("appendUnique(contentsOf:");
      expect(flow).toContain("earnedBadges: earnedBadges");
    }
    expect(success).toContain("KioskBadgeCelebration");
    expect(success).toContain("info.earnedBadges.isEmpty ? 5 : 9");
    expect(success).toContain("additionalRewards");
    expect(success).toContain("Also earned:");
    // Rarity colour comes from the shared token, never a local switch. The
    // kiosk used to re-derive it and mapped `uncommon` onto purple, which is
    // also `legendary` — two tiers rendered identically, so the chip announcing
    // the tier was unreadable.
    expect(success).toContain("reward.badgeRarity.accent");
    expect(success).not.toMatch(/case "legendary":/);
    expect(success).not.toMatch(/case "uncommon":/);
  });
});
