import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

describe("iOS system correctness request ownership", () => {
  it("lets only the current student-hub scan route mutate kiosk flow state", () => {
    const hub = source("ios/Wisconsin/Kiosk/KioskOperatorHubView.swift");
    const routeScan = hub.slice(
      hub.indexOf("private func routeScan"),
      hub.indexOf("private func showScanFeedback"),
    );

    expect(hub).toContain("@State private var scanRouteTask: Task<Void, Never>?");
    expect(hub).toContain("@State private var scanRouteRequests = LatestRequestGeneration()");
    expect(routeScan).toContain("scanRouteTask?.cancel()");
    expect(routeScan).toContain("let requestToken = scanRouteRequests.begin()");
    expect(routeScan).toContain("try Task.checkCancellation()");
    expect(routeScan.match(/guard ownsScanRoute\(requestToken\) else \{ return \}/g)).toHaveLength(2);
    expect(routeScan).toContain("guard ownsScanRoute(requestToken), !isCancellation(error) else { return }");
    expect(routeScan).toContain("store.scanner.owner == .operatorHub");
    expect(routeScan).toContain("case .operatorHub(let activeUser) = store.screen");
    expect(routeScan).toContain("return activeUser.id == user.id");

    const disappearance = hub.slice(
      hub.indexOf(".onDisappear {"),
      hub.indexOf(".task(id: \"refresh\")"),
    );
    expect(disappearance).toContain("scanRouteTask?.cancel()");
    expect(disappearance).toContain("scanRouteRequests.invalidate()");
    expect(disappearance.indexOf("scanRouteRequests.invalidate()")).toBeLessThan(
      disappearance.indexOf("store.scanner.release(.operatorHub)"),
    );
  });

  it("BUG: lets only the newest active student-hub refresh publish context", () => {
    const hub = source("ios/Wisconsin/Kiosk/KioskOperatorHubView.swift");
    const contextRefresh = hub.slice(
      hub.indexOf("private func loadContext"),
      hub.indexOf("private func routeScan"),
    );

    expect(hub).toContain("@State private var contextLoadTask: Task<Void, Never>?");
    expect(hub).toContain("@State private var contextLoadRequests = LatestRequestGeneration()");
    expect((hub.match(/await loadContext\(\)/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(contextRefresh).toContain("contextLoadTask?.cancel()");
    expect(contextRefresh).toContain("let requestToken = contextLoadRequests.begin()");
    expect(contextRefresh).toContain(
      "await performContextLoad(requestToken: requestToken)",
    );
    expect(contextRefresh).toContain("await withTaskCancellationHandler {");
    expect(contextRefresh).toMatch(/onCancel:\s*\{[\s\S]*?task\.cancel\(\)/);
    expect(contextRefresh).toContain("let loadedContext = try await");
    expect(contextRefresh).toContain("guard ownsContextLoad(requestToken) else { return }");
    expect(contextRefresh.indexOf("guard ownsContextLoad(requestToken) else { return }")).toBeLessThan(
      contextRefresh.indexOf("context = loadedContext"),
    );
    expect(contextRefresh).toMatch(
      /catch \{[\s\S]*?guard ownsContextLoad\(requestToken\) else \{ return \}[\s\S]*?if context == nil/,
    );
    expect(contextRefresh).toMatch(
      /defer \{\s*if contextLoadRequests\.owns\(requestToken\) \{[\s\S]*?isLoading = false[\s\S]*?contextLoadTask = nil/,
    );
    expect(contextRefresh).toContain("contextLoadRequests.invalidate()");
    expect(contextRefresh).toContain("store.scanner.owner == .operatorHub");
    expect(contextRefresh).toContain("case .operatorHub(let activeUser) = store.screen");
    expect(contextRefresh).toContain("return activeUser.id == user.id");

    const disappearance = hub.slice(
      hub.indexOf(".onDisappear {"),
      hub.indexOf(".task(id: \"refresh\")"),
    );
    expect(disappearance).toContain("cancelContextLoad()");
    expect(disappearance.indexOf("cancelContextLoad()")).toBeLessThan(
      disappearance.indexOf("store.scanner.release(.operatorHub)"),
    );

    const poll = hub.slice(
      hub.indexOf(".task(id: \"refresh\")"),
      hub.indexOf(".sheet(item: $selectedCheckout)"),
    );
    expect(poll).toContain("guard !Task.isCancelled else { break }");
  });

  it("cancel-replaces an in-flight Schedule load when Include Past changes", () => {
    const schedule = source("ios/Wisconsin/Views/ScheduleView.swift");
    const viewModel = schedule.slice(
      schedule.indexOf("final class ScheduleViewModel"),
      schedule.indexOf("// MARK: - HomeAwayFilter"),
    );

    expect(viewModel).toContain("private var loadTask: Task<Void, Never>?");
    expect(viewModel).toContain("private var loadRequests = LatestRequestGeneration()");
    expect(viewModel).toMatch(
      /if forceRefresh \{[\s\S]*?loadTask\?\.cancel\(\)[\s\S]*?\} else if isLoading \{[\s\S]*?return/,
    );
    expect(viewModel).toContain("let requestedIncludePast = includePast");
    expect(viewModel).toContain("let requestToken = loadRequests.begin()");
    expect(viewModel).toContain(
      "await performLoad(includePast: requestedIncludePast, requestToken: requestToken)",
    );
    expect(viewModel).toContain("await withTaskCancellationHandler {");
    expect(viewModel).toContain("await task.value");
    expect(viewModel).toMatch(/onCancel:\s*\{[\s\S]*?task\.cancel\(\)/);
    expect(viewModel).toContain(
      "APIClient.shared.allCalendarEvents(includePast: requestedIncludePast)",
    );
    expect(viewModel).toContain(
      "APIClient.shared.allMyShifts()",
    );
    expect(viewModel).toContain(
      "guard loadRequests.owns(requestToken), !Task.isCancelled else { return }",
    );
    expect(viewModel).toContain("if loadRequests.owns(requestToken) {");

    const errorHandler = viewModel.slice(viewModel.indexOf("} catch is CancellationError"));
    expect(errorHandler).toContain(
      "guard loadRequests.owns(requestToken), !Task.isCancelled else { return }",
    );

    const cancellation = viewModel.slice(
      viewModel.indexOf("func cancelLoad"),
      viewModel.indexOf("private func performLoad"),
    );
    expect(cancellation).toContain("loadTask?.cancel()");
    expect(cancellation).toContain("loadTask = nil");
    expect(cancellation).toContain("loadRequests.invalidate()");
    expect(cancellation).toContain("isLoading = false");

    const performLoad = viewModel.slice(
      viewModel.indexOf("private func performLoad"),
      viewModel.indexOf("// MARK: - HomeAwayFilter"),
    );
    const publishGuard =
      "guard loadRequests.owns(requestToken), !Task.isCancelled else { return }";
    expect(performLoad.indexOf(publishGuard)).toBeLessThan(
      performLoad.indexOf("events = fetchedEvents"),
    );
    expect(performLoad.indexOf(publishGuard)).toBeLessThan(
      performLoad.indexOf("GearStore.shared.seedScheduleEvents(fetchedEvents)"),
    );

    expect(schedule).toContain(".onDisappear { vm.cancelLoad() }");
    expect(schedule).toMatch(
      /\.onChange\(of: session\.currentUser\?\.id\)[\s\S]*?if userId == nil \{[\s\S]*?vm\.cancelLoad\(\)/,
    );
  });

  it("ignores a late 401 that belongs to an older authenticated account", () => {
    const api = source("ios/Wisconsin/Core/APIClient.swift");
    const session = source("ios/Wisconsin/Core/SessionStore.swift");
    const ownership = source("ios/Wisconsin/Shared/LatestRequestGeneration.swift");

    expect(ownership).toContain("final class AuthSessionBoundary");
    expect(ownership).toContain("let authSessionBoundary = AuthSessionBoundary()");
    expect(api).toContain("let requestBoundary = authSessionBoundary.capture()");
    expect(api).toContain("broadcastSessionExpiry(for: requestBoundary)");
    expect(api).toContain("object: requestBoundary");
    expect(api).not.toContain(
      "NotificationCenter.default.post(name: .sessionDidExpire, object: nil)",
    );
    expect(session).toContain("notification.object as? UUID");
    expect(session).toContain("authSessionBoundary.owns(requestBoundary)");
    expect(session).toContain("authSessionBoundary.advance()");
    expect(session).toMatch(
      /private func publishCurrentUserIfChanged[\s\S]*?currentUser\?\.id != user\.id[\s\S]*?authSessionBoundary\.advance\(\)/,
    );
  });
});
