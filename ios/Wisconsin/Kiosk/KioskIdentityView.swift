import SwiftUI

struct KioskIdentityView: View {
    @Environment(KioskStore.self) private var store
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var users: [KioskUser] = []
    @State private var query = ""
    @State private var message: String?
    @State private var loadError: String?
    @State private var loading = true
    @State private var identifyTask: Task<Void, Never>?
    @State private var identifyRequests = LatestRequestGeneration()
    @FocusState private var searchFocused: Bool

    private var intent: KioskFlowIntent? { store.pendingIntent }
    private var roster: [KioskUser] {
        intent?.expectedRequester.map { [$0] } ?? users
    }
    private var normalizedQuery: String {
        query.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    private var visibleUsers: [KioskUser] {
        guard !normalizedQuery.isEmpty else { return roster }
        return roster.filter { $0.name.localizedCaseInsensitiveContains(normalizedQuery) }
    }

    var body: some View {
        ZStack {
            VStack(alignment: .leading, spacing: 24) {
                HStack {
                    Button("Cancel") { cancelIdentityFlow() }
                        .kioskButtonRole(.secondary)
                    Spacer()
                }
                VStack(alignment: .leading, spacing: 8) {
                    Text(intent?.heroTitle ?? "Who are you?")
                        .font(.gothamBlack(size: 36)).foregroundStyle(KioskText.primary)
                    Text(intent?.expectedRequester.map { "Confirm \($0.name) to continue — tap their name." }
                         ?? "Choose your name to continue.")
                        .font(.title3).foregroundStyle(KioskText.secondary)
                }
                TextField("Search roster", text: $query)
                    .textFieldStyle(.plain).font(.title3)
                    .padding(16).background(KioskSurface.cardRaised, in: RoundedRectangle(cornerRadius: KioskRadius.lg))
                    .focused($searchFocused)
                if let message { Text(message).foregroundStyle(Color.statusText(.orange)).font(.headline) }
                rosterContent
            }
            .padding(36)

            if !searchFocused {
                HIDScannerField { store.scanner.receive($0) }.frame(width: 1, height: 1).opacity(0)
            }
        }
        .task {
            store.scanner.claim(.identity) { scan in identify(scan) }
            if intent?.expectedRequester == nil {
                await loadRoster()
            } else {
                loading = false
            }
        }
        .onChange(of: searchFocused) { _, focused in store.scanner.setEditing(focused) }
        .onDisappear {
            cancelIdentityRequest()
            store.scanner.setEditing(false)
            store.scanner.release(.identity)
        }
    }

    @ViewBuilder
    private var rosterContent: some View {
        if loading {
            ProgressView("Loading roster")
                .tint(KioskText.primary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let loadError {
            ContentUnavailableView {
                Label("Couldn’t load the roster", systemImage: "wifi.exclamationmark")
            } description: {
                Text(loadError)
            } actions: {
                Button("Retry") { Task { await loadRoster() } }
                    .kioskButtonRole(.primary)
            }
        } else if roster.isEmpty {
            ContentUnavailableView {
                Label("No people available", systemImage: "person.2.slash")
            } description: {
                Text("The roster is empty right now.")
            } actions: {
                Button("Retry") { Task { await loadRoster() } }
                    .kioskButtonRole(.secondary)
            }
        } else if visibleUsers.isEmpty {
            ContentUnavailableView {
                Label("No matching people", systemImage: "magnifyingglass")
            } description: {
                Text("No one matches “\(normalizedQuery)”.")
            } actions: {
                Button("Clear Search") {
                    query = ""
                    searchFocused = true
                }
                .kioskButtonRole(.secondary)
            }
        } else {
            // The same roster tile and fit-to-screen grid the idle screen uses.
            //
            // This screen had its own second implementation: full names at
            // `.headline` with no `lineLimit` and no `minimumScaleFactor`, in a
            // 210pt cell already holding a 52pt avatar and a chevron. Names
            // longer than about eleven characters hyphenated across three lines
            // — "Priya Ra-machan dran", "Silas Bergstro m" — on the screen
            // whose entire job is letting someone recognise their own name.
            // It also scrolled while the idle roster had learned to fit.
            GeometryReader { proxy in
                let labels = disambiguatedLabels(for: visibleUsers)
                let metrics = rosterMetrics(for: visibleUsers.count, in: proxy.size)
                let grid = LazyVGrid(columns: metrics.gridColumns, spacing: KioskRosterMetrics.gap) {
                    ForEach(visibleUsers) { user in
                        UserRow(
                            user: user,
                            displayName: labels[user.id] ?? user.name,
                            metrics: metrics,
                            accessibilityHintText: "Select \(user.name)"
                        ) {
                            choose(user)
                        }
                    }
                }

                if metrics.fitsOnOneScreen {
                    grid.frame(maxHeight: .infinity, alignment: .top)
                } else {
                    ScrollView { grid }.scrollIndicators(.visible)
                }
            }
        }
    }

    /// At accessibility text sizes the name is the point of this screen. Keep
    /// one comfortable scrolling column instead of shrinking names into a
    /// dense grid that makes self-identification error-prone.
    private func rosterMetrics(for count: Int, in size: CGSize) -> KioskRosterMetrics {
        guard !dynamicTypeSize.isAccessibilitySize else {
            return KioskRosterMetrics(
                columns: 1,
                tileHeight: KioskRosterMetrics.comfortableHeight,
                avatarSize: 40,
                showsAvatar: true,
                fitsOnOneScreen: false
            )
        }
        return KioskRosterMetrics.resolve(count: count, in: size)
    }

    private func loadRoster() async {
        loading = true
        loadError = nil
        do {
            users = try await KioskAPI.shared.kioskUsers()
        } catch is CancellationError {
            loading = false
            return
        } catch {
            loadError = (error as? APIError)?.errorDescription ?? "Check the kiosk connection and try again."
        }
        loading = false
    }

    private func identify(_ scan: String) {
        cancelIdentityRequest()
        let requestToken = identifyRequests.begin()
        identifyTask = Task { @MainActor in
            do {
                guard ownsIdentityRequest(requestToken) else { return }
                let result = try await KioskAPI.shared.kioskResolveScan(scanValue: scan)
                try Task.checkCancellation()
                guard ownsIdentityRequest(requestToken) else { return }

                guard result.kind == "identity", let user = result.user else {
                    finishIdentityRequest(requestToken)
                    message = result.message ?? "That scan didn't match anyone. Tap your name instead."
                    Haptics.warning()
                    return
                }
                choose(user)
            } catch is CancellationError {
                finishIdentityRequest(requestToken)
            } catch {
                guard ownsIdentityRequest(requestToken) else { return }
                finishIdentityRequest(requestToken)
                message = (error as? APIError)?.errorDescription ?? "Could not read that scan."
                Haptics.error()
            }
        }
    }

    /// Cancels the active request and releases scanner ownership before
    /// navigation changes. `onDisappear` can run after the screen mutation, so
    /// relying on it alone leaves a window where a late scan can start work.
    private func cancelIdentityFlow() {
        cancelIdentityRequest()
        store.scanner.setEditing(false)
        store.scanner.release(.identity)
        store.clearIntent(reason: .cancel)
        store.screen = .idle
    }

    private func choose(_ user: KioskUser) {
        cancelIdentityRequest()
        guard var intent else { store.screen = .operatorHub(user); return }
        guard KioskFlowIntentReducer.canIdentify(user, for: intent) else {
            message = "This flow requires \(intent.expectedRequester?.name ?? "the expected requester")."
            Haptics.warning(); return
        }
        intent = KioskFlowIntentReducer.identify(user, in: intent)
        store.setIntent(intent); Haptics.success()
        switch intent.action {
        case .checkout: store.screen = .checkout(user: user)
        case .pickup:
            guard let id = intent.targetBooking?.id else { message = "That reservation is no longer available."; return }
            store.screen = .pickup(bookingId: id, userId: user.id)
        case .return:
            guard let id = intent.targetBooking?.id else { message = "That checkout is no longer available."; return }
            store.screen = .return(bookingId: id, userId: user.id)
        case .manage: store.screen = .operatorHub(user)
        }
    }

    /// Cancellation is advisory. A response may route only while this request
    /// remains newest and this exact screen still owns scanner input.
    private func ownsIdentityRequest(_ requestToken: UUID) -> Bool {
        guard identifyRequests.owns(requestToken),
              !Task.isCancelled,
              store.scanner.owner == .identity,
              case .identity = store.screen
        else { return false }
        return true
    }

    private func finishIdentityRequest(_ requestToken: UUID) {
        guard identifyRequests.owns(requestToken) else { return }
        identifyTask = nil
        identifyRequests.invalidate()
    }

    private func cancelIdentityRequest() {
        identifyTask?.cancel()
        identifyTask = nil
        identifyRequests.invalidate()
    }
}

/// Global scanner indicator, floating above every screen.
///
/// It renders only when the scanner has something to say. A permanently
/// visible "Scanner ready" pill competed with the per-screen
/// `KioskScannerReadinessBadge` that checkout, pickup, return, and the detail
/// drawer already own -- two indicators, same state, different colors -- and it
/// sat on top of the idle refresh control in portrait. Reconnecting and paused
/// still surface here on every screen, which is the state staff need to catch.
struct KioskScannerStatusPill: View {
    @Environment(KioskStore.self) private var store
    #if DEBUG
    @State private var showInspector = false
    #endif

    private var isVisible: Bool {
        #if DEBUG
        // A capture scenario is reviewing what a student sees, so it gets
        // release behaviour. Without this every kiosk screenshot carried a
        // "Scanner ready" pill that never ships, sitting next to the
        // per-screen readiness badge and reading as duplicated status.
        if KioskFixtureScenario.active != nil { return !store.scanner.isNominal }
        return true  // keep the flow-inspector tap target during development
        #else
        return !store.scanner.isNominal
        #endif
    }

    var body: some View {
        if isVisible {
            #if DEBUG
            Button { showInspector = true } label: { scannerStatusLabel }
            .buttonStyle(.plain)
            .accessibilityLabel("Open scanner inspector. \(store.scanner.statusText)")
            .transition(.opacity)
            .sheet(isPresented: $showInspector) { KioskFlowInspector() }
            #else
            scannerStatusLabel
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Scanner status: \(store.scanner.statusText)")
                .transition(.opacity)
            #endif
        }
    }

    private var scannerStatusLabel: some View {
        Label(store.scanner.statusText, systemImage: store.scanner.statusSymbol)
            .font(KioskType.chip).foregroundStyle(tint)
            .padding(.horizontal, 13).padding(.vertical, 9)
            .background(KioskSurface.cardRaised, in: Capsule())
            .overlay(Capsule().stroke(tint.opacity(0.4)))
    }

    private var tint: Color {
        store.scanner.isNominal ? KioskStatus.ok : KioskStatus.attention
    }
}

#if DEBUG
private struct KioskFlowInspector: View {
    @Environment(KioskStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            Form {
                LabeledContent("Scanner owner", value: store.scanner.owner.rawValue)
                LabeledContent("Scanner state", value: store.scanner.statusText)
                LabeledContent("Intent", value: store.pendingIntent?.action.rawValue ?? "none")
                LabeledContent("Source", value: store.pendingIntent?.source.rawValue ?? "none")
                LabeledContent("Pending scans", value: "\(store.pendingIntent?.pendingScanValues.count ?? 0)")
                Text("Raw scan values are intentionally never shown or logged.")
            }.navigationTitle("Kiosk Flow Inspector").toolbar { Button("Done") { dismiss() } }
        }
    }
}
#endif
