import SwiftUI

/// Staff and admin read of the website History tab. Students do not get
/// `asset.audit`. Opening a booking is the one action. Scope only filters.
@MainActor
@Observable
final class ItemActivityModel {
    let assetId: String
    var entries: [AssetActivityEntry] = []
    var nextCursor: String?
    var scope: AssetActivityScope = .all
    var isLoading = false
    var isLoadingOlder = false
    var error: String?
    var olderError: String?

    @ObservationIgnored private var loads = LatestRequestGeneration()

    init(assetId: String) {
        self.assetId = assetId
    }

    func applyScope(_ next: AssetActivityScope) {
        guard next != scope else { return }
        scope = next
        entries = []
        nextCursor = nil
        olderError = nil
        error = nil
        isLoading = true
    }

    func reload() async {
        let token = loads.begin()
        isLoadingOlder = false
        isLoading = true
        error = nil
        defer {
            if loads.owns(token) {
                isLoading = false
            }
        }
        do {
            let page = try await APIClient.shared.assetActivity(
                assetId: assetId,
                scope: scope,
                cursor: nil
            )
            guard loads.owns(token), !Task.isCancelled else { return }
            entries = page.entries.filter { !ItemActivityCopy.isPhantom($0) }
            nextCursor = page.nextCursor
            self.error = nil
        } catch {
            guard loads.owns(token), !Task.isCancelled, !Self.isCancellation(error) else { return }
            if entries.isEmpty {
                self.error = "Couldn't load activity."
            } else {
                self.error = "Couldn't refresh. The list is unchanged."
            }
        }
    }

    func loadOlder() async {
        guard let cursor = nextCursor, !cursor.isEmpty, !isLoading, !isLoadingOlder else { return }
        isLoadingOlder = true
        olderError = nil
        let token = loads.begin()
        defer {
            if loads.owns(token) {
                isLoadingOlder = false
            }
        }
        do {
            let page = try await APIClient.shared.assetActivity(
                assetId: assetId,
                scope: scope,
                cursor: cursor
            )
            guard loads.owns(token), !Task.isCancelled else { return }
            let known = Set(entries.map(\.id))
            let older = page.entries.filter { known.contains($0.id) == false && !ItemActivityCopy.isPhantom($0) }
            entries.append(contentsOf: older)
            nextCursor = page.nextCursor == cursor ? nil : page.nextCursor
            self.olderError = nil
        } catch {
            guard loads.owns(token), !Task.isCancelled, !Self.isCancellation(error) else { return }
            self.olderError = "Couldn't load older entries."
        }
    }

    private static func isCancellation(_ error: Error) -> Bool {
        if error is CancellationError { return true }
        if let urlError = error as? URLError, urlError.code == .cancelled { return true }
        if case APIError.networkError(let underlying) = error,
           let urlError = underlying as? URLError, urlError.code == .cancelled {
            return true
        }
        return false
    }
}

struct ItemActivityLink: View {
    let assetId: String
    let assetName: String

    var body: some View {
        NavigationLink {
            ItemActivityView(assetId: assetId, assetName: assetName)
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "clock.arrow.circlepath")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .frame(width: 24)
                    .accessibilityHidden(true)
                Text("Activity")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.primary)
                Spacer(minLength: 8)
                Image(systemName: "chevron.right")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
            .padding(Brand.Space.md)
            .contentShape(Rectangle())
            .brandCard(padding: 0)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Activity")
        .accessibilityHint("Shows item updates and bookings")
    }
}

struct ItemActivityView: View {
    let assetName: String

    @State private var model: ItemActivityModel
    @Environment(SessionStore.self) private var session

    init(assetId: String, assetName: String) {
        self.assetName = assetName
        _model = State(initialValue: ItemActivityModel(assetId: assetId))
    }

    private var canReadActivity: Bool {
        let role = session.currentUser?.role ?? ""
        return role == "STAFF" || role == "ADMIN"
    }

    var body: some View {
        VStack(spacing: 0) {
            if canReadActivity {
                scopePicker
                activityList
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ContentUnavailableView {
                    Label("Activity", systemImage: "clock.arrow.circlepath")
                } description: {
                    Text("Activity is available to staff.")
                }
            }
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle("Activity")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: model.scope) {
            guard canReadActivity else { return }
            await model.reload()
        }
    }

    private var scopePicker: some View {
        Picker("Show", selection: Binding(
            get: { model.scope },
            set: { model.applyScope($0) }
        )) {
            ForEach(AssetActivityScope.allCases) { scope in
                Text(scope.label).tag(scope)
            }
        }
        .pickerStyle(.segmented)
        .padding(.horizontal, Brand.Space.md)
        .padding(.vertical, Brand.Space.sm)
        .accessibilityLabel("Activity")
    }

    @ViewBuilder
    private var activityList: some View {
        if model.isLoading && model.entries.isEmpty {
            loadingState
        } else if let message = model.error, model.entries.isEmpty {
            failureState(message)
        } else {
            loadedList
        }
    }

    private var loadingState: some View {
        HStack(spacing: 8) {
            ProgressView()
            Text("Loading activity")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Loading activity")
    }

    private func failureState(_ message: String) -> some View {
        VStack(spacing: Brand.Space.sm) {
            Text(message)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button("Retry") {
                Task { await model.reload() }
            }
            .buttonStyle(.bordered)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(Brand.Space.md)
    }

    private var loadedList: some View {
        List {
            if let message = model.error, !model.entries.isEmpty {
                Section {
                    Text(message)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
            if model.entries.isEmpty {
                Section {
                    Text("No activity recorded for this scope.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            } else {
                ForEach(ItemActivityCopy.days(from: model.entries)) { day in
                    Section(day.title) {
                        ForEach(day.entries) { entry in
                            row(entry)
                        }
                    }
                }
            }
            if model.nextCursor != nil {
                Section {
                    Button {
                        Task { await model.loadOlder() }
                    } label: {
                        if model.isLoadingOlder {
                            ProgressView()
                                .frame(maxWidth: .infinity, minHeight: 44)
                        } else {
                            Text("Load older entries")
                                .frame(maxWidth: .infinity, minHeight: 44)
                        }
                    }
                    .disabled(model.isLoading || model.isLoadingOlder)
                }
            }
            if let olderError = model.olderError {
                Section {
                    Text(olderError)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .listStyle(.insetGrouped)
        .refreshable { await model.reload() }
    }

    @ViewBuilder
    private func row(_ entry: AssetActivityEntry) -> some View {
        if entry.linksToBooking {
            NavigationLink(destination: BookingDetailView(bookingId: entry.entityId)) {
                rowLabel(entry)
            }
            .accessibilityHint("Opens the booking")
        } else {
            rowLabel(entry)
        }
    }

    private func rowLabel(_ entry: AssetActivityEntry) -> some View {
        let sentence = ItemActivityCopy.sentence(for: entry, itemName: assetName)
        let detail = ItemActivityCopy.detail(for: entry)
        return VStack(alignment: .leading, spacing: 2) {
            Text(entry.actorLabel)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.primary)
            Text(sentence)
                .font(.subheadline)
                .foregroundStyle(sentenceColor(ItemActivityCopy.tone(for: entry.action)))
                .fixedSize(horizontal: false, vertical: true)
            if let detail {
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Text(ItemActivityCopy.timeLabel(entry.createdAt))
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText(entry, sentence: sentence, detail: detail))
    }

    private func accessibilityText(_ entry: AssetActivityEntry, sentence: String, detail: String?) -> String {
        var parts = [entry.actorLabel, sentence]
        if let detail { parts.append(detail) }
        parts.append(ItemActivityCopy.timeLabel(entry.createdAt))
        return parts.joined(separator: ", ")
    }

    private func sentenceColor(_ tone: ItemActivityCopy.Tone) -> Color {
        switch tone {
        case .problem:
            Color.statusText(.red)
        case .caution:
            Color.statusText(.orange)
        case .neutral:
            Color.primary
        }
    }
}
