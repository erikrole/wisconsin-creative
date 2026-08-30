import SwiftUI
import UIKit

@MainActor
@Observable
final class GuidesViewModel {
    var guides: [GuideListItem] = []
    var isLoading = false
    var error: String?

    private var lastLoadedAt: Date?
    private var loadTask: Task<Void, Never>?
    private static let freshnessWindow: TimeInterval = 60

    func load(forceRefresh: Bool = false) async {
        if !forceRefresh,
           let lastLoadedAt,
           Date().timeIntervalSince(lastLoadedAt) < Self.freshnessWindow,
           !guides.isEmpty {
            return
        }

        // A pull-to-refresh has to supersede an in-flight load. Bailing on
        // `isLoading` instead snapped the refresh control back immediately and
        // left the stale list in place, and two overlapping loads applied
        // whichever response happened to land last.
        if forceRefresh {
            loadTask?.cancel()
        } else if isLoading {
            return
        }

        let task = Task { await performLoad(forceRefresh: forceRefresh) }
        loadTask = task
        await task.value
    }

    private func performLoad(forceRefresh: Bool) async {
        isLoading = true
        if forceRefresh { error = nil }

        do {
            let fetched = try await APIClient.shared.guides()
            guard !Task.isCancelled else { return }
            guides = fetched
            error = nil
            lastLoadedAt = Date()
        } catch is CancellationError {
            // Superseded by a newer load, which owns `isLoading` from here.
            return
        } catch {
            guard !Task.isCancelled else { return }
            self.error = error.localizedDescription
        }

        isLoading = false
    }

    /// Clears the loaded library so the next `load` refetches. Used by the
    /// tab-reset gesture, which returns the destination to a first-run state.
    func resetDefaults() {
        loadTask?.cancel()
        guides = []
        error = nil
        lastLoadedAt = nil
        isLoading = false
    }
}

struct GuidesView: View {
    var wrapsInNavigationStack = true

    @Environment(SessionStore.self) private var session
    @Environment(AppState.self) private var appState
    @State private var vm = GuidesViewModel()
    @State private var navigationPath = NavigationPath()
    @State private var searchText = ""
    @State private var focus: GuideFocus = .all
    @State private var sort: GuideSort = .recommended

    private var hasFilter: Bool {
        focus != .all || !searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var filteredGuides: [GuideListItem] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let currentRole = session.currentUser?.role ?? ""
        let visible = vm.guides.filter { guide in
            focus.includes(guide, currentRole: currentRole) &&
                (query.isEmpty || guide.searchIndex.contains(query))
        }

        switch sort {
        case .recommended:
            return visible
        case .recent:
            return visible.sorted { guideDate($0.updatedAt) > guideDate($1.updatedAt) }
        case .title:
            return visible.sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
        }
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
            .navigationTitle("Guides")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(
                text: $searchText,
                placement: .navigationBarDrawer(displayMode: .always),
                prompt: Text("Search guides")
            )
            .refreshable { await vm.load(forceRefresh: true) }
            .task { await vm.load() }
            .navigationDestination(for: GuideListItem.self) { guide in
                GuideReaderView(guide: guide)
            }
            // Re-selecting the destination returns it to a first-run state, the
            // same gesture Home, Bookings, Browse, Schedule, and Users honour.
            .onChange(of: appState.tabResetToken) { _, _ in
                guard appState.resetTab == 6 else { return }
                navigationPath = NavigationPath()
                clearFilters()
                vm.resetDefaults()
                Task { await vm.load() }
            }
            .toolbar {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Menu {
                        Picker("Focus", selection: $focus) {
                            ForEach(GuideFocus.allCases) { focus in
                                Label(focus.label, systemImage: focus.systemImage).tag(focus)
                            }
                        }
                    } label: {
                        // Filled glyph plus the shared control tint is how every
                        // other list in the app says "a filter is narrowing this".
                        Label(
                            "Focus",
                            systemImage: "line.3.horizontal.decrease.circle\(focus == .all ? "" : ".fill")"
                        )
                    }
                    .listControlTint(isActive: focus != .all)
                    .accessibilityLabel(focus == .all ? "Guide focus" : "Guide focus, \(focus.label)")

                    Menu {
                        Picker("Sort", selection: $sort) {
                            ForEach(GuideSort.allCases) { sort in
                                Text(sort.label).tag(sort)
                            }
                        }
                    } label: {
                        Label("Sort", systemImage: "arrow.up.arrow.down")
                    }
                    .listControlTint(isActive: sort != .recommended)
                    .accessibilityLabel(sort == .recommended ? "Sort guides" : "Sort guides, \(sort.label)")
                }
            }
    }

    private func clearFilters() {
        searchText = ""
        focus = .all
        sort = .recommended
    }

    @ViewBuilder
    private var content: some View {
        if vm.guides.isEmpty && vm.isLoading {
            guidePlaceholderList
        } else if let error = vm.error, vm.guides.isEmpty {
            ContentUnavailableView {
                Label("Couldn't load guides", systemImage: "exclamationmark.triangle")
            } description: {
                Text(error)
            } actions: {
                Button("Retry") { Task { await vm.load(forceRefresh: true) } }
                    .buttonStyle(.borderedProminent)
            }
        } else if vm.guides.isEmpty {
            ContentUnavailableView(
                "No guides",
                systemImage: "book.closed",
                description: Text("Published guides will appear here.")
            )
        } else {
            guideList
        }
    }

    private var guidePlaceholderList: some View {
        ZStack {
            List {
                Section {
                    ForEach(GuideListItem.placeholders) { guide in
                        GuideRow(guide: guide)
                            .redacted(reason: .placeholder)
                    }
                }
            }
            .listStyle(.insetGrouped)
            .disabled(true)
            .accessibilityHidden(true)

            ProgressView("Loading guides")
        }
    }

    private var guideList: some View {
        List {
            if let error = vm.error {
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        Label(error, systemImage: "wifi.exclamationmark")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        Button("Retry") { Task { await vm.load(forceRefresh: true) } }
                            .buttonStyle(.bordered)
                    }
                    .padding(.vertical, 2)
                }
            }

            Section {
                ForEach(filteredGuides) { guide in
                    NavigationLink(value: guide) {
                        GuideRow(guide: guide)
                    }
                }
            } header: {
                Text(listHeader)
            }

            if filteredGuides.isEmpty {
                Section {
                    ContentUnavailableView {
                        Label("No guides match", systemImage: "magnifyingglass")
                    } description: {
                        Text(filteredEmptyDescription)
                    } actions: {
                        // A dead end needs a way out — the web library offers the
                        // same clear-filters recovery.
                        Button("Clear filters") { clearFilters() }
                            .buttonStyle(.borderedProminent)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    /// Names the filter that actually emptied the list, so the reader knows
    /// which control to undo rather than guessing between search and focus.
    private var filteredEmptyDescription: String {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        switch (query.isEmpty, focus == .all) {
        case (false, false):
            return "Nothing matches \"\(query)\" in \(focus.label)."
        case (false, true):
            return "Nothing matches \"\(query)\"."
        case (true, false):
            return "No guides are filed under \(focus.label)."
        case (true, true):
            return "Try a different search or focus."
        }
    }

    private var listHeader: String {
        let count = filteredGuides.count
        let total = vm.guides.count
        if searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && focus == .all {
            return total == 1 ? "1 guide" : "\(total) guides"
        }
        return "\(count) of \(total)"
    }
}

private struct GuideRow: View {
    let guide: GuideListItem

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(Color.cardSurfaceRaised)
                    .overlay {
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .strokeBorder(Color.secondary.opacity(0.22))
                    }
                Image(systemName: guide.type.systemImage)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.statusText(guide.type.tone))
            }
            .frame(width: 38, height: 38)

            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(guide.title)
                        .font(.headline)
                        .lineLimit(2)
                        .minimumScaleFactor(0.85)
                    if !guide.published {
                        StatusPill(label: "Draft", tone: .gray)
                    }
                }

                HStack(spacing: 8) {
                    StatusPill(label: guide.type.label, tone: guide.type.tone)
                }
            }
        }
        .padding(.vertical, 8)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel)
    }

    private var accessibilityLabel: String {
        var parts = [guide.title, guide.type.label]
        if !guide.published {
            parts.append("Draft")
        }
        return parts.joined(separator: ", ")
    }
}

private struct GuideReaderView: View {
    let guide: GuideListItem

    @State private var loadedGuide: GuideListItem?
    @State private var isLoading = false
    @State private var error: String?

    private var displayedGuide: GuideListItem {
        loadedGuide ?? guide
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                GuideReaderHeader(guide: displayedGuide)

                articleContent
            }
            .padding(.horizontal, 24)
            .padding(.top, 12)
            .padding(.bottom, 44)
            .frame(maxWidth: 720, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .background(Color(.systemBackground))
        .navigationTitle(displayedGuide.title)
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load(forceRefresh: true) }
        .task(id: guide.slug) { await load() }
    }

    @ViewBuilder
    private var articleContent: some View {
        if isLoading && displayedGuide.markdown.isEmpty {
            VStack(spacing: 12) {
                ProgressView()
                Text("Loading guide")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, minHeight: 220)
            .background(Color.cardSurface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .accessibilityElement(children: .combine)
        } else if let error, displayedGuide.markdown.isEmpty {
            ContentUnavailableView {
                Label("Couldn't load this guide", systemImage: "wifi.exclamationmark")
            } description: {
                Text(error)
            } actions: {
                Button("Retry") { Task { await load(forceRefresh: true) } }
                    .buttonStyle(.borderedProminent)
            }
            .frame(maxWidth: .infinity, minHeight: 260)
            .background(Color.cardSurface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        } else {
            NativeMarkdownArticle(markdown: displayedGuide.markdown)
        }
    }

    private func load(forceRefresh: Bool = false) async {
        if !forceRefresh, loadedGuide != nil { return }
        // A pull-to-refresh mid-load must not be silently dropped; the article
        // list has the same rule.
        if !forceRefresh, isLoading { return }

        isLoading = true
        if forceRefresh { error = nil }
        do {
            let fetched = try await APIClient.shared.guide(slug: guide.slug)
            guard !Task.isCancelled else { return }
            loadedGuide = fetched
            error = nil
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled else { return }
            self.error = error.localizedDescription
        }
        isLoading = false
    }
}

private struct GuideReaderHeader: View {
    let guide: GuideListItem

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Label(guide.type.label, systemImage: guide.type.systemImage)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Color.statusText(guide.type.tone))

                if !guide.category.isEmpty && guide.category != guide.type.label {
                    Text("·")
                        .foregroundStyle(.tertiary)
                    Text(guide.category)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                if !guide.published {
                    StatusPill(label: "Draft", tone: .gray)
                }
            }

            Text(guide.title)
                .font(.title.weight(.bold))
                .foregroundStyle(.primary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)

            Text("Updated \(guide.updatedSummary) by \(guide.author.name)")
                .font(.footnote)
                .foregroundStyle(.secondary)

            Divider()
                .padding(.top, 4)
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Article rendering

/// Renders the parsed guide document. Parsing lives in GuideMarkdown.swift; this
/// type only decides how each block looks.
struct NativeMarkdownArticle: View {
    private let blocks: [GuideBlock]

    init(markdown: String) {
        let parsed = GuideMarkdown.parse(markdown)
        // A guide that opens with a rule (or with front-matter fences that
        // reduce to one) shouldn't start with a stray divider under the header.
        blocks = Array(parsed.drop { block in
            if case .rule = block.kind { return true }
            return false
        })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if blocks.isEmpty {
                Text("No content yet.")
                    .font(.body)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(Array(blocks.enumerated()), id: \.element.id) { index, block in
                    GuideBlockView(block: block, isFirst: index == 0)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct GuideBlockView: View {
    let block: GuideBlock
    let isFirst: Bool

    var body: some View {
        switch block.kind {
        case .heading(let level, let text):
            GuideInlineLabel(text, font: headingFont(level))
                .foregroundStyle(.primary)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, isFirst ? 0 : (level <= 2 ? 22 : 10))
                .accessibilityAddTraits(.isHeader)

        case .paragraph(let text):
            GuideInlineLabel(text, font: .body)
                .lineSpacing(5)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)

        case .bullet(let depth, let checkbox, let text):
            HStack(alignment: .top, spacing: 12) {
                if let checkbox {
                    Image(systemName: checkbox ? "checkmark.square.fill" : "square")
                        .font(.body)
                        .foregroundStyle(checkbox ? Color.statusText(.green) : Color.secondary)
                        .accessibilityHidden(true)
                } else {
                    Circle()
                        .fill(Color.secondary.opacity(0.65))
                        .frame(width: 6, height: 6)
                        .padding(.top, 8)
                        .accessibilityHidden(true)
                }
                GuideInlineLabel(text, font: .body)
                    .lineSpacing(5)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.leading, indent(depth))
            .textSelection(.enabled)
            .accessibilityElement(children: .combine)
            .accessibilityLabel(checkbox.map { "\($0 ? "Completed" : "Not completed"). \(text.plain)" } ?? text.plain)

        case .numbered(let depth, let number, let text):
            HStack(alignment: .top, spacing: 12) {
                Text("\(number)")
                    .font(.caption.weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(.primary)
                    .frame(width: 28, height: 28)
                    .background(Color.cardSurfaceRaised, in: Circle())
                    .accessibilityHidden(true)
                GuideInlineLabel(text, font: .body)
                    .lineSpacing(5)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.leading, indent(depth))
            .textSelection(.enabled)
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Step \(number). \(text.plain)")

        case .quote(let callout, let paragraphs):
            GuideCalloutView(callout: callout, paragraphs: paragraphs)

        case .code(_, let text):
            GuideCodeBlock(code: text)

        case .embed(let embed):
            GuideEmbedCard(embed: embed)

        case .table(let table):
            GuideTableView(table: table)

        case .image(let image):
            GuideArticleImage(image: image)

        case .rule:
            Divider().padding(.vertical, 4)
        }
    }

    private func indent(_ depth: Int) -> CGFloat {
        CGFloat(depth) * 18
    }

    private func headingFont(_ level: Int) -> Font {
        switch level {
        case 1: .title.weight(.bold)
        case 2: .title2.weight(.bold)
        default: .title3.weight(.semibold)
        }
    }
}

// MARK: Inline runs

/// Renders parsed inline runs as a single `Text`, so bold/italic/strikethrough,
/// monospaced inline code, and tappable links all survive into the article.
private struct GuideInlineLabel: View {
    private let text: GuideInlineText
    private let font: Font

    init(_ text: GuideInlineText, font: Font) {
        self.text = text
        self.font = font
    }

    var body: some View {
        Text(attributed)
            .font(font)
    }

    private var attributed: AttributedString {
        var output = AttributedString()
        for span in text.spans {
            var piece = AttributedString(span.text)
            if span.isCode {
                piece.font = .system(.callout, design: .monospaced)
                piece.backgroundColor = Color.cardSurfaceRaised
            } else {
                piece.font = resolvedFont(bold: span.isBold, italic: span.isItalic)
            }
            if span.isStrikethrough {
                piece.strikethroughStyle = .single
            }
            if let link = span.link {
                piece.link = link
                piece.underlineStyle = .single
            }
            output.append(piece)
        }
        return output
    }

    private func resolvedFont(bold: Bool, italic: Bool) -> Font {
        var resolved = font
        if bold { resolved = resolved.weight(.semibold) }
        if italic { resolved = resolved.italic() }
        return resolved
    }
}

// MARK: Callouts

/// GitHub alert callouts, tone-matched to the web reader's `guide-alert-*`
/// styles (note blue, tip green, important purple, warning orange, caution red).
private struct GuideCalloutView: View {
    let callout: GuideCallout?
    let paragraphs: [GuideInlineText]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let callout {
                Label(callout.label, systemImage: systemImage(callout))
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(Color.statusText(tone))
            }

            ForEach(Array(paragraphs.enumerated()), id: \.offset) { _, paragraph in
                GuideInlineLabel(paragraph, font: .body)
                    .foregroundStyle(.primary)
                    .lineSpacing(5)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.statusBackground(tone), in: RoundedRectangle(cornerRadius: Brand.Radius.md, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: Brand.Radius.md, style: .continuous)
                .strokeBorder(Color.statusText(tone).opacity(0.32))
        }
        .textSelection(.enabled)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel)
    }

    private var tone: StatusTone {
        switch callout {
        case .note: return .blue
        case .tip: return .green
        case .important: return .purple
        case .warning: return .orange
        case .caution: return .red
        case nil: return .blue
        }
    }

    private func systemImage(_ callout: GuideCallout) -> String {
        switch callout {
        case .note: "info.circle.fill"
        case .tip: "lightbulb.fill"
        case .important: "exclamationmark.bubble.fill"
        case .warning: "exclamationmark.triangle.fill"
        case .caution: "exclamationmark.octagon.fill"
        }
    }

    private var accessibilityLabel: String {
        let body = paragraphs.map(\.plain).joined(separator: " ")
        guard let callout else { return body }
        return "\(callout.label). \(body)"
    }
}

// MARK: Tables

/// A real grid. Contacts, building numbers, and SOP guides are almost entirely
/// tables, and every guide template ships with several.
private struct GuideTableView: View {
    let table: GuideTable

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            Grid(alignment: .topLeading, horizontalSpacing: 0, verticalSpacing: 0) {
                GridRow {
                    ForEach(Array(table.header.enumerated()), id: \.offset) { column, cell in
                        cellView(cell, column: column, isHeader: true, isFirstRow: true)
                    }
                }

                ForEach(Array(table.rows.enumerated()), id: \.offset) { index, row in
                    GridRow {
                        ForEach(Array(row.enumerated()), id: \.offset) { column, cell in
                            cellView(cell, column: column, isHeader: false, isFirstRow: false)
                        }
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel(rowLabel(row, position: index + 1))
                }
            }
            // The frame hugs the grid rather than the scroll container: a
            // two-column table shouldn't draw a full-width border around
            // part-width cells.
            .clipShape(RoundedRectangle(cornerRadius: Brand.Radius.sm, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: Brand.Radius.sm, style: .continuous)
                    .strokeBorder(Color.secondary.opacity(0.22))
            }
        }
    }

    private func cellView(
        _ cell: GuideInlineText,
        column: Int,
        isHeader: Bool,
        isFirstRow: Bool
    ) -> some View {
        GuideInlineLabel(cell, font: isHeader ? .footnote.weight(.semibold) : .footnote)
            .foregroundStyle(isHeader ? .secondary : .primary)
            .multilineTextAlignment(textAlignment(column))
            .fixedSize(horizontal: false, vertical: true)
            .frame(minWidth: 64, maxWidth: 260, alignment: frameAlignment(column))
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .frame(maxHeight: .infinity, alignment: .topLeading)
            .background(isHeader ? Color.cardSurfaceRaised : Color.cardSurface)
            // Drawn as an overlay rather than a Grid row so a wrapped cell can
            // grow without knocking the rule out of alignment.
            .overlay(alignment: .top) {
                if !isFirstRow {
                    Rectangle()
                        .fill(Color.secondary.opacity(0.22))
                        .frame(height: 0.5)
                }
            }
    }

    private func textAlignment(_ column: Int) -> TextAlignment {
        switch table.alignment(at: column) {
        case .leading: .leading
        case .center: .center
        case .trailing: .trailing
        }
    }

    private func frameAlignment(_ column: Int) -> Alignment {
        switch table.alignment(at: column) {
        case .leading: .leading
        case .center: .center
        case .trailing: .trailing
        }
    }

    /// VoiceOver reads a data row as "header: value" pairs; a bare list of
    /// cells loses which column each one came from.
    private func rowLabel(_ row: [GuideInlineText], position: Int) -> String {
        let pairs = row.enumerated().map { column, cell -> String in
            let header = table.header.indices.contains(column) ? table.header[column].plain : ""
            let value = cell.plain.isEmpty ? "empty" : cell.plain
            return header.isEmpty ? value : "\(header): \(value)"
        }
        return "Row \(position). " + pairs.joined(separator: ", ")
    }
}

// MARK: Code

/// Guides lean on fenced blocks for paths, naming strings, and account
/// references, so the block carries the same copy affordance the web reader has.
private struct GuideCodeBlock: View {
    let code: String

    @State private var didCopy = false

    var body: some View {
        ZStack(alignment: .topTrailing) {
            ScrollView(.horizontal, showsIndicators: false) {
                Text(code)
                    .font(.system(.footnote, design: .monospaced))
                    .textSelection(.enabled)
                    .padding(12)
                    .padding(.trailing, 34)
            }

            Button {
                UIPasteboard.general.string = code
                Haptics.success()
                didCopy = true
            } label: {
                Image(systemName: didCopy ? "checkmark" : "doc.on.doc")
                    .font(.footnote.weight(.semibold))
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .foregroundStyle(didCopy ? Color.statusText(.green) : Color.secondary)
            .padding(6)
            .accessibilityLabel(didCopy ? "Copied" : "Copy code")
        }
        .background(Color.cardSurfaceRaised, in: RoundedRectangle(cornerRadius: Brand.Radius.sm, style: .continuous))
        .task(id: didCopy) {
            guard didCopy else { return }
            try? await Task.sleep(for: .seconds(2))
            guard !Task.isCancelled else { return }
            didCopy = false
        }
    }
}

// MARK: Embeds

/// Native can't frame a provider player the way the web reader does, so the
/// embed becomes a card that opens the video.
private struct GuideEmbedCard: View {
    let embed: GuideEmbed

    var body: some View {
        Link(destination: embed.url) {
            HStack(spacing: 12) {
                Image(systemName: "play.rectangle.fill")
                    .font(.title3)
                    .foregroundStyle(Color.statusText(.red))

                VStack(alignment: .leading, spacing: 2) {
                    Text(embed.title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.primary)
                    Text(embed.url.host() ?? embed.url.absoluteString)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                Spacer(minLength: 0)

                Image(systemName: "arrow.up.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.cardSurface, in: RoundedRectangle(cornerRadius: Brand.Radius.md, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: Brand.Radius.md, style: .continuous)
                    .strokeBorder(Color.secondary.opacity(0.22))
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(embed.title). Opens in browser.")
    }
}

// MARK: Images

/// Article photo. Downsamples to the width it is actually drawn at and shares
/// the app's image cache, so a 10 MB upload doesn't decode at full resolution
/// in the middle of a scrolling article.
private struct GuideArticleImage: View {
    let image: GuideImage

    @Environment(\.displayScale) private var displayScale
    @State private var loaded: UIImage?
    @State private var failed = false
    @State private var width: CGFloat = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            content
                .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }

            if !image.alt.isEmpty {
                Text(image.alt)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        if let url = image.url {
            wrappedInLink {
                imageBody
                    .task(id: TaskKey(url: url, width: width, scale: displayScale)) {
                        await load(url: url)
                    }
            }
        } else {
            fallback
        }
    }

    @ViewBuilder
    private func wrappedInLink(@ViewBuilder _ body: () -> some View) -> some View {
        if let link = image.link {
            Link(destination: link) { body() }
                .buttonStyle(.plain)
                .accessibilityLabel(accessibilityLabel + ". Opens a link.")
        } else {
            body()
        }
    }

    @ViewBuilder
    private var imageBody: some View {
        if let loaded {
            Image(uiImage: loaded)
                .resizable()
                .scaledToFit()
                .frame(maxWidth: .infinity)
                .clipShape(RoundedRectangle(cornerRadius: Brand.Radius.sm, style: .continuous))
                .accessibilityElement()
                .accessibilityLabel(accessibilityLabel)
        } else if failed {
            fallback
        } else {
            RoundedRectangle(cornerRadius: Brand.Radius.sm, style: .continuous)
                .fill(Color.cardSurfaceRaised)
                .frame(minHeight: 180)
                .overlay { ProgressView() }
                .accessibilityLabel("Loading image")
        }
    }

    private var fallback: some View {
        Label(image.alt.isEmpty ? "Image unavailable" : image.alt, systemImage: "photo")
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, minHeight: 140)
            .background(Color.cardSurfaceRaised, in: RoundedRectangle(cornerRadius: Brand.Radius.sm, style: .continuous))
            .accessibilityLabel(image.alt.isEmpty ? "Image unavailable" : "\(image.alt). Image unavailable.")
    }

    private var accessibilityLabel: String {
        if !image.alt.isEmpty { return image.alt }
        if let title = image.title, !title.isEmpty { return title }
        return "Guide image"
    }

    /// Re-runs the load when the URL changes, and once the real draw width is
    /// known, but not on every incidental layout pass.
    private struct TaskKey: Hashable {
        let url: URL
        let width: CGFloat
        let scale: CGFloat
    }

    private func load(url: URL) async {
        guard width > 0 else { return }
        // Cap the decode so a very wide iPad column can't ask for more pixels
        // than the source usefully has.
        let pixels = min(width * displayScale, 2048)
        let key = "\(url.absoluteString)@article\(Int(pixels))"

        if let cached = ThumbnailCache.shared.image(for: key) {
            loaded = cached
            failed = false
            return
        }

        var request = URLRequest(url: url)
        request.cachePolicy = .returnCacheDataElseLoad
        guard let (data, response) = try? await RemoteImageLoading.session.data(for: request),
              !Task.isCancelled else {
            failed = loaded == nil
            return
        }
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            failed = loaded == nil
            return
        }
        guard let decoded = await NativeImageProcessor.downsample(data: data, maxPixels: pixels, scale: displayScale),
              !Task.isCancelled else {
            failed = loaded == nil
            return
        }

        ThumbnailCache.shared.store(decoded, for: key)
        loaded = decoded
        failed = false
    }
}

private enum GuideFocus: String, CaseIterable, Identifiable {
    case all
    case recent
    case myArea
    case contacts
    case buildingNumbers
    case mediaDrive
    case serverPaths
    case sop
    case howTo
    case troubleshooting
    case accountNote
    case eventOps
    case general

    var id: String { rawValue }

    var label: String {
        switch self {
        case .all: "All guides"
        case .recent: "Recently updated"
        case .myArea: "My area"
        case .contacts: ResourceType.contacts.label
        case .buildingNumbers: ResourceType.buildingNumbers.label
        case .mediaDrive: ResourceType.mediaDrive.label
        case .serverPaths: ResourceType.serverPaths.label
        case .sop: ResourceType.sop.label
        case .howTo: ResourceType.howTo.label
        case .troubleshooting: ResourceType.troubleshooting.label
        case .accountNote: ResourceType.accountNote.label
        case .eventOps: ResourceType.eventOps.label
        case .general: ResourceType.general.label
        }
    }

    var systemImage: String {
        switch self {
        case .all: "book.closed"
        case .recent: "clock"
        case .myArea: "person.crop.circle"
        case .contacts: ResourceType.contacts.systemImage
        case .buildingNumbers: ResourceType.buildingNumbers.systemImage
        case .mediaDrive: ResourceType.mediaDrive.systemImage
        case .serverPaths: ResourceType.serverPaths.systemImage
        case .sop: ResourceType.sop.systemImage
        case .howTo: ResourceType.howTo.systemImage
        case .troubleshooting: ResourceType.troubleshooting.systemImage
        case .accountNote: ResourceType.accountNote.systemImage
        case .eventOps: ResourceType.eventOps.systemImage
        case .general: ResourceType.general.systemImage
        }
    }

    func includes(_ guide: GuideListItem, currentRole: String) -> Bool {
        switch self {
        case .all:
            true
        case .recent:
            Date().timeIntervalSince(guideDate(guide.updatedAt)) <= 60 * 60 * 24 * 30
        case .myArea:
            guide.personalizationReason != "General" || guide.targetRoles.contains(currentRole)
        case .contacts:
            guide.type == .contacts
        case .buildingNumbers:
            guide.type == .buildingNumbers
        case .mediaDrive:
            guide.type == .mediaDrive
        case .serverPaths:
            guide.type == .serverPaths
        case .sop:
            guide.type == .sop
        case .howTo:
            guide.type == .howTo
        case .troubleshooting:
            guide.type == .troubleshooting
        case .accountNote:
            guide.type == .accountNote
        case .eventOps:
            guide.type == .eventOps
        case .general:
            guide.type == .general || guide.type == .unknown
        }
    }
}

private enum GuideSort: String, CaseIterable, Identifiable {
    case recommended
    case recent
    case title

    var id: String { rawValue }

    var label: String {
        switch self {
        case .recommended: "Recommended"
        case .recent: "Recently updated"
        case .title: "Title A-Z"
        }
    }
}

private extension GuideListItem {
    var updatedSummary: String {
        let date = guideDate(updatedAt)
        guard date != .distantPast else { return "Updated" }
        return date.formatted(date: .abbreviated, time: .omitted)
    }

    var searchIndex: String {
        [
            title,
            category,
            type.label,
            author.name,
            summary,
            searchText,
            targetRoles.joined(separator: " "),
            targetAreas.joined(separator: " "),
        ].joined(separator: " ").lowercased()
    }

    static var placeholders: [GuideListItem] {
        (0..<5).map { index in
            GuideListItem.placeholder(index: index)
        }
    }

    private static func placeholder(index: Int) -> GuideListItem {
        let json = """
        {
          "id": "placeholder-\(index)",
          "title": "Guide placeholder",
          "slug": "placeholder-\(index)",
          "type": "GENERAL",
          "category": "General Info",
          "summary": "Guide preview placeholder",
          "searchText": "Guide content",
          "markdown": "Guide content",
          "author": { "id": "placeholder-author", "name": "Creative" }
        }
        """.data(using: .utf8)!
        return (try? JSONDecoder().decode(GuideListItem.self, from: json))!
    }
}

private func guideDate(_ raw: String?) -> Date {
    guard let raw, !raw.isEmpty else { return .distantPast }
    return GuideDateFormatters.fractional.date(from: raw)
        ?? GuideDateFormatters.standard.date(from: raw)
        ?? .distantPast
}

private enum GuideDateFormatters {
    // Read-only after initialization (formatOptions set once, then only
    // `.date(from:)` is called) — safe to share without actor isolation.
    // `guideDate` is called from both @MainActor view code and plain
    // nonisolated model/filter types (GuideListItem, filter enums), so this
    // avoids forcing either into MainActor isolation for a cached formatter.
    nonisolated(unsafe) static let fractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    nonisolated(unsafe) static let standard: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()
}
