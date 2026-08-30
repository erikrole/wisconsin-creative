import AppKit
import Foundation
import Observation

enum KioskAccessState: String, Codable, Equatable, Sendable {
    case unknown
    case available
    case restricted
    case failed
}

private struct GearOpsCachedState: Codable {
    private static let maxOpenBookings = 1_000
    private static let maxBookingActivity = 2_000
    private static let maxKioskDevices = 256
    private static let maxCount = 1_000_000

    let user: GearOpsUser
    let snapshot: GearOpsSnapshot?
    let openBookings: [OpenBooking]?
    let openBookingTotal: Int?
    let activeBookingActivity: [BookingActivitySnapshot]?
    let kioskDevices: [KioskDevice]?
    let kioskAccess: KioskAccessState?

    var isTrustworthy: Bool {
        guard !user.id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              openBookingTotal.map({ $0 >= 0 }) ?? true,
              openBookings.map({ $0.count <= Self.maxOpenBookings }) ?? true,
              activeBookingActivity.map({ $0.count <= Self.maxBookingActivity }) ?? true,
              kioskDevices.map({ $0.count <= Self.maxKioskDevices }) ?? true,
              openBookings.map({ Self.hasUniqueNonemptyIDs($0.map(\.id)) }) ?? true,
              activeBookingActivity.map({ Self.hasUniqueNonemptyIDs($0.map(\.id)) }) ?? true,
              kioskDevices.map({ Self.hasUniqueNonemptyIDs($0.map(\.id)) }) ?? true,
              kioskDevices?.allSatisfy({
                  $0.pendingPickupCount >= 0 && $0.pendingPickupCount <= Self.maxCount
                      && $0.openCheckoutCount >= 0 && $0.openCheckoutCount <= Self.maxCount
              }) ?? true else {
            return false
        }

        guard let snapshot else { return true }
        return snapshot.stats.checkedOut >= 0
            && snapshot.stats.checkedOut <= Self.maxCount
            && snapshot.stats.overdue >= 0
            && snapshot.stats.overdue <= Self.maxCount
            && snapshot.stats.reserved >= 0
            && snapshot.stats.reserved <= Self.maxCount
            && snapshot.stats.dueToday >= 0
            && snapshot.stats.dueToday <= Self.maxCount
            && snapshot.pendingPickupTotal >= 0
            && snapshot.pendingPickupTotal <= Self.maxCount
    }

    private static func hasUniqueNonemptyIDs(_ ids: [String]) -> Bool {
        ids.allSatisfy { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
            && Set(ids).count == ids.count
    }
}

@MainActor
@Observable
final class GearOpsModel {
    private static let cacheKey = "GearOpsCachedStateV1"

    private let client: any GearOpsServing
    private let defaults: UserDefaults
    private let bookingNotifications: any BookingNotificationDelivering
    private let credentialStore: any CompanionCredentialStoring
    let notificationSettings: NotificationSettingsStore
    let appPreferences: AppPreferencesStore
    private var companionToken: String?
    private var currentDeviceToken: String?
    private var registeredDeviceCredential: String?
    private var sessionGeneration: UInt64 = 0
    private var installedProjection: CompanionProjection?
    private var refreshQueued = false
    private var pushTask: Task<Void, Never>?
    private var startupTask: Task<Void, Never>?
    private var supplementaryTask: Task<Void, Never>?
    private var restoreInFlight = false
    private var restoreQueued = false
    private var awaitingCredentialUnlock = false
    private var knownBookingActivity: [String: BookingActivitySnapshot] = [:]

    var user: GearOpsUser?
    var snapshot: GearOpsSnapshot?
    var openBookings: [OpenBooking] = []
    var openBookingTotal: Int?
    var activeBookingActivity: [BookingActivitySnapshot] = []
    var kioskDevices: [KioskDevice] = []
    var kioskAccess: KioskAccessState = .unknown
    var isRestoring = true
    var isSigningIn = false
    var isSigningOut = false
    var isRefreshing = false
    var statusMessage: String?
    var countDataIsPartial = false
    var notificationAuthorization: BookingNotificationAuthorization = .unknown

    init(
        client: any GearOpsServing = GearOpsClient(),
        defaults: UserDefaults = .standard,
        bookingNotifications: any BookingNotificationDelivering = BookingNotificationCenter(),
        credentialStore: any CompanionCredentialStoring = CompanionCredentialStore(),
        notificationSettings: NotificationSettingsStore? = nil,
        appPreferences: AppPreferencesStore? = nil,
        autoStart: Bool = true
    ) {
        self.client = client
        self.defaults = defaults
        self.bookingNotifications = bookingNotifications
        self.credentialStore = credentialStore
        self.notificationSettings = notificationSettings ?? NotificationSettingsStore(defaults: defaults)
        self.appPreferences = appPreferences ?? AppPreferencesStore(defaults: defaults)

        if let data = defaults.data(forKey: Self.cacheKey),
           let cached = try? JSONDecoder().decode(GearOpsCachedState.self, from: data),
           cached.isTrustworthy {
            user = cached.user
            snapshot = cached.snapshot
            openBookings = cached.openBookings ?? []
            openBookingTotal = cached.openBookingTotal
            activeBookingActivity = (cached.activeBookingActivity ?? [])
                .sorted(using: KeyPathComparator(\.startsAt))
            kioskDevices = cached.kioskDevices ?? []
            kioskAccess = cached.kioskAccess ?? .unknown
            knownBookingActivity = Dictionary(
                activeBookingActivity.map { ($0.id, $0) },
                uniquingKeysWith: { first, _ in first }
            )
        } else if defaults.data(forKey: Self.cacheKey) != nil {
            // A corrupt or stale cache must not create a launch crash loop.
            defaults.removeObject(forKey: Self.cacheKey)
        }

        if autoStart {
            startObservingPushEvents()
            startAutomaticRefresh()
        } else {
            isRestoring = false
        }
    }

    var menuBarSymbol: String {
        if user == nil { return "shippingbox" }
        return switch healthSeverity {
        case .healthy: "shippingbox.fill"
        case .attention: "shippingbox.and.arrow.backward.fill"
        case .critical: "exclamationmark.triangle.fill"
        }
    }

    var menuBarAccessibilityLabel: String {
        guard let count = custodyCount else {
            return user == nil ? "Wisconsin Creative, signed out" : "Wisconsin Creative, status unavailable"
        }
        return "Wisconsin Creative, \(count) active checkout\(count == 1 ? "" : "s"), \(healthLabel.lowercased())"
    }

    /// The projection's checked-out statistic is the single physical-custody
    /// truth shared by the menu bar, popover header, and VoiceOver label.
    var custodyCount: Int? { snapshot?.stats.checkedOut }

    var companionHealthSeverity: GearOpsHealthSeverity {
        guard user != nil else { return .healthy }
        if snapshot == nil { return .critical }
        if countDataIsPartial || statusMessage != nil { return .attention }
        return .healthy
    }

    var kioskHealthSeverity: GearOpsHealthSeverity {
        guard user != nil else { return .healthy }
        switch kioskAccess {
        case .failed, .restricted:
            return .attention
        case .available:
            return monitoredKioskDevices.contains(where: { $0.connectionState().isFault })
                ? .critical
                : .healthy
        case .unknown:
            return .healthy
        }
    }

    var healthSeverity: GearOpsHealthSeverity {
        max(companionHealthSeverity, kioskHealthSeverity)
    }

    var kioskStatusSummary: String {
        switch kioskAccess {
        case .available:
            kioskFleetCounts.summary
        case .restricted:
            "Restricted for this account"
        case .failed:
            "Could not refresh"
        case .unknown:
            "Not checked"
        }
    }

    var healthLabel: String {
        switch healthSeverity {
        case .healthy: "Healthy"
        case .attention: "Needs attention"
        case .critical: "Critical"
        }
    }

    var kioskFleetCounts: KioskFleetCounts {
        KioskFleetCounts(devices: monitoredKioskDevices)
    }

    var monitoredKioskDevices: [KioskDevice] {
        let now = Date.now
        return kioskDevices
            .filter(\.isIncludedInMonitoring)
            .sorted { lhs, rhs in
                let lhsPriority = Self.monitoringPriority(for: lhs.connectionState(at: now))
                let rhsPriority = Self.monitoringPriority(for: rhs.connectionState(at: now))
                if lhsPriority != rhsPriority { return lhsPriority < rhsPriority }

                let lhsLastSeen = lhs.lastSeenAt ?? .distantPast
                let rhsLastSeen = rhs.lastSeenAt ?? .distantPast
                if lhsLastSeen != rhsLastSeen { return lhsLastSeen < rhsLastSeen }
                let nameOrder = lhs.name.localizedCaseInsensitiveCompare(rhs.name)
                return nameOrder == .orderedSame ? lhs.id < rhs.id : nameOrder == .orderedAscending
            }
    }

    func pendingPickupBookings(at now: Date = .now) -> [BookingActivitySnapshot] {
        activeBookingActivity.filter { $0.isWaitingForPickup(at: now) }
    }

    /// Derived from the same rows the popover renders rather than from the
    /// projection's generation-time `stats.overdue`, so the badge and the row
    /// colours can never disagree as the clock passes a due time.
    func overdueBookingCount(at now: Date = .now) -> Int {
        openBookings.filter { $0.isOverdue(at: now) }.count
    }

    /// Restore reads the external companion projection after loading the local
    /// enrollment. The projection endpoint is Upstash-only and cannot wake a
    /// suspended Neon compute.
    ///
    /// A login item can start while macOS is still bringing the user session
    /// back after a restart. An `AfterFirstUnlockThisDeviceOnly` Keychain item
    /// can temporarily read as missing in that window. Only an explicit sign
    /// out or a server-confirmed unauthorized credential may clear trusted
    /// local state; repeated missing reads keep the last projection visible.
    func restoreSession() async {
        if restoreInFlight {
            restoreQueued = true
            return
        }

        restoreInFlight = true
        isRestoring = true
        defer {
            isRestoring = false
            restoreInFlight = false
            if restoreQueued {
                restoreQueued = false
                Task { [weak self] in
                    await self?.restoreSession()
                }
            }
        }

        let generation = sessionGeneration
        do {
            let storedUser = try await credentialStore.loadUser()
            if user == nil, let storedUser {
                user = storedUser
                persistCache()
            }
            guard user != nil else { return }

            guard let token = try await credentialStore.loadToken() else {
                guard generation == sessionGeneration, user != nil else { return }
                // A missing read is not proof that the user signed out. Keep
                // the cached identity and projection visible and retry on the
                // next activation, wake, push, or menu presentation.
                awaitingCredentialUnlock = true
                statusMessage = "Saved session is temporarily unavailable. Showing the last confirmed data."
                return
            }
            guard generation == sessionGeneration, user != nil else { return }
            awaitingCredentialUnlock = false
            companionToken = token
            registeredDeviceCredential = nil
            if storedUser == nil, let user {
                // Migrate an existing enrollment whose identity previously
                // lived only in crash-vulnerable preferences.
                try? await credentialStore.saveUser(user)
            }
            await refresh()
            guard sessionIsCurrent(generation: generation, token: token) else { return }
            scheduleSupplementarySetup(expectedGeneration: generation, token: token)
        } catch {
            guard generation == sessionGeneration else { return }
            companionToken = nil
            statusMessage = "Secure credential access is unavailable. Showing the last confirmed data."
        }
    }

    func signIn(email: String, password: String) async {
        guard !isSigningIn, !isSigningOut else { return }
        let generation = sessionGeneration
        isSigningIn = true
        statusMessage = nil
        defer {
            if generation == sessionGeneration {
                isSigningIn = false
            }
        }

        var issuedToken: String?
        do {
            let response = try await client.login(email: email, password: password)
            issuedToken = response.companionToken
            guard generation == sessionGeneration else {
                await discardIssuedCredential(response.companionToken)
                return
            }
            guard !response.user.forcePasswordChange else {
                clearAuthenticatedState()
                await clearPrivateArtifacts()
                await discardIssuedCredential(response.companionToken)
                statusMessage = "Open Wisconsin Creative in your browser to change your password."
                return
            }
            try response.companionProjection.validate()
            try await credentialStore.saveToken(response.companionToken)
            try await credentialStore.saveUser(response.user)
            guard generation == sessionGeneration else {
                await discardIssuedCredential(response.companionToken)
                return
            }
            user = response.user
            companionToken = response.companionToken
            registeredDeviceCredential = nil
            await install(
                response.companionProjection,
                deliverNotifications: false,
                expectedGeneration: generation
            )
            guard sessionIsCurrent(generation: generation, token: response.companionToken) else {
                await discardIssuedCredential(response.companionToken)
                return
            }
            scheduleSupplementarySetup(expectedGeneration: generation, token: response.companionToken)
        } catch {
            if let issuedToken {
                await discardIssuedCredential(issuedToken)
            }
            guard generation == sessionGeneration else { return }
            statusMessage = error.localizedDescription
        }
    }

    func signOut(message: String? = nil) async {
        guard !isSigningOut else { return }
        let tokenToRevoke = companionToken
        sessionGeneration &+= 1
        isSigningOut = true
        isSigningIn = false
        isRefreshing = false
        refreshQueued = false
        clearAuthenticatedState()
        await clearPrivateArtifacts()
        statusMessage = message
        var credentialRemovalFailed = false
        var serverCleanupPending = false
        if let tokenToRevoke {
            let staged = (try? await credentialStore.stageTokenForRevocation(tokenToRevoke)) != nil
            if staged {
                do {
                    try await credentialStore.deleteToken(ifMatching: tokenToRevoke)
                } catch {
                    credentialRemovalFailed = true
                }
            }

            if await revokeCredential(tokenToRevoke) {
                try? await credentialStore.removePendingRevocation(tokenToRevoke)
                do {
                    try await credentialStore.deleteToken(ifMatching: tokenToRevoke)
                } catch {
                    credentialRemovalFailed = true
                }
            } else if staged {
                serverCleanupPending = true
            } else {
                credentialRemovalFailed = true
            }
        }
        isSigningOut = false
        if credentialRemovalFailed {
            let prefix = message.map { "\($0) " } ?? "Signed out locally. "
            statusMessage = prefix + "The saved companion credential could not be removed. Try signing out again."
        } else if serverCleanupPending {
            let prefix = message.map { "\($0) " } ?? "Signed out. "
            statusMessage = prefix + "Server session cleanup will retry when Wisconsin Creative opens."
        } else {
            statusMessage = message
        }
    }

    /// Every post-enrollment refresh reads only the external Upstash projection.
    /// Failure preserves the last trusted local snapshot.
    func refresh() async {
        guard user != nil, let companionToken else { return }
        if isRefreshing {
            refreshQueued = true
            return
        }
        let generation = sessionGeneration
        isRefreshing = true
        defer {
            if generation == sessionGeneration {
                isRefreshing = false
            }
        }

        var requestToken = companionToken
        repeat {
            refreshQueued = false
            requestToken = self.companionToken ?? requestToken
            do {
                do {
                    requestToken = try await renewCredential(
                        token: requestToken,
                        expectedGeneration: generation
                    )
                } catch GearOpsClientError.unauthorized {
                    throw GearOpsClientError.unauthorized
                } catch {
                    // Renewal is best-effort while the current credential is
                    // still valid. Keep using it through a network or Keychain
                    // interruption instead of turning a refresh failure into a
                    // sign-out.
                }

                let projection = try await client.companionProjection(token: requestToken)
                guard sessionIsCurrent(generation: generation, token: requestToken) else { return }
                try projection.validate()

                if installedProjection == projection {
                    statusMessage = nil
                } else {
                    await install(
                        projection,
                        deliverNotifications: true,
                        expectedGeneration: generation
                    )
                    guard sessionIsCurrent(generation: generation, token: requestToken) else { return }
                }
                scheduleSupplementarySetup(expectedGeneration: generation, token: requestToken)
            } catch GearOpsClientError.unauthorized {
                guard sessionIsCurrent(generation: generation, token: requestToken) else { return }
                await signOut(message: "Companion enrollment expired. Sign in again.")
                return
            } catch {
                guard sessionIsCurrent(generation: generation, token: requestToken) else { return }
                statusMessage = "Updates are unavailable. Showing the last confirmed data."
            }
        } while refreshQueued && sessionIsCurrent(generation: generation, token: requestToken)
    }

    func openDashboard() {
        open(path: "/")
    }

    func openCheckouts() {
        open(path: "/bookings?tab=checkouts&status=OPEN")
    }

    func openBooking(_ booking: OpenBooking) {
        open(path: "/bookings?tab=checkouts&highlight=\(booking.id)")
    }

    func openBooking(_ booking: BookingActivitySnapshot) {
        guard let url = BookingDeepLink.bookingURL(id: booking.id, kind: booking.kind) else { return }
        open(url: url)
    }

    func openPendingPickups() {
        guard let url = BookingDeepLink.pendingPickupsURL else { return }
        open(url: url)
    }

    func openKioskDevices() {
        open(path: "/settings/kiosk-devices")
    }

    func refreshNotificationAuthorization() async {
        notificationAuthorization = await bookingNotifications.authorization()
    }

    func clearStatusMessage() {
        statusMessage = nil
    }

    var shouldRetryCredentialRestore: Bool {
        user != nil && companionToken == nil && awaitingCredentialUnlock
    }

    func openSystemNotificationSettings() {
        guard let url = URL(string: "x-apple.systempreferences:com.apple.preference.notifications") else { return }
        open(url: url)
    }

    func quit() {
        NSApplication.shared.terminate(nil)
    }

    private func open(path: String) {
        guard let url = URL(string: path, relativeTo: GearOpsClient.canonicalBaseURL)?.absoluteURL else { return }
        open(url: url)
    }

    private func open(url: URL) {
        NSWorkspace.shared.open(url)
    }

    private func startObservingPushEvents() {
        pushTask = Task { [weak self] in
            for await event in CompanionPushBridge.shared.events {
                guard !Task.isCancelled else { return }
                switch event {
                case .deviceToken(let token):
                    await self?.receiveDeviceToken(token)
                case .projectionChanged:
                    guard let self else { continue }
                    await self.retryPendingRevocations()
                    if self.companionToken == nil {
                        await self.restoreSession()
                    } else {
                        await self.refresh()
                    }
                case .sessionBecameActive:
                    guard let self else { continue }
                    await self.retryPendingRevocations()
                    await self.restoreSession()
                }
            }
        }
    }

    /// Launch and session activation restore the last trusted enrollment. APNs
    /// and an explicit refresh remain the normal invalidation paths; this
    /// deliberately contains no timer or polling loop.
    private func startAutomaticRefresh() {
        startupTask = Task { [weak self] in
            await self?.retryPendingRevocations()
            await self?.restoreSession()
        }
    }

    func receiveDeviceToken(_ token: String) async {
        if currentDeviceToken != token {
            registeredDeviceCredential = nil
        }
        currentDeviceToken = token
        await registerCurrentDeviceToken(expectedGeneration: sessionGeneration)
    }

    private func registerCurrentDeviceToken(expectedGeneration: UInt64) async {
        guard expectedGeneration == sessionGeneration,
              let currentDeviceToken,
              let companionToken,
              registeredDeviceCredential != companionToken else { return }
        do {
            try await client.registerCompanionDevice(currentDeviceToken, credential: companionToken)
            guard sessionIsCurrent(generation: expectedGeneration, token: companionToken),
                  self.currentDeviceToken == currentDeviceToken else { return }
            registeredDeviceCredential = companionToken
        } catch {
            // APNs registration is supplementary. Retain the current token and
            // retry after the next successful projection refresh or enrollment.
        }
    }

    private func scheduleSupplementarySetup(expectedGeneration: UInt64, token: String) {
        supplementaryTask?.cancel()
        supplementaryTask = Task { [weak self] in
            guard let self else { return }
            await self.registerCurrentDeviceToken(expectedGeneration: expectedGeneration)
            guard self.sessionIsCurrent(generation: expectedGeneration, token: token) else { return }
            await self.bookingNotifications.requestAuthorization()
            guard self.sessionIsCurrent(generation: expectedGeneration, token: token) else { return }
            await self.registerCurrentDeviceToken(expectedGeneration: expectedGeneration)
        }
    }

    /// Rotate a still-valid companion credential before reading the external
    /// projection. The old credential remains valid on the server until the
    /// replacement is durable in Keychain, so a failed save never strands the
    /// account. Old-session cleanup uses the same durable retry path as sign-out.
    private func renewCredential(token: String, expectedGeneration: UInt64) async throws -> String {
        let renewedToken = try await client.renewCompanion(token: token)
        guard !renewedToken.isEmpty else { throw GearOpsClientError.invalidResponse }
        guard sessionIsCurrent(generation: expectedGeneration, token: token) else {
            await discardIssuedCredential(renewedToken)
            throw CancellationError()
        }
        guard renewedToken != token else { return token }

        do {
            try await credentialStore.saveToken(renewedToken)
        } catch {
            await discardIssuedCredential(renewedToken)
            throw error
        }

        guard sessionIsCurrent(generation: expectedGeneration, token: token) else {
            await discardIssuedCredential(renewedToken)
            throw CancellationError()
        }
        companionToken = renewedToken
        await discardIssuedCredential(token)
        return renewedToken
    }

    private func revokeCredential(_ token: String) async -> Bool {
        do {
            try await client.revokeCompanion(credential: token)
            return true
        } catch GearOpsClientError.unauthorized {
            // A 401 means the server has already invalidated the credential.
            return true
        } catch {
            return false
        }
    }

    private func discardIssuedCredential(_ token: String) async {
        if await revokeCredential(token) {
            try? await credentialStore.deleteToken(ifMatching: token)
            try? await credentialStore.removePendingRevocation(token)
            return
        }

        if (try? await credentialStore.stageTokenForRevocation(token)) != nil {
            try? await credentialStore.deleteToken(ifMatching: token)
        }
    }

    private func retryPendingRevocations() async {
        guard let pending = try? await credentialStore.loadPendingRevocations() else { return }
        for token in pending {
            guard !Task.isCancelled else { return }
            if await revokeCredential(token) {
                try? await credentialStore.removePendingRevocation(token)
                try? await credentialStore.deleteToken(ifMatching: token)
            }
        }
    }

    private func clearPrivateArtifacts() async {
        await bookingNotifications.clearPrivateNotifications()
        GearOpsAvatarCache.removeAll()
    }

    private func install(
        _ projection: CompanionProjection,
        deliverNotifications: Bool,
        expectedGeneration: UInt64
    ) async {
        guard expectedGeneration == sessionGeneration else { return }
        guard (try? projection.validate()) != nil else {
            statusMessage = "Updates are unavailable. Showing the last confirmed data."
            return
        }
        let previousActivity = knownBookingActivity
        let sortedActivity = projection.bookingActivity.sorted(using: KeyPathComparator(\.startsAt))

        snapshot = GearOpsSnapshot(
            stats: projection.stats,
            pendingPickupTotal: projection.pendingPickupTotal,
            receivedAt: projection.generatedAt,
            partialFailures: []
        )
        openBookings = projection.openBookings
        openBookingTotal = projection.openBookings.count
        activeBookingActivity = sortedActivity
        kioskDevices = projection.kioskDevices
        kioskAccess = KioskAccessState(rawValue: projection.kioskAccess) ?? .failed
        installedProjection = projection
        countDataIsPartial = false
        statusMessage = nil

        knownBookingActivity = Dictionary(
            sortedActivity.map { ($0.id, $0) },
            uniquingKeysWith: { first, _ in first }
        )
        persistCache()

        if deliverNotifications {
            let changes = sortedActivity
                .filter({ previousActivity[$0.id] != $0 })
                .sorted(by: { $0.updatedAt < $1.updatedAt })
                .compactMap { current in
                    BookingChangeDetector.change(
                        from: previousActivity[current.id],
                        to: current
                    )
                }
            for change in changes where notificationSettings.allows(change.category) {
                guard expectedGeneration == sessionGeneration else { return }
                await bookingNotifications.deliver(change, playsSound: notificationSettings.playsSound)
            }
        }
    }

    private func persistCache() {
        guard let user else { return }
        let cached = GearOpsCachedState(
            user: user,
            snapshot: snapshot,
            openBookings: openBookings,
            openBookingTotal: openBookingTotal,
            activeBookingActivity: activeBookingActivity,
            kioskDevices: kioskDevices,
            kioskAccess: kioskAccess
        )
        guard let data = try? JSONEncoder().encode(cached) else { return }
        defaults.set(data, forKey: Self.cacheKey)
    }

    private func clearAuthenticatedState() {
        supplementaryTask?.cancel()
        companionToken = nil
        awaitingCredentialUnlock = false
        user = nil
        snapshot = nil
        openBookings = []
        openBookingTotal = nil
        activeBookingActivity = []
        kioskDevices = []
        kioskAccess = .unknown
        knownBookingActivity = [:]
        installedProjection = nil
        refreshQueued = false
        registeredDeviceCredential = nil
        countDataIsPartial = false
        defaults.removeObject(forKey: Self.cacheKey)
    }

    private func sessionIsCurrent(generation: UInt64, token: String) -> Bool {
        generation == sessionGeneration && companionToken == token && user != nil
    }

    private static func monitoringPriority(for state: KioskConnectionState) -> Int {
        switch state {
        case .offline: 0
        case .online: 1
        case .stale: 2
        case .inactive: 3
        }
    }
}
