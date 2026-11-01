import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("iOS checkout-return Live Activity redesign", () => {
  const widget = source("ios/WisconsinLiveActivities/CheckoutReturnLiveActivityWidget.swift");
  const attributes = source("ios/Wisconsin/LiveActivities/CheckoutReturnActivityAttributes.swift");

  it("sets the countdown as a large figure with a quiet unit", () => {
    expect(widget).toContain("private struct CountdownFigure: View");
    expect(widget.match(/CountdownFigure\(/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(attributes).toContain("func countdown(at date: Date) -> (value: String, unit: String)");
    expect(attributes).toContain('overdue ? "min overdue" : "min left"');
  });

  it("drains a track toward the return time and shows nothing for an unconfirmed card", () => {
    expect(widget).toContain("private struct ReturnTrack: View");
    expect(attributes).toContain("func remainingFraction(at date: Date) -> Double");
    expect(widget).toContain("presentation.isUnconfirmed ? 0 : context.state.remainingFraction(at: now)");
    expect(widget).toContain(".accessibilityHidden(true)");
  });

  it("keeps the due time inside the expanded bottom region so the island corner cannot clip it", () => {
    expect(widget).not.toContain("DynamicIslandExpandedRegion(.trailing)");
    expect(widget).toContain('Text("Due \\(context.state.endsAt, format: .chicago.hour().minute())")');
    expect(widget).toContain(".padding(.horizontal, 6)");
  });

  it("keeps the wire contract and the earlier privacy decisions", () => {
    expect(attributes).toContain("var allowsExtend: Bool");
    expect(widget).not.toContain("context.attributes.requesterName");
    expect(widget).not.toContain("timerInterval:");
    expect(widget).not.toContain("Button(intent:");
  });

  it("ships a DEBUG harness that starts the real activity without a push", () => {
    const harness = source("ios/Wisconsin/App/PerformanceTestHarness.swift");
    expect(harness).toContain("struct LiveActivityHarnessView: View");
    expect(harness).toContain("pushType: nil");
    expect(harness.indexOf("#if DEBUG")).toBe(0);
  });
});
