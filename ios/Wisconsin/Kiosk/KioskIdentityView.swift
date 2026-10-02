import SwiftUI

struct KioskIdentityView: View {
    @Environment(\.today) private var today
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
    /// Redesign B1: "Free until" and "Last back" for the scanned item.
    @State private var lookup: KioskScanLookup.Item?
    /// Redesign A6: the checkout being returned, for its ref and items.
    @State private var returnDetail: KioskCheckoutDetail?

    private var intent: KioskFlowIntent? { store.pendingIntent }
    private var roster: [KioskUser] {
        intent?.expectedRequester.map { [$0] } ?? users
    }
    private var identityPrompt: String {
        if let requester = intent?.expectedRequester { return "Confirm \(requester.name) to continue — tap their name." }
        if let owner = intent?.custodyOwner { return "This is \(owner.name)'s gear. Anyone can return it — choose your name." }
        return "Choose your name to continue."
    }
    private var normalizedQuery: String {
        query.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    private var visibleUsers: [KioskUser] {
        // A6 lists the owner on their own card, so "Someone else" skips them.
        var roster = roster
        if case .returnOther(let owner) = contextMode { roster.removeAll { $0.id == owner.id } }
        guard !normalizedQuery.isEmpty else { return roster }
        return roster.filter { $0.name.localizedCaseInsensitiveContains(normalizedQuery) }
    }

    var body: some View {
        ZStack {
            if let contextMode {
                contextLayout(contextMode)
            } else {
                plainLayout
            }

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
        .task { await loadContext() }
        .onChange(of: searchFocused) { _, focused in store.scanner.setEditing(focused) }
        .onDisappear {
            cancelIdentityRequest()
            store.scanner.setEditing(false)
            store.scanner.release(.identity)
        }
    }

    private var plainLayout: some View {
            VStack(alignment: .leading, spacing: 24) {
                HStack {
                    Button("Cancel") { cancelIdentityFlow() }
                        .kioskButtonRole(.secondary)
                    Spacer()
                }
                VStack(alignment: .leading, spacing: 8) {
                    Text(intent?.heroTitle ?? "Who are you?")
                        .font(.system(size: 36, weight: .heavy)).foregroundStyle(KioskText.primary)
                    Text(identityPrompt)
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
                    KioskScanFeedbackSound.playFailure()
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
                KioskScanFeedbackSound.playFailure()
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

// MARK: - Starting from a scan or a booking (redesign A6, B1, B2)
//
// When the flow already knows what it is about -- an item scanned on home or
// someone's checkout -- that thing sits on the left and the question sits on
// the right, so nobody has to remember what they scanned while choosing.

enum KioskIdentityContext: Equatable {
    /// B1: free gear scanned on home.
    case scanFree(KioskResolvedItem)
    /// B2: gear reserved for someone's pickup.
    case reserved(KioskUser)
    /// A6: someone's personal checkout; anyone may return it.
    case returnOther(KioskUser)

    static func resolve(_ intent: KioskFlowIntent?) -> KioskIdentityContext? {
        guard let intent else { return nil }
        if intent.action == .return, intent.targetBooking != nil, let owner = intent.custodyOwner {
            return .returnOther(owner)
        }
        if intent.source == .scan, intent.action == .pickup, let requester = intent.expectedRequester {
            return .reserved(requester)
        }
        if intent.source == .scan, intent.action == .checkout, let item = intent.scannedItem {
            return .scanFree(item)
        }
        return nil
    }
}

extension KioskIdentityView {
    fileprivate var contextMode: KioskIdentityContext? { KioskIdentityContext.resolve(intent) }

    fileprivate func loadContext() async {
        switch contextMode {
        case .scanFree:
            guard let scan = intent?.pendingScanValues.first else { return }
            lookup = try? await KioskAPI.shared.kioskScanLookup(scanValue: scan).item
        case .returnOther:
            guard let id = intent?.targetBooking?.id else { return }
            returnDetail = try? await KioskAPI.shared.kioskCheckoutDetail(id: id)
        case .reserved, nil:
            return
        }
    }

    @ViewBuilder
    fileprivate func contextLayout(_ mode: KioskIdentityContext) -> some View {
        HStack(alignment: .top, spacing: 28) {
            VStack(alignment: .leading, spacing: 16) {
                switch mode {
                case .scanFree(let item): scannedCard(item: item)
                case .reserved(let holder): reservedCard(holder: holder)
                case .returnOther(let owner): returnCard(owner: owner)
                }
                Spacer(minLength: 0)
                Button {
                    cancelIdentityFlow()
                } label: {
                    Text(mode.isReturn ? "Close" : "Cancel").frame(maxWidth: .infinity)
                }
                .kioskButtonRole(.secondary)
            }
            .frame(width: 400)
            .frame(maxHeight: .infinity, alignment: .top)

            VStack(alignment: .leading, spacing: 14) {
                if let message { Text(message).foregroundStyle(Color.statusText(.orange)).font(.headline) }
                switch mode {
                case .scanFree:
                    Text("Who\u{2019}s taking it?").font(KioskType.screenTitle).foregroundStyle(KioskText.primary)
                    rosterContent
                case .reserved(let holder):
                    reservedChoice(holder: holder)
                case .returnOther(let owner):
                    Text("Who\u{2019}s returning it?").font(KioskType.screenTitle).foregroundStyle(KioskText.primary)
                    personCard(owner, detail: "Checked this out", tint: KioskSection.comingBack) { choose(owner) }
                    Text("SOMEONE ELSE")
                        .font(KioskType.overline).tracking(KioskType.overlineTracking)
                        .foregroundStyle(KioskText.tertiary)
                        .padding(.top, 6)
                    rosterContent
                }
            }
            .padding(.leading, 28)
            .overlay(alignment: .leading) { Rectangle().fill(KioskStroke.divider).frame(width: 1) }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
        .padding(28)
    }

    // MARK: Left cards

    private func overline(_ text: String, color: Color = KioskText.tertiary) -> some View {
        Text(text)
            .font(KioskType.overline).tracking(KioskType.overlineTracking)
            .foregroundStyle(color)
    }

    private func itemHeader(tag: String, name: String) -> some View {
        HStack(spacing: 16) {
            RoundedRectangle(cornerRadius: 14)
                .fill(Color.white.opacity(0.06))
                .frame(width: 64, height: 64)
                .overlay(Image(systemName: "camera").font(.system(size: 26)).foregroundStyle(KioskText.tertiary))
            VStack(alignment: .leading, spacing: 2) {
                Text(tag).font(.system(size: 26, weight: .heavy)).foregroundStyle(KioskText.primary).lineLimit(1)
                if !tag.isSameListText(as: name) {
                    Text(name).font(.system(size: 16)).foregroundStyle(KioskText.secondary).lineLimit(1)
                }
            }
        }
        .padding(18)
    }

    private func factRow(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(label).font(.system(size: 15)).foregroundStyle(KioskText.tertiary).frame(width: 110, alignment: .leading)
            Text(value).font(.system(size: 15, weight: .semibold)).foregroundStyle(KioskText.primary)
        }
    }

    private func statusLine(_ text: String, tint: KioskSection) -> some View {
        HStack(spacing: 10) {
            Circle().fill(tint.accent).frame(width: 12, height: 12)
            Text(text).font(.system(size: 22, weight: .heavy)).foregroundStyle(tint.accent)
        }
    }

    private func scannedCard(item: KioskResolvedItem) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            overline("JUST SCANNED")
            VStack(alignment: .leading, spacing: 0) {
                itemHeader(tag: lookup?.tagName ?? item.tagName, name: lookup?.productName ?? item.name)
                VStack(alignment: .leading, spacing: 12) {
                    statusLine("Available", tint: .takingOut)
                    VStack(alignment: .leading, spacing: 6) {
                        if let lookup {
                            factRow("Free until", lookup.freeUntil.map { "\(KioskDueCopy.relative($0, now: today)), then reserved" } ?? "Nothing reserved")
                            factRow("Last back", lookup.lastReturnedAt.map { KioskDueCopy.relative($0, now: today) } ?? "Not out before")
                        }
                    }
                }
                .padding(.horizontal, 18).padding(.top, 16).padding(.bottom, 18)
                .frame(maxWidth: .infinity, alignment: .leading)
                .overlay(alignment: .top) { Rectangle().fill(KioskSection.takingOut.stageStroke).frame(height: 1) }
            }
            .kioskCard(KioskSection.takingOut.stageFill, radius: 20, stroke: KioskSection.takingOut.stageStroke)
        }
    }

    private func reservedCard(holder: KioskUser) -> some View {
        let booking = intent?.targetBooking
        return VStack(alignment: .leading, spacing: 14) {
            overline("JUST SCANNED")
            VStack(alignment: .leading, spacing: 0) {
                if let item = intent?.scannedItem { itemHeader(tag: item.tagName, name: item.name) }
                VStack(alignment: .leading, spacing: 12) {
                    statusLine("Reserved for \(homeShortNames(for: [holder])[holder.id] ?? holder.name)", tint: .pickingUp)
                    VStack(alignment: .leading, spacing: 6) {
                        if let booking { factRow("Reservation", booking.title) }
                        if let startsAt = booking?.startsAt {
                            factRow("Pickup", startsAt <= Date() ? "Ready now" : "Ready from \(KioskDueCopy.midSentence(startsAt))")
                        }
                        if let endsAt = booking?.endsAt { factRow("Due back", KioskDueCopy.relative(endsAt, now: today)) }
                    }
                }
                .padding(.horizontal, 18).padding(.top, 16).padding(.bottom, 18)
                .frame(maxWidth: .infinity, alignment: .leading)
                .overlay(alignment: .top) { Rectangle().fill(KioskSection.pickingUp.stageStroke).frame(height: 1) }
            }
            .kioskCard(KioskSection.pickingUp.stageFill, radius: 20, stroke: KioskSection.pickingUp.stageStroke)
        }
    }

    private func returnCard(owner: KioskUser) -> some View {
        let booking = intent?.targetBooking
        let endsAt = returnDetail?.endsAt ?? booking?.endsAt
        let isOverdue = endsAt.map { $0 < Date() } ?? false
        let dueLine: String = {
            guard let endsAt else { return "OUT NOW" }
            if isOverdue { return "OVERDUE · DUE \(KioskDueCopy.relative(endsAt, now: today).uppercased())" }
            if Calendar.current.dayOffset(of: endsAt, from: today) == 0 { return "DUE BACK TODAY · \(endsAt.formatted(.dateTime.hour().minute()))" }
            return "DUE BACK \(KioskDueCopy.relative(endsAt, now: today).uppercased())"
        }()
        let items = returnDetail?.items.filter { !$0.returned } ?? []
        let ownerLabel = homeShortNames(for: [owner])[owner.id] ?? owner.name
        let firstName = owner.name.split(separator: " ").first.map(String.init) ?? owner.name
        var meta = [ownerLabel]
        if let ref = returnDetail?.refNumber { meta.append(ref) }
        if returnDetail != nil { meta.append("\(items.count) item\(items.count == 1 ? "" : "s")") }
        return VStack(alignment: .leading, spacing: 14) {
            overline(dueLine, color: isOverdue ? KioskSection.problem.text : KioskSection.comingBack.text)
            VStack(alignment: .leading, spacing: 4) {
                Text(returnDetail?.title ?? booking?.title ?? "Checkout")
                    .font(KioskType.screenTitle).foregroundStyle(KioskText.primary).lineLimit(2)
                Text(meta.joined(separator: " · ")).font(KioskType.rowDetail).foregroundStyle(KioskText.secondary)
            }
            if !items.isEmpty {
                VStack(spacing: 0) {
                    ForEach(items.prefix(6)) { item in
                        HStack(spacing: 12) {
                            Text(item.itemListPrimaryTitle).font(KioskType.rowTitle).foregroundStyle(KioskText.primary)
                            if let secondary = item.itemListSecondaryTitle {
                                Text(secondary).font(KioskType.rowDetail).foregroundStyle(KioskText.secondary).lineLimit(1)
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(.horizontal, 16).padding(.vertical, 10)
                    }
                    if items.count > 6 {
                        Text("and \(items.count - 6) more").font(KioskType.meta).foregroundStyle(KioskText.tertiary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 16).padding(.vertical, 8)
                    }
                }
                .padding(.vertical, 4)
                .kioskCard()
            }
            Text("Anyone can bring this back. It stays \(firstName)\u{2019}s checkout; the record shows who returned it.")
                .font(KioskType.meta).foregroundStyle(KioskText.tertiary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: Right side

    private func personCard(_ user: KioskUser, detail: String, tint: KioskSection, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 14) {
                KioskAvatar(url: user.avatarUrl, initials: user.initials, size: 48)
                    .overlay(Circle().stroke(KioskSurface.base, lineWidth: 2))
                    .padding(2)
                    .overlay(Circle().stroke(tint.accent, lineWidth: 2))
                VStack(alignment: .leading, spacing: 2) {
                    Text(homeShortNames(for: [user])[user.id] ?? user.name)
                        .font(.system(size: 19, weight: .bold)).foregroundStyle(KioskText.primary).lineLimit(1)
                    Text(detail).font(KioskType.chip).foregroundStyle(tint.text).lineLimit(1)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.system(size: 14, weight: .semibold)).foregroundStyle(KioskText.muted)
            }
            .padding(.horizontal, 16)
            .frame(height: 76)
            .kioskCard(KioskSurface.cardRaised, radius: 16, stroke: KioskStroke.standard)
        }
        .buttonStyle(KioskPressStyle())
        .accessibilityLabel("\(user.name), \(detail)")
    }

    @ViewBuilder
    private func reservedChoice(holder: KioskUser) -> some View {
        let firstName = holder.name.split(separator: " ").first.map(String.init) ?? holder.name
        Text("This is \(firstName)\u{2019}s pickup").font(KioskType.screenTitle).foregroundStyle(KioskText.primary)
        personCard(holder, detail: "Continue as \(firstName)", tint: .pickingUp) { choose(holder) }
        Spacer(minLength: 0)
        Text("Not for \(firstName)? Put it back on the shelf; it\u{2019}s held for their pickup.")
            .font(KioskType.meta).foregroundStyle(KioskText.tertiary)
    }
}

private extension KioskIdentityContext {
    var isReturn: Bool { if case .returnOther = self { return true } else { return false } }
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
