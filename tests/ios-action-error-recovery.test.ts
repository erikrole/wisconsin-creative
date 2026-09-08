import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const source = (file: string) => readFileSync(`ios/Wisconsin/${file}`, "utf8");

describe("native mutation failure visibility", () => {
  it("keeps extension and call-window failures outside scrolling content", () => {
    const extend = source("Views/ExtendBookingSheet.swift");
    const event = source("Views/EventDetailSheet.swift");
    expect(extend).toContain('.safeAreaInset(edge: .top)');
    expect(extend).toContain('ActionErrorBanner(title: "Couldn\'t extend booking"');
    expect(extend).toContain('.interactiveDismissDisabled(isLoading || hasChanges)');
    expect(event).toContain('onDismiss: { self.saveError = nil }');
    expect(event).not.toContain('saveErrorCard(message: saveError)');
  });
  it("recovers event mutations with authoritative reads instead of competing alerts or replay", () => {
    const event = source("Views/EventDetailSheet.swift");
    const recovery = event.slice(event.indexOf('private var eventErrorView:'), event.indexOf('private func confirmationActions'));
    expect(recovery).toContain('.safeAreaInset(edge: .top)');
    expect(recovery).toContain('await vm.load(forceRefresh: true)');
    expect(recovery).not.toContain('.alert(');
    expect(event).not.toContain('actionRetry');
  });
  it("announces the entire error and keeps recovery targets accessible", () => {
    const banner = source("Views/Components/BannerView.swift").split('struct ActionErrorBanner: View')[1];
    expect(banner).toContain('AccessibilityNotification.Announcement');
    expect(banner).toContain('.frame(minHeight: 44)');
    expect(banner).not.toContain('.lineLimit(2)');
  });
});
