import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

describe("iOS system hardening contracts", () => {
  it("requires local device authentication before private App Intents run", () => {
    const appIntents = source("ios/Wisconsin/App/AppIntentsData.swift");
    const bookingEntity = source("ios/Wisconsin/App/BookingEntity.swift");

    for (const intent of ["MyCheckedOutGearIntent", "NextShiftIntent"]) {
      const start = appIntents.indexOf(`struct ${intent}: AppIntent`);
      const nextIntent = appIntents.indexOf("struct ", start + 1);
      const body = appIntents.slice(start, nextIntent === -1 ? undefined : nextIntent);
      expect(body).toContain(
        "static let authenticationPolicy: IntentAuthenticationPolicy = .requiresLocalDeviceAuthentication",
      );
    }
    expect(bookingEntity).toContain(
      "static let authenticationPolicy: IntentAuthenticationPolicy = .requiresLocalDeviceAuthentication",
    );
  });

  it("never trusts a persisted API host outside the production allowlist", () => {
    const environment = source("ios/Wisconsin/Shared/AppEnvironment.swift");

    expect(environment).toContain(
      "private static let allowedAPIHosts: Set<String> = [canonicalHost, appReviewHost]",
    );
    expect(environment).toContain("allowedAPIHosts.contains(storedHost)");
    expect(environment).toContain("guard allowedAPIHosts.contains(host)");
    expect(environment).toContain('URL(string: "https://\\(activeAPIHost)") ?? baseURL');
  });

  it("falls back to an in-memory SwiftData cache instead of crashing on store corruption", () => {
    const gearStore = source("ios/Wisconsin/Core/GearStore.swift");

    expect(gearStore).not.toContain("try! ModelContainer");
    expect(gearStore).toContain("isStoredInMemoryOnly: true");
    expect(gearStore).toContain("Persistent SwiftData cache unavailable");
  });

  it("blocks delayed APNs callbacks and removes user notification state on sign-out", () => {
    const delegate = source("ios/Wisconsin/App/AppDelegate.swift");
    const appState = source("ios/Wisconsin/Core/AppState.swift");
    const app = source("ios/Wisconsin/App/WisconsinApp.swift");
    const signedOutHandler = app.slice(
      app.indexOf("private func handleCurrentUserChange"),
      app.indexOf("private func handleScenePhaseChange"),
    );
    const failedRegistration = delegate.slice(
      delegate.indexOf("didFailToRegisterForRemoteNotificationsWithError"),
      delegate.indexOf("static let staleDeliveredNotificationAge"),
    );
    const foregroundPresentation = delegate.slice(
      delegate.indexOf("willPresent notification: UNNotification"),
      delegate.indexOf("didReceive response: UNNotificationResponse"),
    );
    const notificationRouting = delegate.slice(
      delegate.indexOf("didReceive response: UNNotificationResponse"),
    );

    expect(delegate).toContain("guard PushTokenStorage.registrationAllowed else { return }");
    expect(delegate).toContain("pushCredentialMutations.enqueue");
    expect(delegate).toContain("static func clearRemoteNotificationsForSignedOutUser()");
    expect(delegate).toContain("UIApplication.shared.unregisterForRemoteNotifications()");
    expect(delegate).toContain("center.removeAllDeliveredNotifications()");
    expect(delegate).toContain("center.removeAllPendingNotificationRequests()");
    expect(failedRegistration).toContain(
      "guard PushTokenStorage.registrationAllowed else { return }",
    );
    expect(foregroundPresentation).toContain("guard PushTokenStorage.registrationAllowed else");
    expect(foregroundPresentation).toContain("completionHandler([])");
    expect(notificationRouting).toContain("guard PushTokenStorage.registrationAllowed else");
    expect(notificationRouting).toMatch(/completionHandler\(\)\s+return/);
    expect(notificationRouting).toContain(
      "let notificationBoundary = authSessionBoundary.capture()",
    );
    // Every branch that resumes on the main actor must re-check the boundary,
    // or a notification delivered before a sign-out can route into the
    // replacement account's shell. Counted against the branches themselves
    // rather than a fixed number, so adding a branch cannot quietly skip the
    // check. The snooze branch is deliberately not one of these: it is a plain
    // `Task`, touches no session state, and never routes.
    const mainActorBranches =
      notificationRouting.match(/Task \{ @MainActor in/g)?.length ?? 0;
    expect(mainActorBranches).toBeGreaterThanOrEqual(3);
    expect(
      notificationRouting.match(/authSessionBoundary\.owns\(notificationBoundary\)/g),
    ).toHaveLength(mainActorBranches);
    expect(appState).toContain("PushTokenStorage.registrationAllowed = true");
    expect(app).toContain("AppDelegate.clearRemoteNotificationsForSignedOutUser()");
    expect(signedOutHandler).not.toContain(
      "Task { await AppDelegate.clearRemoteNotificationsForSignedOutUser() }",
    );
    expect(source("ios/Wisconsin/Core/SessionStore.swift")).toContain(
      "let pushCleanup = pushCredentialMutations.enqueue",
    );
  });

  it("binds notification permission awaits and the soft prompt to one signed-in identity", () => {
    const app = source("ios/Wisconsin/App/WisconsinApp.swift");
    const prompt = source("ios/Wisconsin/Views/PushPrePromptView.swift");

    expect(app).toContain("registerForPushIfAuthorized(");
    expect(app).toContain("userId: String,");
    expect(app).toContain("sessionBoundary: UUID");
    expect(app).toContain("session.currentUser?.id == userId");
    expect(app).toContain("authSessionBoundary.owns(sessionBoundary)");
    expect(app).toContain("maybeShowPushPrompt(");
    expect(app).toMatch(
      /Task\.sleep\(for: \.milliseconds\(600\)\)[\s\S]*?session\.currentUser\?\.id == userId[\s\S]*?authSessionBoundary\.owns\(sessionBoundary\)[\s\S]*?showPushPrePrompt = true/,
    );
    expect(prompt).toContain("@Environment(SessionStore.self) private var session");
    expect(prompt).toContain("let sessionBoundary = authSessionBoundary.capture()");
    expect(prompt).toContain("session.currentUser?.id == userId");
    expect(prompt).toContain("authSessionBoundary.owns(sessionBoundary)");
    expect(prompt).toContain("PushTokenStorage.registrationAllowed");
  });

  it("synchronously clears all app-shell state at a session boundary", () => {
    const appState = source("ios/Wisconsin/Core/AppState.swift");
    const app = source("ios/Wisconsin/App/WisconsinApp.swift");
    const reset = appState.slice(
      appState.indexOf("func resetForSessionBoundary()"),
      appState.indexOf("\n    func selectTab", appState.indexOf("func resetForSessionBoundary()")),
    );
    const signedOutHandler = app.slice(
      app.indexOf("private func handleCurrentUserChange"),
      app.indexOf("private func handleScenePhaseChange"),
    );

    for (const count of [
      "overdueCount",
      "myShiftCount",
      "myShiftTodayCount",
      "unreadNotifCount",
      "openTradeCount",
    ]) {
      expect(reset).toContain(`${count} = 0`);
    }
    for (const pending of [
      "pendingPushBookingId",
      "pendingPushEventId",
      "pendingPushBlastId",
      "pendingAppIntentDestination",
      "pendingBookingsScope",
      "pendingBookingDetailId",
      "resetTab",
    ]) {
      expect(reset).toContain(`${pending} = nil`);
    }
    expect(reset).toContain("selectedTab = 0");
    expect(reset).toContain("tabResetToken = 0");
    expect(reset).toContain("pushRegistrationState = .unknown");
    expect(reset).toContain("refreshRequests.invalidate()");
    expect(reset).toContain("unreadRefreshRequests.invalidate()");
    expect(reset).toContain("isRefreshing = false");
    expect(reset).toContain("lastRefreshAttemptAt = nil");
    expect(appState).toContain(
      "guard refreshRequests.owns(requestToken), !Task.isCancelled else { return }",
    );
    expect(appState).toContain(
      "guard unreadRefreshRequests.owns(requestToken), !Task.isCancelled else { return }",
    );
    expect(signedOutHandler).toContain(
      "let authenticatedIdentityChanged = oldUser != nil && oldUser?.id != user?.id",
    );
    expect(signedOutHandler).toContain("if user == nil || authenticatedIdentityChanged");
    expect(signedOutHandler.indexOf("appState.resetForSessionBoundary()")).toBeLessThan(
      signedOutHandler.indexOf("AppDelegate.clearRemoteNotificationsForSignedOutUser()"),
    );
    expect(app).toContain("PasswordSetupView(email: user.email)\n                    .id(user.id)");
    expect(app).toContain("ProfileCompletionWelcomeView()");
    expect(app).toContain("if user.isReadOnlyRolePreview");
    expect(app).toContain("AppTabView()\n                        .id(user.shellIdentity)");
  });

  it("cancels session-owned Live Activity observers and serializes guarded token writes", () => {
    const manager = source(
      "ios/Wisconsin/LiveActivities/CheckoutReturnLiveActivityManager.swift",
    );
    const app = source("ios/Wisconsin/App/WisconsinApp.swift");
    const cancel = manager.slice(
      manager.indexOf("func cancelObserverWork()"),
      manager.indexOf("\n    func endAll()", manager.indexOf("func cancelObserverWork()")),
    );
    const signedOutHandler = app.slice(
      app.indexOf("private func handleCurrentUserChange"),
      app.indexOf("private func handleScenePhaseChange"),
    );

    expect(manager).toContain(
      "private var pushToStartObserverTask: Task<Void, Never>?",
    );
    expect(manager).toContain(
      "private var activityUpdatesObserverTask: Task<Void, Never>?",
    );
    expect(manager).toContain(
      "private var activityPushTokenObserverTasks: [String: Task<Void, Never>]",
    );
    expect(manager).toContain("private var observerGeneration = LatestRequestGeneration()");
    expect(cancel).toContain("observerGeneration.invalidate()");
    expect(cancel).toContain("pushToStartObserverTask?.cancel()");
    expect(cancel).toContain("activityUpdatesObserverTask?.cancel()");
    expect(cancel).toContain("for task in activityPushTokenObserverTasks.values");
    expect(cancel).toContain("task.cancel()");
    expect(manager).toContain(
      "PushTokenStorage.registrationAllowed && observerGeneration.owns(generation)",
    );
    expect(manager).toContain("pushCredentialMutations.enqueue");
    expect(manager).toContain("guard let self, self.ownsObserverGeneration(generation)");
    expect(signedOutHandler.indexOf("cancelObserverWork()")).toBeLessThan(
      signedOutHandler.indexOf("CheckoutReturnLiveActivityManager.shared.endAll()"),
    );
  });

  it("bounds every native push and Live Activity credential at the API boundary", () => {
    const devices = source("src/app/api/devices/route.ts");
    const activity = source("src/app/api/live-activities/checkout-return/route.ts");
    const startToken = source("src/app/api/live-activities/checkout-return/start-token/route.ts");

    expect(devices).toContain("apnsTokenSchema.safeParse(body.token).success");
    expect(devices).toContain("MAX_ACTIVE_DEVICE_TOKENS_PER_USER = 8");
    expect(activity).toContain("bookingId: z.string().min(1).max(128)");
    expect(activity).toContain("token: apnsTokenSchema");
    expect(activity).toContain("MAX_ACTIVE_TOKENS_PER_BOOKING = 4");
    expect(startToken).toContain("token: apnsTokenSchema");
    expect(startToken).toContain("MAX_ACTIVE_START_TOKENS_PER_USER = 8");
    for (const route of [devices, activity, startToken]) {
      expect(route).toContain("select: { active: true }");
      expect(route).toContain("Prisma.TransactionIsolationLevel.Serializable");
      expect(route).toContain("SETTINGS_MUTATION_LIMIT");
    }
  });

  it("clears account-scoped search and image caches when the session ends", () => {
    const app = source("ios/Wisconsin/App/WisconsinApp.swift");
    const search = source("ios/Wisconsin/Views/Search/GlobalSearchSheet.swift");
    const thumbnails = source("ios/Wisconsin/Core/ThumbnailLoader.swift");

    expect(app).toContain("SearchRecentsStorage.clear()");
    expect(app).toContain("ThumbnailCache.shared.clearForSignOut()");
    expect(search).toContain("enum SearchRecentsStorage");
    expect(thumbnails).toContain("thumbnailURLCache.removeAllCachedResponses()");
  });

  it("covers the entire scene window before iOS captures an inactive app snapshot", () => {
    const app = source("ios/Wisconsin/App/WisconsinApp.swift");

    expect(app).toContain("WindowPrivacyShieldHost(isSceneActive: scenePhase == .active)");
    expect(app).toContain("private weak var window: UIWindow?");
    expect(app).toContain("UIScene.willDeactivateNotification");
    expect(app).toContain("UIScene.didEnterBackgroundNotification");
    expect(app).toContain("UIScene.didActivateNotification");
    expect(app).toContain('UIImage(systemName: "lock.shield.fill")');
    expect(app).toContain("window.addSubview(shieldView)");
    expect(app).toContain("window.bringSubviewToFront(shieldView)");
    expect(app).not.toContain("private struct AppPrivacyShield: View");
  });

  it("keeps kiosk credentials on one device and has one cold-launch owner", () => {
    const store = source("ios/Wisconsin/Kiosk/KioskStore.swift");
    const app = source("ios/Wisconsin/KioskOnly/KioskOnlyApp.swift");
    const api = source("ios/Wisconsin/Kiosk/KioskAPIClient.swift");

    expect(store).toContain("kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly");
    expect(store).not.toContain("kSecAttrAccessibleAfterFirstUnlock,");
    expect(app).not.toContain("kioskStore.enterKiosk()");
    expect(api).not.toContain("String(cString: machine)");
    expect(api).toContain("String(decoding: bytes, as: UTF8.self)");
  });

  it("requests only open checkout custody for private intent and Live Activity surfaces", () => {
    const intent = source("ios/Wisconsin/App/AppIntentsData.swift");
    const activities = source("ios/Wisconsin/LiveActivities/CheckoutReturnLiveActivityManager.swift");
    const api = source("ios/Wisconsin/Core/APIClient.swift");

    expect(api).toContain("status: BookingStatus? = nil");
    expect(intent).toContain(".checkouts(activeOnly: false, status: .open");
    expect(activities).toContain(".checkouts(activeOnly: false, status: .open");
  });
});
