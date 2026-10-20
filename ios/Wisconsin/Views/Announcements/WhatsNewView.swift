import SwiftUI

/// Every announcement this person could have been shown, newest first. The
/// splash is the first look; this is where it lives afterwards. Tapping a row
/// reopens the same sheet the splash used, so the button still works.
@MainActor
@Observable
final class WhatsNewViewModel {
    private(set) var entries: [AnnouncementHistoryEntry] = []
    private(set) var isLoading = false
    private(set) var error: String?
    private var loadGeneration = 0

    func load(forceRefresh: Bool = false) async {
        if !forceRefresh, isLoading { return }
        loadGeneration += 1
        let generation = loadGeneration
        isLoading = true
        if forceRefresh { error = nil }
        do {
            let rows = try await APIClient.shared.announcementHistory()
            guard generation == loadGeneration else { return }
            entries = rows
            error = nil
            isLoading = false
        } catch is CancellationError {
            if generation == loadGeneration { isLoading = false }
        } catch {
            guard generation == loadGeneration else { return }
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            isLoading = false
        }
    }
}

struct WhatsNewView: View {
    var wrapsInNavigationStack = true

    @Environment(AppState.self) private var appState
    @Environment(\.openURL) private var openURL
    @State private var vm = WhatsNewViewModel()
    @State private var selected: AnnouncementHistoryEntry?

    var body: some View {
        if wrapsInNavigationStack {
            NavigationStack { configuredContent }
        } else {
            configuredContent
        }
    }

    private var configuredContent: some View {
        content
            .navigationTitle("What's new")
            .navigationBarTitleDisplayMode(.large)
            .refreshable { await vm.load(forceRefresh: true) }
            .task { await vm.load() }
            .sheet(item: $selected) { entry in
                AnnouncementSplashSheet(
                    announcement: entry.announcement,
                    onPrimary: {
                        selected = nil
                        openAnnouncementTarget(of: entry.announcement, appState: appState, openURL: openURL)
                    },
                    onClose: { selected = nil }
                )
            }
    }

    @ViewBuilder
    private var content: some View {
        if vm.entries.isEmpty && vm.isLoading {
            ProgressView("Loading announcements")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if vm.entries.isEmpty, let error = vm.error {
            ContentUnavailableView {
                Label("Couldn't load announcements", systemImage: "wifi.exclamationmark")
            } description: {
                Text(error)
            } actions: {
                Button("Try again") {
                    Task { await vm.load(forceRefresh: true) }
                }
                .buttonStyle(.borderedProminent)
            }
        } else if vm.entries.isEmpty {
            ContentUnavailableView {
                Label("Nothing yet", systemImage: "sparkles")
            } description: {
                Text("App announcements show here after they go out.")
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
                        Button {
                            selected = entry
                        } label: {
                            WhatsNewRow(entry: entry)
                        }
                        .buttonStyle(.plain)
                        .accessibilityHint("Opens the announcement")
                    }
                } footer: {
                    Text("Announcements you were shown stay here after you dismiss them.")
                }
            }
            .listStyle(.insetGrouped)
        }
    }
}

private struct WhatsNewRow: View {
    let entry: AnnouncementHistoryEntry

    private var announcement: ActiveAnnouncement { entry.announcement }

    private var tone: StatusTone {
        switch announcement.kind {
        case "FEATURE": .purple
        case "UPDATE": .blue
        default: .orange
        }
    }

    private var preview: String? {
        for block in announcement.blocks {
            switch block {
            case .paragraph(let text): return text
            case .list(let items): if let first = items.first { return first }
            }
        }
        return nil
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: announcement.kindSymbol)
                .font(.body.weight(.regular))
                .foregroundStyle(Color.statusText(tone))
                .frame(width: 34, height: 34)
                .background(Color.statusText(tone).opacity(0.12), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 5) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    StatusPill(label: announcement.kindLabel, tone: tone)
                    if entry.isUnseen {
                        Text("Unread")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(Color.statusText(.red))
                    }
                    Spacer(minLength: 8)
                    if let date = announcement.publishedDate {
                        Text(date, format: .dateTime.month(.abbreviated).day())
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
                Text(announcement.title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.primary)
                    .lineLimit(2)
                if let preview {
                    Text(preview)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            }
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}
