import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

describe("iOS Kiosk rejected-scan feedback contract", () => {
  it("ships a local procedural failure cue without a binary resource", () => {
    const app = source("ios/Wisconsin/KioskOnly/KioskOnlyApp.swift");

    expect(app).toContain("import AVFoundation");
    expect(app).toContain("enum KioskScanFeedbackSound");
    expect(app).toContain("private static var player: AVAudioPlayer?");
    expect(app).toContain("AVAudioPlayer(data: failureWave)");
    expect(app).toContain("private static let failureWave: Data");
    expect(app).toContain(".mixWithOthers");
  });

  it("makes rejected or failed scan feedback audible on every kiosk scan surface", () => {
    for (const relativeFile of [
      "ios/Wisconsin/Kiosk/KioskCheckoutView.swift",
      "ios/Wisconsin/Kiosk/KioskPickupView.swift",
      "ios/Wisconsin/Kiosk/KioskReturnView.swift",
    ]) {
      expect(source(relativeFile)).toContain("KioskScanFeedbackSound.playFailure()");
    }
  });

  it("keeps the rejected fixture count limited to admitted items", () => {
    const harness = source("ios/Wisconsin/KioskOnly/KioskOnlyApp.swift");
    const checkout = source("ios/Wisconsin/Kiosk/KioskCheckoutView.swift");

    expect(harness).toContain("case availabilityRejected = \"availability-rejected\"");
    expect(harness).toContain("Array(KioskFixtures.availabilityConflictCart.dropFirst(2))");
    expect(checkout).toContain("availabilityResult = KioskCheckoutAvailabilityResult()");
    expect(checkout).toContain("Scan rejected; it was not added.");
  });
});
