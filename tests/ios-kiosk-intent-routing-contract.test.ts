import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const source = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

describe("iOS kiosk intent routing", () => {
  it("retains every supported entry source and consumes pending scans once", () => {
    const routing = source("ios/Wisconsin/Kiosk/KioskFlowRouting.swift");
    expect(routing).toContain("case scan, event, person, reservation, activeCheckout");
    expect(routing).toContain("var pendingScanValues: [String]");
    expect(routing).toContain("next.pendingScanValues.removeAll()");
    expect(routing).not.toContain("pendingScanValues: UserDefaults");
    expect(routing).not.toContain("privacy: .public) scan");
  });

  it("routes home, event, person, reservation, and active checkout into intent", () => {
    const idle = source("ios/Wisconsin/Kiosk/KioskIdleView.swift");
    const hub = source("ios/Wisconsin/Kiosk/KioskOperatorHubView.swift");
    const event = source("ios/Wisconsin/Kiosk/KioskEventDetailSheet.swift");
    expect(idle).toContain("source: .scan");
    expect(idle).toContain("source: .event");
    expect(idle).toContain("source: .activeCheckout");
    expect(hub).toContain("source: .person");
    expect(hub).toContain("kioskResolveScan(scanValue: scan, userId: user.id)");
    expect(event).toContain("Start Checkout for This Event");
  });

  it("keeps exact-requester identity and native editing intact", () => {
    const identity = source("ios/Wisconsin/Kiosk/KioskIdentityView.swift");
    const textField = source("ios/Wisconsin/Kiosk/KioskNativeTextField.swift");
    const shell = source("ios/Wisconsin/Kiosk/KioskShellView.swift");
    expect(identity).toContain("KioskFlowIntentReducer.canIdentify");
    expect(identity).toContain("intent?.expectedRequester.map { [$0] }");
    expect(textField).not.toContain("KioskHIDBurstDetector");
    expect(textField).not.toContain("rejectEditingBurst");
    expect(textField).toContain("Returning `true` here preserves UITextField's");
    expect(textField).toContain(") -> Bool { true }");
    expect(shell).toContain("KioskScannerStatusPill()");
  });
});
