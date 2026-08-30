import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

describe("iOS navigation HIG remediation", () => {
  it("keeps a sidebar destination reachable when a regular window becomes compact", () => {
    const tabs = source("ios/Wisconsin/Views/AppTabView.swift");
    const browse = source("ios/Wisconsin/Views/BrowseView.swift");
    const appState = source("ios/Wisconsin/Core/AppState.swift");

    expect(tabs).toContain("private var collapsedSidebarTab: Int?");
    expect(tabs).toContain("private func browseDestination(for tab: Int)");
    expect(tabs).toContain("appState.pendingBrowseDestination = destination");
    expect(tabs).toContain("restoreSidebarDestinationIfNeeded()");
    expect(browse).toContain("consumePendingDestination()");
    expect(browse).toContain("navigationPath.append(destination)");
    expect(appState).toContain("var pendingBrowseDestination: String?");
    expect(appState).toContain("pendingBrowseDestination = nil");
  });

  it("gives pushed detail surfaces a destination identity and preserves headings", () => {
    const guides = source("ios/Wisconsin/Views/GuidesView.swift");
    const booking = source("ios/Wisconsin/Views/BookingDetailView.swift");
    const item = source("ios/Wisconsin/Views/ItemDetailView.swift");

    expect(guides).toContain(".navigationTitle(displayedGuide.title)");
    expect(guides).not.toContain(".toolbar(.hidden, for: .tabBar)");
    expect(guides).toContain(".accessibilityAddTraits(.isHeader)");
    expect(booking).toContain('.navigationTitle(booking?.title ?? "Booking")');
    expect(booking).toContain(".accessibilityElement(children: .contain)");
    expect(booking).not.toContain(".accessibilityElement(children: .ignore)");
    expect(item).toContain('.navigationTitle(asset?.itemListPrimaryTitle ?? "Item")');
    expect(item).toContain(".accessibilityAddTraits(.isHeader)");
  });

  it("does not leave an inactive reservation accessory pill in the tab shell", () => {
    const tabs = source("ios/Wisconsin/Views/AppTabView.swift");
    expect(tabs).toContain("content.tabViewBottomAccessory(isEnabled: isVisible)");
    expect(tabs).toContain("} else if isVisible {");
    expect(tabs).toContain("} else {\n            content\n        }");
    expect(tabs).not.toContain("if isVisible { accessory() }");
  });
});
