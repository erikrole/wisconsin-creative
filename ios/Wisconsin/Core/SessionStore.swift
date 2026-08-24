import SwiftUI
import os

private let sessionPerformanceLog = Logger(subsystem: "com.erikrole.Wisconsin", category: "Launch")

private func elapsedMilliseconds(since start: Date) -> Int {
    Int(Date().timeIntervalSince(start) * 1_000)
}

/// A lightweight cache of the last authenticated user, stored in UserDefaults.
/// It lets the app draw the correct shell (tab bar + Home's own skeleton) on
/// the next cold launch without first blocking on the `/me` round-trip. The
/// auth **cookie** in `HTTPCookieStorage` remains the real credential and
/// source of truth; this snapshot is only a UI hint and never gates access.
/// `restoreSession()` revalidates on every launch and clears this on a
/// confirmed 401, so a revoked session bounces to Login.
private enum SessionSnapshot {
    private static let key = "WisconsinSessionSnapshot"

    static func load() -> CurrentUser? {
        guard let data = UserDefaults.standard.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(CurrentUser.self, from: data)
    }

    static func save(_ user: CurrentUser) {
        guard let data = try? JSONEncoder().encode(user) else { return }
        UserDefaults.standard.set(data, forKey: key)
    }

    static func clear() {
        UserDefaults.standard.removeObject(forKey: key)
    }
}

@MainActor
@Observable
final class SessionStore {
    var currentUser: CurrentUser?
    var isLoading = false
    var isRestoring = true
    var error: String?
    var isOffline = false
    private(set) var isInitialSessionValidationInFlight = true

    /// True when this launch optimistically seeded `currentUser` from a stored
    /// snapshot, so the app shell rendered before `/me` confirmed the session.
    private var didSeedFromSnapshot = false
    private var authRequests = LatestRequestGeneration()
    private let authMutations = AuthMutationQueue()

    var usedOptimisticSessionSnapshot: Bool { didSeedFromSnapshot }

    init() {
        if AppRuntimeMode.isPerformanceTesting {
            isRestoring = false
            isInitialSessionValidationInFlight = false
        }
        // Optimistic launch: if the last session left a snapshot, render the
        // app shell immediately (Home shows its own skeleton while fresh data
        // loads) instead of blocking the entire UI on the /me round-trip. No
        // cached *content* is shown — only the shell and the device owner's own
        // identity. `restoreSession()` validates in the background and bounces
        // to Login on a confirmed 401. Users mid forced-password-change take
        // the strict path so they can't slip past that gate.
        if !AppRuntimeMode.isPerformanceTesting,
           let snapshot = SessionSnapshot.load(),
           !snapshot.forcePasswordChange {
            currentUser = snapshot
            isRestoring = false
            didSeedFromSnapshot = true
        }
        if !AppRuntimeMode.isPerformanceTesting {
            let restoreToken = authRequests.begin()
            Task { await restoreSession(requestToken: restoreToken) }
        }
        // Listen for global 401s posted from APIClient and route the user back to login.
        NotificationCenter.default.addObserver(
            forName: .sessionDidExpire,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            let requestBoundary = notification.object as? UUID
            Task { @MainActor in
                guard let self,
                      let requestBoundary,
                      authSessionBoundary.owns(requestBoundary),
                      self.currentUser != nil else { return }
                authSessionBoundary.advance()
                self.authRequests.invalidate()
                self.isRestoring = false
                self.isInitialSessionValidationInFlight = false
                self.didSeedFromSnapshot = false
                self.currentUser = nil
                SessionSnapshot.clear()
                self.error = "Your session expired — please sign in again."
            }
        }
        NotificationCenter.default.addObserver(
            forName: .collaboratorPolicyMayHaveChanged,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in await self?.refreshCurrentUser() }
        }
    }

    func login(email: String, password: String) async {
        let mutation = authMutations.enqueue { [weak self] in
            guard let self else { return }
            let requestToken = self.authRequests.begin()
            self.isLoading = true
            self.error = nil
            do {
                let user = try await APIClient.shared.login(email: email, password: password)
                guard self.authRequests.owns(requestToken) else { return }
                self.didSeedFromSnapshot = false
                self.publishCurrentUserIfChanged(user)
            } catch {
                guard self.authRequests.owns(requestToken) else { return }
                self.error = error.localizedDescription
            }
            if self.authRequests.owns(requestToken) { self.isLoading = false }
        }
        await mutation.value
    }

    func register(name: String, email: String, password: String) async {
        let mutation = authMutations.enqueue { [weak self] in
            guard let self else { return }
            let requestToken = self.authRequests.begin()
            self.isLoading = true
            self.error = nil
            do {
                let user = try await APIClient.shared.register(name: name, email: email, password: password)
                guard self.authRequests.owns(requestToken) else { return }
                self.didSeedFromSnapshot = false
                self.publishCurrentUserIfChanged(user)
                self.isOffline = false
            } catch {
                guard self.authRequests.owns(requestToken) else { return }
                self.error = error.localizedDescription
            }
            if self.authRequests.owns(requestToken) { self.isLoading = false }
        }
        await mutation.value
    }

    func loginWithPasskey() async {
        let mutation = authMutations.enqueue { [weak self] in
            guard let self else { return }
            let requestToken = self.authRequests.begin()
            self.isLoading = true
            self.error = nil
            do {
                let options = try await APIClient.shared.passkeyAuthenticationOptions()
                let assertion = try await PasskeyService.shared.authenticate(options: options)
                let user = try await APIClient.shared.verifyPasskeyAuthentication(assertion)
                guard self.authRequests.owns(requestToken) else { return }
                self.didSeedFromSnapshot = false
                self.publishCurrentUserIfChanged(user)
                self.isOffline = false
            } catch PasskeyServiceError.cancelled {
                // Dismissing the system sheet is a choice, not a failure.
            } catch {
                guard self.authRequests.owns(requestToken) else { return }
                self.error = error.localizedDescription
            }
            if self.authRequests.owns(requestToken) { self.isLoading = false }
        }
        await mutation.value
    }

    /// Arms Apple's AutoFill passkey suggestion above the keyboard while the
    /// sign-in screen is open. Deliberately passive: nothing shows as loading
    /// and no failure surfaces until a passkey is actually chosen, because most
    /// visits to this screen never touch the suggestion. Cancelling the calling
    /// task withdraws the armed request.
    func armPasskeyAutoFill() async {
        guard currentUser == nil else { return }
        do {
            let options = try await APIClient.shared.passkeyAuthenticationOptions()
            try Task.checkCancellation()
            let assertion = try await PasskeyService.shared.authenticate(
                options: options,
                presentation: .autoFill
            )
            guard !Task.isCancelled else { return }
            await completePasskeySignIn(assertion)
        } catch {
            // A withdrawn suggestion, a device without passkeys, and offline
            // arming are all routine on this path.
        }
    }

    /// Exchanges an assertion that AutoFill already produced for the shared
    /// session, on the same queue and generation guard as every other sign-in.
    private func completePasskeySignIn(_ assertion: PasskeyAssertionPayload) async {
        let mutation = authMutations.enqueue { [weak self] in
            guard let self else { return }
            let requestToken = self.authRequests.begin()
            self.isLoading = true
            self.error = nil
            do {
                let user = try await APIClient.shared.verifyPasskeyAuthentication(assertion)
                guard self.authRequests.owns(requestToken) else { return }
                self.didSeedFromSnapshot = false
                self.publishCurrentUserIfChanged(user)
                self.isOffline = false
            } catch {
                guard self.authRequests.owns(requestToken) else { return }
                self.error = error.localizedDescription
            }
            if self.authRequests.owns(requestToken) { self.isLoading = false }
        }
        await mutation.value
    }

    func completeForcedPasswordChange(currentPassword: String, newPassword: String) async {
        let mutation = authMutations.enqueue { [weak self] in
            guard let self else { return }
            let requestToken = self.authRequests.begin()
            self.isLoading = true
            self.error = nil
            do {
                try await APIClient.shared.changePassword(
                    currentPassword: currentPassword,
                    newPassword: newPassword,
                    revokeOtherSessions: true
                )
                let user = try await APIClient.shared.me()
                guard self.authRequests.owns(requestToken) else { return }
                self.didSeedFromSnapshot = false
                self.publishCurrentUserIfChanged(user)
                self.isOffline = false
            } catch {
                guard self.authRequests.owns(requestToken) else { return }
                self.error = error.localizedDescription
            }
            if self.authRequests.owns(requestToken) { self.isLoading = false }
        }
        await mutation.value
    }

    func logout() async {
        // Best-effort: a stuck server must not strand the user signed in.
        // Clear UI state before suspending, and invalidate any in-flight `/me`
        // request so it cannot repopulate the signed-out shell afterward.
        authRequests.invalidate()
        authSessionBoundary.advance()
        SessionSnapshot.clear()
        didSeedFromSnapshot = false
        isInitialSessionValidationInFlight = false
        currentUser = nil
        isLoading = false
        isRestoring = false
        PushTokenStorage.registrationAllowed = false
        let pushCleanup = pushCredentialMutations.enqueue {
            try? await APIClient.shared.revokeAllDeviceTokens()
            try? await APIClient.shared.revokeCheckoutReturnLiveActivityStartTokens()
        }
        let mutation = authMutations.enqueue {
            await pushCleanup.value
            try? await APIClient.shared.logout()
        }
        await mutation.value
    }

    func clearDeletedAccountLocally() async {
        authRequests.invalidate()
        authSessionBoundary.advance()
        SessionSnapshot.clear()
        didSeedFromSnapshot = false
        isInitialSessionValidationInFlight = false
        currentUser = nil
        isLoading = false
        isRestoring = false
        PushTokenStorage.registrationAllowed = false
        let mutation = authMutations.enqueue {
            try? await APIClient.shared.logout()
        }
        await mutation.value
    }

    /// Clear a stale auth error — call from views when the user starts typing again.
    func clearError() {
        if error != nil { error = nil }
    }

    func refreshCurrentUser() async {
        guard currentUser != nil, !isInitialSessionValidationInFlight else { return }
        let requestToken = authRequests.begin()
        do {
            let user = try await APIClient.shared.me()
            guard authRequests.owns(requestToken) else { return }
            publishCurrentUserIfChanged(user)
            isOffline = false
            error = nil
        } catch APIError.unauthorized {
            guard authRequests.owns(requestToken) else { return }
            authSessionBoundary.advance()
            authRequests.invalidate()
            SessionSnapshot.clear()
            currentUser = nil
        } catch {
            guard authRequests.owns(requestToken) else { return }
            self.error = error.localizedDescription
        }
    }

    private func restoreSession(requestToken: UUID) async {
        let startedAt = Date()
        let signpost = AppPerformanceSignposts.begin("SessionValidation")
        let optimistic = didSeedFromSnapshot
        var result = "superseded"
        defer {
            AppPerformanceSignposts.end("SessionValidation", signpost)
            isInitialSessionValidationInFlight = false
            if authRequests.owns(requestToken) { isRestoring = false }
            // Distinguish the optimistic path (shell already shown) from a cold
            // blocking restore so launch timings stay comparable in Console.
            let phase = optimistic ? "launch.session.optimistic" : "launch.session.restore"
            sessionPerformanceLog.info("\(phase, privacy: .public) result=\(result, privacy: .public) durationMs=\(elapsedMilliseconds(since: startedAt), privacy: .public)")
        }
        do {
            let user = try await APIClient.shared.me()
            guard authRequests.owns(requestToken) else {
                result = "superseded"
                return
            }
            publishCurrentUserIfChanged(user)
            isOffline = false
            result = "authenticated"
        } catch APIError.unauthorized {
            guard authRequests.owns(requestToken) else {
                result = "superseded"
                return
            }
            // Confirmed revoked/expired session — drop the optimistic shell and
            // send the user to Login.
            authSessionBoundary.advance()
            authRequests.invalidate()
            isRestoring = false
            SessionSnapshot.clear()
            currentUser = nil
            result = "unauthorized"
        } catch {
            guard authRequests.owns(requestToken) else {
                result = "superseded"
                return
            }
            // Network failure — don't clear session state; keep any optimistic
            // session and let the user retry.
            isOffline = true
            result = optimistic ? "offline-optimistic" : "offline"
        }
    }

    private func publishCurrentUserIfChanged(_ user: CurrentUser) {
        if currentUser?.id != user.id {
            authSessionBoundary.advance()
        }
        if currentUser != user {
            currentUser = user
        }
        SessionSnapshot.save(user)
    }
}
