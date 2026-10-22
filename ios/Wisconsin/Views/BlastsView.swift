import SwiftUI

private struct BlastRoute: Hashable {
    let id: String
}

@MainActor
@Observable
final class BlastsViewModel {
    private(set) var entries: [RememberedBlast] = []
    private(set) var isLoading = false
    private(set) var error: String?
    private(set) var actionError: String?
    private(set) var acknowledgingId: String?
    private var userId: String?
    private var reportedRead: Set<String> = []
    private var loadGeneration = 0

    func entry(id: String) -> RememberedBlast? {
        entries.first { $0.id == id }
    }

    func load(userId: String, forceRefresh: Bool = false) async {
        self.userId = userId
        if entries.isEmpty {
            entries = BlastArchive.load(userId: userId)
        }
        if !forceRefresh, isLoading { return }

        loadGeneration += 1
        let generation = loadGeneration
        isLoading = true
        if forceRefresh { error = nil }

        do {
            let active = try await APIClient.shared.activeBlasts()
            guard generation == loadGeneration else { return }
            BlastArchive.recordActive(active, userId: userId)
            entries = BlastArchive.load(userId: userId)
            error = nil
            isLoading = false
        } catch is CancellationError {
            // A newer load owns the spinner. Leaving this one true would make
            // the next appearance skip the fetch.
            if generation == loadGeneration { isLoading = false }
            return
        } catch {
            guard generation == loadGeneration else { return }
            if entries.isEmpty {
                entries = BlastArchive.load(userId: userId)
            }
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            isLoading = false
        }
    }

    func markRead(_ id: String) {
        guard reportedRead.insert(id).inserted else { return }
        Task { try? await APIClient.shared.markBlastRead(id: id) }
    }

    func acknowledge(_ id: String) async {
        guard acknowledgingId == nil, userId != nil else { return }
        acknowledgingId = id
        actionError = nil
        defer { acknowledgingId = nil }
        do {
            try await APIClient.shared.acknowledgeBlast(id: id)
        } catch APIError.notFound {
            BlastArchive.markAcknowledged(id)
        } catch {
            actionError = (error as? APIError)?.errorDescription ?? error.localizedDescription
            return
        }
        if let userId {
            entries = BlastArchive.load(userId: userId)
        }
    }
}

struct BlastsView: View {
    var wrapsInNavigationStack = true

    @Environment(SessionStore.self) private var session
    @State private var vm = BlastsViewModel()
    @State private var navigationPath = NavigationPath()
    @State private var showCompose = false
    @State private var sentConfirmation: String?

    /// Staff and admins send blasts and track them; everyone else only receives.
    private var canSend: Bool {
        let role = session.currentUser?.role ?? ""
        return role == "STAFF" || role == "ADMIN"
    }

    var body: some View {
        if wrapsInNavigationStack {
            NavigationStack(path: $navigationPath) { configuredContent }
        } else {
            configuredContent
        }
    }

    private var configuredContent: some View {
        content
            .navigationTitle("Blasts")
            .navigationBarTitleDisplayMode(.large)
            .refreshable {
                guard let userId = session.currentUser?.id else { return }
                await vm.load(userId: userId, forceRefresh: true)
            }
            .task {
                guard let userId = session.currentUser?.id else { return }
                await vm.load(userId: userId)
            }
            .toolbar {
                if canSend {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            showCompose = true
                        } label: {
                            Label("New Blast", systemImage: "square.and.pencil")
                        }
                    }
                }
            }
            .sheet(isPresented: $showCompose) {
                ComposeBlastSheet { receipt in
                    sentConfirmation = "Sent to \(receipt.recipientCount) \(receipt.recipientCount == 1 ? "person" : "people")."
                }
            }
            .navigationDestination(for: SentBlastsRoute.self) { _ in
                SentBlastsView()
            }
            .navigationDestination(for: SentBlastRoute.self) { route in
                SentBlastDetailView(id: route.id)
            }
            .navigationDestination(for: BlastRoute.self) { route in
                if let entry = vm.entry(id: route.id) {
                    BlastDetailView(
                        entry: entry,
                        isAcknowledging: vm.acknowledgingId == entry.id,
                        actionError: vm.actionError,
                        onAcknowledge: { Task { @MainActor in await vm.acknowledge(entry.id) } },
                        onAppear: { vm.markRead(entry.id) }
                    )
                } else {
                    ContentUnavailableView {
                        Label("Blast not found", systemImage: "megaphone")
                    } description: {
                        Text("It is no longer on this phone.")
                    }
                }
            }
    }

    @ViewBuilder
    private var content: some View {
        if canSend {
            staffList
        } else {
            receivedContent
        }
    }

    /// Staff always get the list, so Sent and the compose result are reachable
    /// even before this phone has received anything.
    private var staffList: some View {
        List {
            if let sentConfirmation {
                Section {
                    Label(sentConfirmation, systemImage: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                }
            }
            Section {
                NavigationLink(value: SentBlastsRoute()) {
                    Label("Sent", systemImage: "paperplane")
                }
            } footer: {
                Text("Blasts the team has sent, with who has acknowledged them.")
            }
            if let error = vm.error {
                Section {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            Section("Received") {
                if vm.entries.isEmpty {
                    Text(vm.isLoading ? "Loading…" : "Nothing received on this phone yet.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(vm.entries) { entry in
                        NavigationLink(value: BlastRoute(id: entry.id)) {
                            BlastListRow(entry: entry)
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    @ViewBuilder
    private var receivedContent: some View {
        if vm.entries.isEmpty && vm.isLoading {
            ProgressView("Loading blasts")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if vm.entries.isEmpty, let error = vm.error {
            ContentUnavailableView {
                Label("Couldn't load blasts", systemImage: "wifi.exclamationmark")
            } description: {
                Text(error)
            } actions: {
                Button("Try again") {
                    guard let userId = session.currentUser?.id else { return }
                    Task { await vm.load(userId: userId, forceRefresh: true) }
                }
                .buttonStyle(.borderedProminent)
            }
        } else if vm.entries.isEmpty {
            ContentUnavailableView {
                Label("No blasts yet", systemImage: "megaphone")
            } description: {
                Text("When someone sends a blast, it stays here after you dismiss the banner.")
            }
        } else {
            List {
                if let error = vm.error {
                    Section {
                        Text(error)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
                Section {
                    ForEach(vm.entries) { entry in
                        NavigationLink(value: BlastRoute(id: entry.id)) {
                            BlastListRow(entry: entry)
                        }
                    }
                } footer: {
                    Text("Blasts you have opened on this phone stay here after you dismiss them.")
                }
            }
            .listStyle(.insetGrouped)
        }
    }
}

private struct BlastListRow: View {
    let entry: RememberedBlast

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                StatusPill(label: entry.blast.severity.blastLabel, tone: entry.blast.severity.blastTone)
                if entry.acknowledged {
                    Text("Acknowledged")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                if let when = entry.blast.sentAt?.blastRelativeTime {
                    Text(when)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            Text(entry.blast.title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.primary)
                .lineLimit(2)
            Text(entry.blast.body)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineLimit(2)
            if let sender = entry.blast.senderName, !sender.isEmpty {
                Text("Sent by \(sender)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}

private struct BlastDetailView: View {
    let entry: RememberedBlast
    let isAcknowledging: Bool
    let actionError: String?
    let onAcknowledge: () -> Void
    let onAppear: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                StatusPill(label: entry.blast.severity.blastLabel, tone: entry.blast.severity.blastTone)
                Text(entry.blast.title)
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(.primary)
                    .fixedSize(horizontal: false, vertical: true)
                Text(entry.blast.body)
                    .font(.body)
                    .foregroundStyle(.primary)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
                VStack(alignment: .leading, spacing: 4) {
                    if let sender = entry.blast.senderName, !sender.isEmpty {
                        Text("Sent by \(sender)")
                    }
                    if let when = entry.blast.sentAt?.blastDetailTime {
                        Text(when)
                    }
                    if entry.acknowledged {
                        Text("Acknowledged")
                    }
                }
                .font(.subheadline)
                .foregroundStyle(.secondary)
                if let actionError, !entry.acknowledged {
                    Text(actionError)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityLabel("Couldn't acknowledge. \(actionError)")
                }
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle("Blast")
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) {
            if !entry.acknowledged {
                Button(action: onAcknowledge) {
                    Text(isAcknowledging ? "Saving" : "Got it")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .tint(Color.primary)
                .disabled(isAcknowledging)
                .padding(.horizontal, 20)
                .padding(.vertical, 12)
                .background(.bar)
                .accessibilityLabel("Acknowledge: \(entry.blast.title)")
            }
        }
        .task(id: entry.id) {
            onAppear()
        }
    }
}

extension BlastSeverity {
    var blastLabel: String {
        switch self {
        case .info: "Info"
        case .warning: "Warning"
        case .urgent: "Urgent"
        case .unknown: "Update"
        }
    }

    var blastTone: StatusTone {
        switch self {
        case .urgent: StatusTone.red
        case .warning: StatusTone.orange
        case .info, .unknown: StatusTone.blue
        }
    }
}

private extension Date {
    var blastRelativeTime: String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: self, relativeTo: Date())
    }

    var blastDetailTime: String {
        formatted(date: .abbreviated, time: .shortened)
    }
}
