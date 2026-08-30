import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(path, "utf8");

describe("iOS asynchronous request ownership", () => {
  it("prevents a stale session restore from repopulating local auth state", () => {
    const session = source("ios/Wisconsin/Core/SessionStore.swift");

    expect(session).toContain("private var authRequests = LatestRequestGeneration()");
    expect(session).toContain("private let authMutations = AuthMutationQueue()");
    expect(session).toContain("restoreSession(requestToken: restoreToken)");
    expect(session).toContain("guard authRequests.owns(requestToken) else { return }");
    expect(session).toContain("let requestBoundary = notification.object as? UUID");
    expect(session).toMatch(
      /guard let self,\s*let requestBoundary,\s*authSessionBoundary\.owns\(requestBoundary\),\s*self\.currentUser != nil else \{ return \}/,
    );
    expect(session).toMatch(/func login\(email: String, password: String\) async \{[\s\S]*?authMutations\.enqueue[\s\S]*?APIClient\.shared\.login[\s\S]*?await mutation\.value/);
    expect(session).toMatch(/func logout\(\) async \{[\s\S]*?authRequests\.invalidate\(\)[\s\S]*?currentUser = nil[\s\S]*?authMutations\.enqueue[\s\S]*?APIClient\.shared\.logout\(\)[\s\S]*?await mutation\.value/);
    const logout = session.slice(session.indexOf("func logout() async"), session.indexOf("func clearDeletedAccountLocally() async"));
    expect(logout).toMatch(/authRequests\.invalidate\(\)[\s\S]*?authSessionBoundary\.advance\(\)[\s\S]*?currentUser = nil/);
    expect(logout).toContain("let pushCleanup = pushCredentialMutations.enqueue");
    expect(logout).toMatch(/let mutation = authMutations\.enqueue \{\s*await pushCleanup\.value\s*try\? await APIClient\.shared\.logout\(\)\s*\}/);
  });

  it("rejects successful responses from an obsolete authenticated account", () => {
    const apiClient = source("ios/Wisconsin/Core/APIClient.swift");
    const authenticatedData = apiClient.slice(
      apiClient.indexOf("private func authenticatedData"),
      apiClient.indexOf("private func broadcastSessionExpiry"),
    );
    const perform = apiClient.slice(apiClient.indexOf("private func perform"));

    expect(authenticatedData).toMatch(
      /let requestBoundary = authSessionBoundary\.capture\(\)[\s\S]*?session\.data\(for: request\)[\s\S]*?guard authSessionBoundary\.owns\(requestBoundary\) else \{\s*throw APIError\.sessionChanged\s*\}/,
    );
    expect(perform).toMatch(/catch let error as APIError \{\s*throw error\s*\}/);
  });

  it.each([
    ["Items", "ios/Wisconsin/Views/ItemsView.swift"],
    ["Bookings", "ios/Wisconsin/Views/BookingsView.swift"],
  ])("lets only the newest %s load mutate shared list state", (_name, path) => {
    const view = source(path);

    expect(view).toContain("private var loadRequests = LatestRequestGeneration()");
    expect(view).toContain("let requestToken = loadRequests.begin()");
    expect(view).toContain("guard loadRequests.owns(requestToken), !Task.isCancelled else { return }");
    expect(view).toContain("if loadRequests.owns(requestToken) { isLoading = false }");
    expect(view).not.toContain("if Task.isCancelled { isLoading = false; return }");
  });

  it.each([
    ["Home", "ios/Wisconsin/Views/HomeView.swift", "loadRequests"],
    ["Notifications", "ios/Wisconsin/Views/NotificationsSheet.swift", "loadRequests"],
    ["Event Detail", "ios/Wisconsin/Views/EventDetailSheet.swift", "loadRequests"],
    ["Trade Board", "ios/Wisconsin/Views/Schedule/TradeBoardSheet.swift", "tradeRequests"],
    ["Overdue", "ios/Wisconsin/Views/OverdueReportView.swift", "loadRequests"],
  ])("lets an explicit refresh supersede an in-flight %s load", (_name, path, generation) => {
    const view = source(path);

    expect(view).toContain(`LatestRequestGeneration`);
    expect(view).toContain(`let requestToken = ${generation}.begin()`);
    expect(view).toContain(`${generation}.owns(requestToken)`);
    expect(view).toContain("!Task.isCancelled");
    expect(view).toMatch(/\.refreshable[\s\S]*?forceRefresh: true/);
  });

  it("keys kiosk availability and completes against its own preflight response", () => {
    const checkout = source("ios/Wisconsin/Kiosk/KioskCheckoutView.swift");

    expect(checkout).toContain("@State private var availabilityRequests = LatestRequestGeneration()");
    expect(checkout).toContain("let requestToken = availabilityRequests.begin()");
    expect(checkout).toContain("guard availabilityRequests.owns(requestToken) else { return nil }");
    expect(checkout).toContain("guard let preflight = await refreshAvailability(for: cart, endsAt: endsAt)");
    expect(checkout).toContain("guard !preflight.hasBlockingIssue else");
  });
});
