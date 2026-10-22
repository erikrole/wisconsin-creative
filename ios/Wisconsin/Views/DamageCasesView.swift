import SwiftUI

@MainActor
@Observable
final class DamageCasesModel {
    var view: DamageCaseView = AppRuntimeMode.CaptureSeed.damageQueueClosed ? .closed : .open {
        didSet { if view != oldValue { Task { await load(force: true) } } }
    }
    var list: DamageCaseList?
    var isLoading = false
    var error: String?

    @ObservationIgnored private var loads = LatestRequestGeneration()

    func load(force: Bool = false) async {
        let requested = view
        if !force, list != nil { return }
        let token = loads.begin()
        isLoading = true
        defer { if loads.owns(token) { isLoading = false } }
        do {
            let next = try await APIClient.shared.damageCases(view: requested)
            guard loads.owns(token), view == requested, !Task.isCancelled else { return }
            list = next
            error = nil
        } catch is CancellationError {
            return
        } catch {
            guard loads.owns(token), view == requested, !Task.isCancelled else { return }
            self.error = error.localizedDescription
        }
    }
}

enum DamageCaseFilter: String, CaseIterable, Identifiable {
    case all, missing, damaged
    var id: String { rawValue }
    var label: String {
        switch self {
        case .all: "All"
        case .missing: "Missing"
        case .damaged: "Damaged"
        }
    }

    func matches(_ item: DamageCase) -> Bool {
        switch self {
        case .all: true
        case .missing: item.isMissing
        case .damaged: !item.isMissing
        }
    }
}

/// Staff triage queue for damaged and missing gear. Closing a case releases or
/// retires the item the same way the website's Damage and loss page does.
struct DamageCasesView: View {
    var wrapsInNavigationStack = true

    @State private var model = DamageCasesModel()
    @State private var filter: DamageCaseFilter = .all
    @State private var detail: DamageCase?
    @State private var resolving: DamageCase?
    @State private var toast: Toast?
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        if wrapsInNavigationStack {
            NavigationStack { screen }
        } else {
            screen
        }
    }

    private var screen: some View {
        content
            .navigationTitle("Damage and loss")
            .navigationBarTitleDisplayMode(.large)
            .toast($toast)
            .task {
                await model.load()
                seedCapture()
            }
            .refreshable { await model.load(force: true) }
            .navigationDestination(item: $detail) { item in
                DamageCaseDetailView(item: item) { message in
                    toast = Toast(message: message, icon: "checkmark.circle.fill", role: .success)
                    Task { await model.load(force: true) }
                }
            }
            .sheet(item: $resolving) { item in
                RecordOutcomeSheet(reportId: item.id, isMissing: item.isMissing) { message in
                    toast = Toast(message: message, icon: "checkmark.circle.fill", role: .success)
                    Task { await model.load(force: true) }
                }
            }
    }

    /// Capture scenarios open the detail or the sheet on the first open case.
    private func seedCapture() {
        guard let first = model.list?.cases.first else { return }
        if AppRuntimeMode.CaptureSeed.damageQueueDetail { detail = first }
        if AppRuntimeMode.CaptureSeed.damageQueueRecord { resolving = first }
    }

    @ViewBuilder
    private var content: some View {
        if let list = model.list {
            queue(list)
        } else if model.isLoading {
            ProgressView("Loading cases")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ContentUnavailableView {
                Label("Couldn't load cases", systemImage: "exclamationmark.triangle")
            } description: {
                Text(model.error ?? "The damage and loss queue is unavailable right now.")
            } actions: {
                Button("Try again") { Task { await model.load(force: true) } }
            }
        }
    }

    private func queue(_ list: DamageCaseList) -> some View {
        let shown = list.cases.filter(filter.matches)
        return List {
            Section {
                Picker("Cases", selection: $model.view) {
                    Text("Open (\(list.counts.open))").tag(DamageCaseView.open)
                    Text("Closed (\(list.counts.closed))").tag(DamageCaseView.closed)
                }
                .pickerStyle(.segmented)
                .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                Picker("Type", selection: $filter) {
                    ForEach(DamageCaseFilter.allCases) { Text($0.label).tag($0) }
                }
                .pickerStyle(.menu)
                .frame(minHeight: 44)
            } footer: {
                if model.view == .open, list.counts.missing > 0 {
                    Text("\(list.counts.missing) missing. A missing item is held until its case is closed.")
                }
            }

            if let error = model.error {
                Section {
                    Text(error).font(.footnote).foregroundStyle(Color.statusText(.red))
                }
            }

            if shown.isEmpty {
                Section {
                    ContentUnavailableView(
                        emptyTitle,
                        systemImage: model.view == .open ? "checkmark.seal" : "tray",
                        description: Text(emptyDetail)
                    )
                    .listRowBackground(Color.clear)
                }
            } else {
                Section {
                    ForEach(shown) { item in
                        Button { detail = item } label: { rowContent(item) }
                            .buttonStyle(.plain)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    private var emptyTitle: String {
        if filter != .all { return "No \(filter.label.lowercased()) cases" }
        return model.view == .open ? "No open cases" : "No closed cases"
    }

    private var emptyDetail: String {
        if filter != .all { return "Try a different type." }
        return model.view == .open ? "Nothing is waiting on staff." : "Closed cases will show up here."
    }

    @ViewBuilder
    private func titleLine(_ item: DamageCase) -> some View {
        if dynamicTypeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 4) {
                Text(item.item.tag).font(.headline)
                DamageCaseStatusPill(item: item)
            }
        } else {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(item.item.tag).font(.headline)
                Spacer(minLength: 4)
                DamageCaseStatusPill(item: item)
            }
        }
    }

    private func rowContent(_ item: DamageCase) -> some View {
        HStack(alignment: .top, spacing: 12) {
            DamageCaseThumbnail(url: item.thumbnailURL, size: 52)
            VStack(alignment: .leading, spacing: 4) {
                titleLine(item)
                Text(item.item.label)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                Text(item.rowMeta)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                if item.stillBookable {
                    HStack(spacing: 4) {
                        Image(systemName: "exclamationmark.triangle.fill").accessibilityHidden(true)
                        Text("Still bookable")
                    }
                    .font(.caption)
                    .foregroundStyle(Color.statusText(.orange))
                }
            }
            Image(systemName: "chevron.right")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.tertiary)
                .padding(.top, 6)
                .accessibilityHidden(true)
        }
        .frame(minHeight: 44)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
    }
}

struct DamageCaseThumbnail: View {
    let url: URL?
    let size: CGFloat

    var body: some View {
        Group {
            if let url {
                CachedThumbnail(url: url, size: size, placeholderSystemImage: "bag", contentMode: .fill)
            } else {
                Image(systemName: "bag")
                    .font(.system(size: size * 0.36))
                    .foregroundStyle(Color(.systemGray3))
            }
        }
        .frame(width: size, height: size)
        .background(Color(.systemGray6))
        .clipShape(RoundedRectangle(cornerRadius: Brand.Radius.sm, style: .continuous))
        .accessibilityHidden(true)
    }
}

/// Missing red, Damaged amber, and a neutral outcome once closed.
struct DamageCaseStatusPill: View {
    let item: DamageCase

    private var tone: StatusTone {
        if !item.isOpen { return .gray }
        return item.isMissing ? .red : .orange
    }

    private var text: String {
        if let resolution = item.resolution { return DamageResolution(rawValue: resolution)?.label ?? "Closed" }
        return item.isMissing ? "Missing" : "Damaged"
    }

    var body: some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .lineLimit(1)
            .fixedSize()
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(Color.statusBackground(tone), in: Capsule())
            .foregroundStyle(Color.statusText(tone))
    }
}

/// One case: evidence, what was said, who had it, when, and the way to close it.
struct DamageCaseDetailView: View {
    let item: DamageCase
    let onResolved: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var showOutcome = false
    @State private var photo: DamageCasePhoto?

    var body: some View {
        ScrollView {
            VStack(spacing: Brand.Space.sm) {
                header
                if let url = item.photoURL { photoCard(url) }
                reportCard
                if let booking = item.booking { checkoutLink(booking) }
                if item.isOpen { outcomeButton } else { closedCard }
            }
            .padding(.horizontal, Brand.Space.md)
            .padding(.top, Brand.Space.sm)
            .padding(.bottom, 40)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle(item.isMissing ? "Missing item" : "Damage report")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showOutcome) {
            RecordOutcomeSheet(reportId: item.id, isMissing: item.isMissing) { message in
                dismiss()
                onResolved(message)
            }
        }
        .fullScreenCover(item: $photo) { photo in
            ZoomableImageViewer(url: photo.url, photoLabel: "Evidence photo")
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                DamageCaseThumbnail(url: item.thumbnailURL, size: 64)
                VStack(alignment: .leading, spacing: 4) {
                    Text(item.item.tag).font(.title3.weight(.semibold))
                    Text(item.item.label).font(.subheadline).foregroundStyle(.secondary)
                    DamageCaseStatusPill(item: item)
                }
                Spacer(minLength: 0)
            }
            if item.item.isAsset {
                NavigationLink(destination: ItemDetailView(assetId: item.item.id)) {
                    HStack {
                        Text("View item").font(.subheadline)
                        Spacer(minLength: 8)
                        Image(systemName: "chevron.right").font(.caption2.weight(.semibold)).foregroundStyle(.tertiary)
                    }
                    .frame(minHeight: 44)
                }
                .buttonStyle(.plain)
            }
            if item.stillBookable {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Image(systemName: "exclamationmark.triangle.fill").accessibilityHidden(true)
                    Text("Still bookable. Close the case or flag maintenance.")
                }
                .font(.footnote)
                .foregroundStyle(Color.statusText(.orange))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .brandCard()
    }

    private func photoCard(_ url: URL) -> some View {
        Button { photo = DamageCasePhoto(url: url) } label: {
            CachedThumbnail(url: url, size: 320, contentMode: .fill)
                .frame(maxWidth: .infinity)
                .frame(height: 200)
                .clipped()
                .clipShape(RoundedRectangle(cornerRadius: Brand.Radius.sm, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Open evidence photo")
        .brandCard()
    }

    private var reportCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Report")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .textCase(.uppercase)
            Text(item.note.isEmpty ? "No description was provided." : item.note)
                .font(.subheadline)
                .foregroundStyle(item.note.isEmpty ? .secondary : .primary)
                .fixedSize(horizontal: false, vertical: true)
            Divider()
            fact("Reported by", item.reportedBy)
            fact("Reported", item.reportedAt.formatted(date: .abbreviated, time: .shortened))
            if let responsible = item.responsible { fact("Had it", responsible.name) }
            if item.booking == nil { fact("Source", "Item page") }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .brandCard()
    }

    private func fact(_ title: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title).font(.subheadline).foregroundStyle(.secondary)
            Spacer(minLength: 12)
            Text(value).font(.subheadline).multilineTextAlignment(.trailing)
        }
        .accessibilityElement(children: .combine)
    }

    private func checkoutLink(_ booking: DamageCase.Booking) -> some View {
        NavigationLink(destination: BookingDetailView(bookingId: booking.id)) {
            HStack(spacing: 8) {
                Text("View checkout · \(booking.title)")
                    .font(.subheadline)
                    .multilineTextAlignment(.leading)
                    .lineLimit(2)
                Spacer(minLength: 8)
                Image(systemName: "chevron.right").font(.caption2.weight(.semibold)).foregroundStyle(.tertiary)
            }
            .frame(minHeight: 44)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(.plain)
        .brandCard()
    }

    private var outcomeButton: some View {
        Button { showOutcome = true } label: {
            Label("Record outcome", systemImage: "checkmark.seal")
                .font(.subheadline.weight(.semibold))
                .frame(maxWidth: .infinity, minHeight: 44)
        }
        .buttonStyle(.borderedProminent)
        .controlSize(.large)
        .tint(Color.statusText(.purple))
        .accessibilityHint("Closes this case and releases or retires the item")
    }

    @ViewBuilder
    private var closedCard: some View {
        if let label = item.outcomeLabel {
            VStack(alignment: .leading, spacing: 8) {
                Label(label, systemImage: "checkmark.circle.fill")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.statusText(.green))
                if let resolvedAt = item.resolvedAt {
                    Text("Closed \(resolvedAt.formatted(date: .abbreviated, time: .shortened))")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                if let note = item.resolutionNote?.trimmingCharacters(in: .whitespacesAndNewlines), !note.isEmpty {
                    Text(note).font(.subheadline).fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .brandCard()
            .accessibilityElement(children: .combine)
        }
    }
}

private struct DamageCasePhoto: Identifiable {
    let url: URL
    var id: String { url.absoluteString }
}
