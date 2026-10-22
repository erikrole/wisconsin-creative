import SwiftUI
import UIKit

enum GearPicksPhase: Equatable {
    case loading
    case failed(String)
    case notOpen
    case notOnList
    case ready
}

@MainActor
@Observable
final class GearPicksModel {
    var phase: GearPicksPhase = .loading
    var cycle: GearPickCycle?
    var participant: GearPickParticipant?
    var catalog: GearPickPhoneCatalog?
    /// Nil until loaded, and nil for good when there is no kit (route absent,\n    /// not launched, not on the list). The card is simply not drawn.
    var kit: GearMyKit?
    var lines: [GearPickDraftLine] = []
    var baseVersion = 0
    var submittedAt: String?
    var isDirty = false
    var isSaving = false
    var isReloading = false
    var saveMessage: String?
    var conflictMessage: String?
    var serverClosed = false
    var searchText = ""

    private var loadID = UUID()
    private var hasLoaded = false

    var canEdit: Bool {
        phase == .ready && cycle?.isOpen == true && !isSaving && !isReloading && conflictMessage == nil && !serverClosed
    }

    var maxQuantity: Int { catalog?.maxQuantity ?? 5 }

    var pickCount: Int { lines.reduce(0) { $0 + $1.quantity } }

    var totalCents: Int { GearPickValidation.totalCents(lines: lines, catalog: catalog) }

    var remainingCents: Int { (participant?.allowanceCents ?? 0) - totalCents }

    var problems: [String] {
        guard let allowance = participant?.allowanceCents else { return [] }
        return GearPickValidation.problems(lines: lines, catalog: catalog, allowanceCents: allowance)
    }

    var canSaveDraft: Bool {
        canEdit && submittedAt == nil && isDirty && problems.isEmpty
    }

    var canSubmit: Bool {
        canEdit && !lines.isEmpty && problems.isEmpty && (submittedAt == nil || isDirty)
    }

    func loadIfNeeded() async {
        guard !hasLoaded else { return }
        await load(replacingDraft: true)
    }

    func load(replacingDraft: Bool) async {
        guard !isSaving, !isReloading else { return }
        let requestID = UUID()
        loadID = requestID
        // A destructive reload owns the draft only after it succeeds. Keep
        // dirty/conflict state intact if the network fails.
        isReloading = replacingDraft
        defer { if loadID == requestID { isReloading = false } }
        if !hasLoaded { phase = .loading }
        do {
            async let kitTask: GearMyKit? = try? await APIClient.shared.myGearKit()
            let payload = try await APIClient.shared.myGearPicks()
            let loadedKit = await kitTask
            guard loadID == requestID, !Task.isCancelled else { return }
            kit = loadedKit
            apply(payload, replacingDraft: replacingDraft || !isDirty)
            hasLoaded = true
        } catch {
            guard loadID == requestID, !Task.isCancelled else { return }
            if hasLoaded {
                saveMessage = error.localizedDescription
            } else {
                phase = .failed(error.localizedDescription)
            }
        }
    }

    func discardAndReload() async {
        await load(replacingDraft: true)
    }

    func upsert(item: GearPickPhoneItem, colorCode: String, size: String?, quantity: Int) {
        guard canEdit, let color = item.colors.first(where: { $0.code == colorCode }) else { return }
        let sku = GearPickValidation.sku(style: item.style, colorCode: color.code)
        let normalized = GearPickValidation.normalizedSize(size) ?? (item.oneSize ? "OSFA" : nil)
        let clamped = min(max(quantity, 1), maxQuantity)
        mutate { lines in
            if let index = lines.firstIndex(where: {
                $0.sku == sku && GearPickValidation.normalizedSize($0.size) == normalized
            }) {
                lines[index].quantity = clamped
                lines[index].size = normalized
                lines[index].unitPriceCents = item.priceCents
            } else {
                lines.append(GearPickDraftLine(
                    id: UUID(),
                    sku: sku,
                    style: item.style,
                    colorCode: color.code,
                    size: normalized,
                    quantity: clamped,
                    itemName: item.name,
                    colorLabel: color.label,
                    unitPriceCents: item.priceCents,
                    category: item.category
                ))
            }
        }
    }

    func remove(id: UUID) {
        mutate { $0.removeAll { $0.id == id } }
    }

    func setQuantity(id: UUID, quantity: Int) {
        let clamped = min(max(quantity, 1), maxQuantity)
        mutate { lines in
            guard let index = lines.firstIndex(where: { $0.id == id }) else { return }
            lines[index].quantity = clamped
        }
    }

    func setSize(id: UUID, size: String) {
        mutate { lines in
            guard let index = lines.firstIndex(where: { $0.id == id }) else { return }
            lines[index].size = GearPickValidation.normalizedSize(size)
        }
    }

    func setColor(id: UUID, colorCode: String) {
        mutate { lines in
            guard let index = lines.firstIndex(where: { $0.id == id }),
                  let item = catalog?.items.first(where: { $0.style == lines[index].style }),
                  let color = item.colors.first(where: { $0.code == colorCode }) else { return }
            lines[index].colorCode = color.code
            lines[index].sku = GearPickValidation.sku(style: item.style, colorCode: color.code)
            lines[index].colorLabel = color.label
            lines[index].itemName = item.name
            lines[index].unitPriceCents = item.priceCents
        }
    }

    func save(submit: Bool) async -> Bool {
        guard !isSaving else { return false }
        if submit {
            guard canSubmit else { return false }
        } else {
            guard canSaveDraft else { return false }
        }
        let wasSubmitted = submittedAt != nil
        // Any GET begun before this mutation must never replace its receipt.
        loadID = UUID()
        isSaving = true
        defer { isSaving = false }
        do {
            let saved = try await APIClient.shared.saveMyGearPicks(
                lines: saveLines(),
                submit: submit,
                version: baseVersion
            )
            lines = drafts(from: saved)
            baseVersion = saved.version
            submittedAt = saved.submittedAt
            isDirty = false
            conflictMessage = nil
            serverClosed = false
            let message: String
            if submit && !wasSubmitted {
                message = "Picks submitted. You can still change them until the deadline."
            } else if submit {
                message = "Changes saved."
            } else {
                message = "Draft saved."
            }
            saveMessage = message
            Haptics.success()
            UIAccessibility.post(notification: .announcement, argument: message)
            return true
        } catch {
            let text = (error as? APIError)?.errorDescription ?? error.localizedDescription
            if let api = error as? APIError, case .httpError(let status, let message) = api, status == 409 {
                if message.localizedCaseInsensitiveContains("closed") {
                    serverClosed = true
                    saveMessage = message
                    Haptics.error()
                } else {
                    conflictMessage = message
                    saveMessage = nil
                    Haptics.warning()
                }
                UIAccessibility.post(notification: .announcement, argument: message)
            } else {
                saveMessage = text
                Haptics.warning()
                UIAccessibility.post(notification: .announcement, argument: text)
            }
            return false
        }
    }

    func item(style: String) -> GearPickPhoneItem? {
        catalog?.items.first { $0.style == style }
    }

    func sections() -> [(category: String, items: [GearPickPhoneItem])] {
        let words = searchText.lowercased().split(whereSeparator: \.isWhitespace).map(String.init)
        let items = (catalog?.items ?? []).filter { item in
            let text = ([item.name, item.style, item.category] + item.colors.flatMap { [$0.label, $0.code, "\(item.style)-\($0.code)"] })
                .joined(separator: " ")
                .lowercased()
            return words.allSatisfy { text.contains($0) }
        }
        return (catalog?.categories ?? []).compactMap { category in
            let rows = items.filter { $0.category == category }
            return rows.isEmpty ? nil : (category, rows)
        }
    }

    private func apply(_ payload: GearPicksMePayload, replacingDraft: Bool) {
        cycle = payload.cycle
        participant = payload.participant
        if let catalog = payload.catalog { self.catalog = catalog }
        guard let cycle = payload.cycle else {
            phase = .notOpen
            return
        }
        guard payload.participant != nil else {
            phase = .notOnList
            return
        }
        phase = .ready
        serverClosed = !cycle.isOpen ? true : serverClosed && !replacingDraft
        if cycle.isOpen && replacingDraft { serverClosed = false }
        let serverVersion = payload.submission?.version ?? 0
        if replacingDraft {
            lines = payload.submission.map { drafts(from: $0) } ?? []
            baseVersion = serverVersion
            submittedAt = payload.submission?.submittedAt
            isDirty = false
            conflictMessage = nil
            saveMessage = nil
        } else if serverVersion != baseVersion {
            conflictMessage = "Your picks changed somewhere else since you opened this page. Reload to see the latest list, then make your changes again."
        }
    }

    private func drafts(from submission: GearPickSubmission) -> [GearPickDraftLine] {
        submission.lines.map { line in
            let item = catalog?.items.first { $0.style == line.style }
            let color = item?.colors.first { $0.code == line.colorCode }
            return GearPickDraftLine(
                id: UUID(),
                sku: line.sku,
                style: line.style,
                colorCode: line.colorCode,
                size: line.size,
                quantity: line.quantity,
                itemName: item?.name ?? line.itemName,
                colorLabel: color?.label ?? line.colorLabel,
                unitPriceCents: item?.priceCents ?? line.unitPriceCents,
                category: item?.category ?? line.category
            )
        }
    }

    private func saveLines() -> [GearPickSaveLine] {
        lines.map { line in
            let item = catalog?.items.first { $0.style == line.style }
            let size = GearPickValidation.normalizedSize(line.size) ?? (item?.oneSize == true ? "OSFA" : nil)
            return GearPickSaveLine(sku: line.sku, size: size, quantity: line.quantity)
        }
    }

    private func mutate(_ body: (inout [GearPickDraftLine]) -> Void) {
        guard canEdit else { return }
        body(&lines)
        isDirty = true
        saveMessage = nil
    }
}

struct GearPicksView: View {
    var wrapsInNavigationStack = true

    @State private var model = GearPicksModel()
    @State private var showReview = false
    @State private var confirmLeave = false
    @Environment(\.dismiss) private var dismiss

    @ViewBuilder
    var body: some View {
        if wrapsInNavigationStack {
            NavigationStack { configured }
        } else {
            configured
        }
    }

    private var configured: some View {
        content
            .navigationTitle("UA Gear")
            .navigationBarTitleDisplayMode(.large)
            .navigationBarBackButtonHidden(model.isDirty)
            .toolbar { toolbar }
            .refreshable { await model.load(replacingDraft: !model.isDirty) }
            .task { await model.loadIfNeeded() }
            .navigationDestination(for: GearPickStyleRoute.self) { route in
                GearPickItemView(style: route.style, model: model)
            }
            .sheet(isPresented: $showReview) {
                NavigationStack {
                    GearPicksReviewView(model: model)
                }
            }
            .confirmationDialog("Leave without saving?", isPresented: $confirmLeave, titleVisibility: .visible) {
                Button("Leave without saving", role: .destructive) { dismiss() }
                Button("Keep editing", role: .cancel) {}
            } message: {
                Text("Your unsaved picks are still only on this phone.")
            }
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        if model.isDirty {
            ToolbarItem(placement: .topBarLeading) {
                Button("Back", systemImage: "chevron.backward") { confirmLeave = true }
            }
        }
        if model.phase == .ready {
            ToolbarItem(placement: .topBarTrailing) {
                if model.pickCount > 0 {
                    Button("\(model.canEdit ? "Review" : "Your picks") (\(model.pickCount))") { showReview = true }
                } else {
                    Button(model.canEdit ? "Review" : "Your picks") { showReview = true }
                }
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            ProgressView("Loading your gear picks")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let message):
            ContentUnavailableView {
                Label("Couldn't load your gear picks", systemImage: "exclamationmark.triangle")
            } description: {
                Text(message)
            } actions: {
                Button("Retry") { Task { await model.load(replacingDraft: true) } }
                    .buttonStyle(.borderedProminent)
            }
        case .notOpen:
            ContentUnavailableView {
                Label("Gear picks aren't open", systemImage: "calendar")
            } description: {
                Text("There's no Under Armour gear pick window right now.")
            }
        case .notOnList where model.kit != nil:
            List {
                if let kit = model.kit { GearMyKitSection(kit: kit) }
            }
            .listStyle(.insetGrouped)
        case .notOnList:
            ContentUnavailableView {
                Label("You're not on this year's pick list", systemImage: "person.2")
            } description: {
                Text("Under Armour staff picks are for full-time creative staff on this year's roster. If you should be picking, ask an admin to add you.")
            }
        case .ready:
            readyList
        }
    }

    private var readyList: some View {
        let sections = model.sections()
        return List {
            summary
            if let kit = model.kit { GearMyKitSection(kit: kit) }
            if model.catalog == nil {
                Section {
                    Text("The catalog didn't load, so you can review a saved list but not add gear.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            } else if sections.isEmpty {
                Section {
                    ContentUnavailableView {
                        Label("No gear matches", systemImage: "tshirt")
                    } description: {
                        Text("Try a different name, color, or style number.")
                    } actions: {
                        if !model.searchText.isEmpty {
                            Button("Clear search") { model.searchText = "" }
                        }
                    }
                }
            } else {
                ForEach(sections, id: \.category) { section in
                    Section(section.category) {
                        ForEach(section.items) { item in
                            NavigationLink(value: GearPickStyleRoute(style: item.style)) {
                                GearPickCatalogRow(item: item, picked: model.pickCount(for: item.style))
                            }
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .searchable(text: $model.searchText, prompt: "Search gear")
    }

    private var summary: some View {
        Section {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text(GearPickFitLabel.name(model.participant?.fit))
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.secondary)
                    Spacer()
                    statusPill
                }
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .firstTextBaseline, spacing: 20) {
                        allowanceRemaining
                        Spacer(minLength: 0)
                        allowanceUsed
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        allowanceRemaining
                        allowanceUsed
                    }
                }
                ProgressView(value: min(Double(model.totalCents), Double(max(model.participant?.allowanceCents ?? 0, 1))),
                             total: Double(max(model.participant?.allowanceCents ?? 0, 1)))
                    .tint(model.remainingCents < 0 ? Color.statusText(.red) : Color.statusText(.purple))
                    .accessibilityLabel("Allowance used")
                    .accessibilityValue(GearPickMoney.format(model.totalCents))
                if let deadline = GearPickDate.label(model.cycle?.deadline) {
                    Label("\(model.cycle?.isOpen == true ? "Open until" : "Closed") \(deadline)", systemImage: "calendar")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.vertical, 4)
            if let message = model.conflictMessage ?? model.saveMessage {
                Text(message)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            if model.conflictMessage != nil || (model.serverClosed && model.isDirty) {
                Button("Discard and reload") { Task { await model.discardAndReload() } }
            }
            if model.isDirty {
                Text("Unsaved changes stay on this phone until you save.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        } footer: {
            Text(footerText)
        }
    }

    private var allowanceRemaining: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(GearPickMoney.format(abs(model.remainingCents)))
                .font(.title2.weight(.semibold).monospacedDigit())
                .foregroundStyle(model.remainingCents < 0 ? Color.statusText(.red) : Color.primary)
            Text(model.remainingCents < 0 ? "Over allowance" : "Left to spend")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
    }

    private var allowanceUsed: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("\(GearPickMoney.format(model.totalCents)) picked")
                .font(.subheadline.weight(.medium).monospacedDigit())
            Text("of \(GearPickMoney.format(model.participant?.allowanceCents ?? 0))")
                .font(.subheadline.monospacedDigit())
                .foregroundStyle(.secondary)
        }
    }

    private var footerText: String {
        if model.serverClosed || model.cycle?.isOpen == false {
            return "Gear picks are closed. Your saved list is locked. Standard issue is covered by the department and does not come out of this allowance."
        }
        return "Standard issue is covered by the department and does not come out of this allowance."
    }

    @ViewBuilder
    private var statusPill: some View {
        if model.serverClosed || model.cycle?.isOpen == false {
            StatusPill(label: "Closed", tone: .gray)
        } else if model.submittedAt != nil {
            StatusPill(label: "Submitted", tone: .green)
        } else if model.lines.isEmpty {
            StatusPill(label: "Not started", tone: .gray)
        } else {
            StatusPill(label: "Draft", tone: .orange)
        }
    }
}

/// "My kit": what you are getting and where each piece stands. Calm on
/// purpose: a light header, one sentence of status, then a short list with one
/// detail line each and status as plain secondary text beside a small glyph.
struct GearMyKitSection: View {
    let kit: GearMyKit
    @Environment(\.openURL) private var openURL

    /// Four rows at a glance; the rest sit behind the disclosure.
    private let glance = 4
    @State private var showsAll = false

    private var shown: [GearMyKitPiece] {
        showsAll ? kit.pieces : Array(kit.pieces.prefix(glance))
    }

    var body: some View {
        Section {
            // The title block is a clear first row rather than a section
            // header, so it keeps full-contrast text instead of the list's
            // grey header styling.
            VStack(alignment: .leading, spacing: 4) {
                Text("My kit")
                    .font(.gothamBold(size: 17, relativeTo: .headline))
                Text(kit.headline)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 4)
            .listRowSeparator(.hidden)
            ForEach(shown) { piece in
                row(piece)
                    .listRowSeparator(.hidden)
            }
            if kit.pieces.count > glance {
                Button(showsAll ? "Show fewer" : "Show all \(kit.pieces.count)") {
                    withAnimation { showsAll.toggle() }
                }
                .font(.subheadline)
                .listRowSeparator(.hidden)
            }
        }
    }

    @ViewBuilder
    private func row(_ piece: GearMyKitPiece) -> some View {
        let status = piece.status(order: kit.order)
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(piece.itemName)
                    .font(.gothamBold(size: 15, relativeTo: .subheadline))
                    .lineLimit(1)
                Text(piece.detail)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            statusLabel(status)
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .combine)
        .contentShape(Rectangle())
        .onTapGesture {
            // A missing size is the one thing a person can fix from here.
            if status == .needsSize { openProfile() }
        }
    }

    @ViewBuilder
    private func statusLabel(_ status: GearMyKitPiece.Status) -> some View {
        switch status {
        case .needsSize:
            glyphText("ruler", "Add your size", tone: Color.statusText(.orange), weight: .medium)
        case .planned:
            glyphText("circle.dotted", "Planned", tone: .secondary)
        case .onOrder(let expected):
            glyphText("shippingbox", expected.map { "Due \($0)" } ?? "On order", tone: .secondary)
        case .inHand(let day):
            glyphText("checkmark.circle", day.map { "In hand · \($0)" } ?? "In hand", tone: Color.statusText(.green))
        }
    }

    private func glyphText(_ symbol: String, _ text: String, tone: some ShapeStyle, weight: Font.Weight = .regular) -> some View {
        HStack(spacing: 6) {
            Image(systemName: symbol)
            Text(text)
        }
        .font(.footnote.weight(weight))
        .foregroundStyle(tone)
        .lineLimit(1)
    }

    private func openProfile() {
        guard let url = URL(string: "profile?tab=gear", relativeTo: AppEnvironment.activeAPIBaseURL)?.absoluteURL else { return }
        openURL(url)
    }
}

private extension GearPicksModel {
    func pickCount(for style: String) -> Int {
        lines.filter { $0.style == style }.reduce(0) { $0 + $1.quantity }
    }
}

private struct GearPickCatalogRow: View {
    let item: GearPickPhoneItem
    let picked: Int

    @ViewBuilder
    var body: some View {
        HStack(spacing: 12) {
            GearPickThumbnail(path: item.colors.first?.image, size: 52)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.name)
                    .font(.body)
                Text(GearPickMoney.format(item.priceCents))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                if item.kit != nil {
                    Text(item.kit?.kind == "CORE_KIT" ? "In your core kit" : "In your standard issue")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 8)
            if picked > 0 {
                Text("\(picked)")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .accessibilityLabel("\(picked) picked")
            }
        }
        .accessibilityElement(children: .combine)
    }
}

private struct GearPickThumbnail: View {
    let path: String?
    let size: CGFloat

    @ViewBuilder
    var body: some View {
        AsyncImage(url: path.flatMap(GearPickImage.url(for:))) { phase in
            if let image = phase.image {
                image.resizable().scaledToFill()
            } else {
                RoundedRectangle(cornerRadius: 8)
                    .fill(Color(.secondarySystemFill))
                    .overlay {
                        Image(systemName: "photo")
                            .font(size > 100 ? .largeTitle : .body)
                            .foregroundStyle(.tertiary)
                    }
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

struct GearPickItemView: View {
    let style: String
    var model: GearPicksModel

    @State private var colorCode: String
    @State private var size: String
    @State private var quantity: Int
    @State private var kitPrompt: KitPrompt?

    init(style: String, model: GearPicksModel) {
        self.style = style
        self.model = model
        let item = model.item(style: style)
        let initialColor = model.lines.first { $0.style == style }?.colorCode ?? item?.colors.first?.code ?? ""
        _colorCode = State(initialValue: initialColor)
        let sku = item.map { GearPickValidation.sku(style: $0.style, colorCode: initialColor) } ?? ""
        let existing = model.lines.first { $0.sku == sku }
        _size = State(initialValue: existing?.size ?? item?.defaultSize ?? (item?.oneSize == true ? "OSFA" : ""))
        _quantity = State(initialValue: existing?.quantity ?? 1)
        _kitPrompt = State(initialValue: nil)
    }

    @ViewBuilder
    var body: some View {
        Group {
            if let item = model.item(style: style) {
                form(item)
            } else {
                ContentUnavailableView {
                    Label("This item isn't in your catalog", systemImage: "tshirt")
                } description: {
                    Text("It may have been removed from this year's list.")
                }
            }
        }
        .navigationTitle(model.item(style: style)?.name ?? "Gear")
        .navigationBarTitleDisplayMode(.inline)
        .alert(kitPrompt?.title ?? "Included in your standard issue", isPresented: kitPresented) {
            Button("Add to picks") { confirmKitAdd() }
            Button("Cancel", role: .cancel) { kitPrompt = nil }
        } message: {
            Text(kitPrompt?.message ?? "")
        }
    }

    private var kitPresented: Binding<Bool> {
        Binding(get: { kitPrompt != nil }, set: { if !$0 { kitPrompt = nil } })
    }

    @ViewBuilder
    private func form(_ item: GearPickPhoneItem) -> some View {
        let color = item.colors.first { $0.code == colorCode } ?? item.colors.first
        let existing = model.lines.first {
            $0.sku == GearPickValidation.sku(style: item.style, colorCode: colorCode)
                && GearPickValidation.normalizedSize($0.size) == GearPickValidation.normalizedSize(size.isEmpty ? nil : size)
        }
        Form {
            if let color {
                Section {
                    GearPickThumbnail(path: color.image, size: 220)
                        .frame(maxWidth: .infinity)
                        .listRowBackground(Color.clear)
                    Text(GearPickMoney.format(item.priceCents))
                        .font(.title3.weight(.semibold))
                }
            }
            if item.colors.count > 1 {
                Section("Color") {
                    HStack(spacing: 12) {
                        ForEach(item.colors) { entry in
                            Button {
                                colorCode = entry.code
                                applyColorChange(item, colorCode: entry.code)
                            } label: {
                                Circle()
                                    .fill(gearPickSwatch(entry.swatch))
                                    .frame(width: 44, height: 44)
                                    .overlay {
                                        Circle().strokeBorder(entry.code == colorCode ? Color.primary : Color.hairline, lineWidth: entry.code == colorCode ? 3 : 1)
                                    }
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(entry.label)
                            .accessibilityAddTraits(entry.code == colorCode ? .isSelected : AccessibilityTraits())
                        }
                    }
                    if let color {
                        Text(color.label)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            Section {
                if item.oneSize {
                    LabeledContent("Size", value: "OSFA")
                } else {
                    Picker(item.sizeLabel, selection: $size) {
                        Text("Choose").tag("")
                        ForEach(GearPickValidation.sizeChoices(item: item, current: size), id: \.self) { option in
                            Text(option).tag(option)
                        }
                    }
                }
                Stepper(value: $quantity, in: 1...model.maxQuantity) {
                    Text("Quantity \(quantity)")
                }
            } footer: {
                if let kit = item.kit {
                    Text("\(kit.title). The department covers that piece separately. Adding it here still uses your allowance.")
                }
            }
            .disabled(!model.canEdit)
            if model.canEdit {
                Section {
                    Button(existing == nil ? "Add to picks" : "Update") { add(item) }
                        .disabled(!item.oneSize && (GearPickValidation.normalizedSize(size) == nil || size.count > GearPickValidation.sizeLimit))
                    if existing != nil {
                        Button("Remove", role: .destructive) {
                            if let existing { model.remove(id: existing.id) }
                        }
                    }
                }
            } else if model.cycle?.isOpen == false || model.serverClosed {
                Section {
                    Text("Gear picks are closed. Your saved list is locked.")
                        .foregroundStyle(.secondary)
                }
            }
            let others = model.lines.filter { $0.style == item.style }
            if !others.isEmpty {
                Section("Already picked") {
                    ForEach(others) { line in
                        Text("\(line.colorLabel) · \(line.size ?? "Size needed") · \(line.quantity)")
                    }
                }
            }
        }
        .disabled(model.isSaving)
    }

    private func applyColorChange(_ item: GearPickPhoneItem, colorCode: String) {
        let sku = GearPickValidation.sku(style: item.style, colorCode: colorCode)
        if let existing = model.lines.first(where: { $0.sku == sku }) {
            size = existing.size ?? ""
            quantity = existing.quantity
        } else {
            size = item.oneSize ? "OSFA" : (item.defaultSize ?? "")
            quantity = 1
        }
    }

    private func add(_ item: GearPickPhoneItem) {
        let chosenSize = item.oneSize ? "OSFA" : size
        if let kit = item.kit, !model.lines.contains(where: { $0.style == item.style }) {
            kitPrompt = KitPrompt(item: item, colorCode: colorCode, size: chosenSize, quantity: quantity, kit: kit)
            return
        }
        model.upsert(item: item, colorCode: colorCode, size: chosenSize, quantity: quantity)
        Haptics.selection()
    }

    private func confirmKitAdd() {
        guard let prompt = kitPrompt else { return }
        model.upsert(item: prompt.item, colorCode: prompt.colorCode, size: prompt.size, quantity: prompt.quantity)
        kitPrompt = nil
        Haptics.selection()
    }
}

private struct KitPrompt: Identifiable {
    let id = UUID()
    let item: GearPickPhoneItem
    let colorCode: String
    let size: String?
    let quantity: Int
    let title: String
    let message: String

    init(item: GearPickPhoneItem, colorCode: String, size: String?, quantity: Int, kit: GearPickPhoneKit) {
        self.item = item
        self.colorCode = colorCode
        self.size = size
        self.quantity = quantity
        let kitColor = item.colors.first { $0.code == kit.colorCode }?.label ?? "the department color"
        let picked = item.colors.first { $0.code == colorCode }?.label ?? "this color"
        title = kit.title
        if colorCode == kit.colorCode {
            message = "Your \(kit.shortLabel) already includes the \(item.name) in \(kitColor), covered by the department. You're welcome to add another one. It will count toward your pick allowance."
        } else {
            message = "Your \(kit.shortLabel) already includes the \(item.name) in \(kitColor), covered by the department. You're welcome to add it in \(picked) too. It will count toward your pick allowance."
        }
    }
}

struct GearPicksReviewView: View {
    var model: GearPicksModel
    @State private var confirmSubmit = false

    @ViewBuilder
    var body: some View {
        List {
            if model.lines.isEmpty {
                ContentUnavailableView {
                    Label("You haven't picked anything yet", systemImage: "tshirt")
                } description: {
                    Text(model.canEdit ? "Add gear from the list, then come back to save it." : "Nothing was saved for this cycle.")
                }
            } else {
                ForEach(model.lines) { line in
                    reviewRow(line)
                }
            }
            Section {
                LabeledContent("Picked", value: GearPickMoney.format(model.totalCents))
                LabeledContent("Left") {
                    Text(model.remainingCents < 0
                        ? "Over by \(GearPickMoney.format(abs(model.remainingCents)))"
                        : GearPickMoney.format(model.remainingCents))
                        .foregroundStyle(model.remainingCents < 0 ? Color.statusText(.red) : Color.primary)
                }
            }
            if let problem = model.problems.first {
                Section {
                    Text(problem)
                        .font(.subheadline)
                        .foregroundStyle(Color.statusText(.orange))
                }
            }
            if let message = model.conflictMessage ?? model.saveMessage {
                Section {
                    Text(message)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    if model.conflictMessage != nil {
                        Button("Discard and reload") { Task { await model.discardAndReload() } }
                    }
                }
            }
        }
        .navigationTitle("Your picks")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { reviewToolbar }
        .confirmationDialog(
            model.submittedAt == nil ? "Submit these picks?" : "Save these changes?",
            isPresented: $confirmSubmit,
            titleVisibility: .visible
        ) {
            Button(model.submittedAt == nil ? "Submit picks" : "Save changes") {
                Task { await model.save(submit: true) }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text(model.submittedAt == nil
                ? "You can still change them until the deadline."
                : "This replaces the list you already submitted.")
        }
        .disabled(model.isSaving)
    }

    @ToolbarContentBuilder
    private var reviewToolbar: some ToolbarContent {
        if model.canEdit {
            ToolbarItemGroup(placement: .bottomBar) {
                if model.submittedAt == nil {
                    Button(model.isSaving ? "Saving…" : "Save draft") {
                        Task { await model.save(submit: false) }
                    }
                    .disabled(!model.canSaveDraft)
                }
                Spacer()
                Button(model.submittedAt == nil ? "Submit" : "Save changes") { confirmSubmit = true }
                    .disabled(!model.canSubmit)
            }
        }
    }

    @ViewBuilder
    private func reviewRow(_ line: GearPickDraftLine) -> some View {
        let item = model.item(style: line.style)
        Section {
            HStack(alignment: .top, spacing: 12) {
                GearPickThumbnail(path: item?.colors.first { $0.code == line.colorCode }?.image, size: 44)
                VStack(alignment: .leading, spacing: 2) {
                    Text(line.itemName)
                    Text("\(line.colorLabel) · \(line.size ?? "Size needed")")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Text(GearPickMoney.format((item?.priceCents ?? line.unitPriceCents) * line.quantity))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
            .swipeActions {
                if model.canEdit {
                    Button("Remove", role: .destructive) { model.remove(id: line.id) }
                }
            }
            if model.canEdit {
                Stepper(value: Binding(
                    get: { line.quantity },
                    set: { model.setQuantity(id: line.id, quantity: $0) }
                ), in: 1...model.maxQuantity) {
                    Text("Quantity \(line.quantity)")
                }
                if let item, item.colors.count > 1 {
                    Picker("Color", selection: Binding(
                        get: { line.colorCode },
                        set: { model.setColor(id: line.id, colorCode: $0) }
                    )) {
                        ForEach(item.colors) { color in
                            Text(color.label).tag(color.code)
                        }
                    }
                }
                if let item, !item.oneSize {
                    let sizeBinding = Binding(
                        get: { line.size ?? "" },
                        set: { model.setSize(id: line.id, size: $0) }
                    )
                    Picker(item.sizeLabel, selection: sizeBinding) {
                        if line.size == nil { Text("Choose").tag("") }
                        ForEach(GearPickValidation.sizeChoices(item: item, current: line.size), id: \.self) { option in
                            Text(option).tag(option)
                        }
                    }
                }
            }
        }
    }
}

private func gearPickSwatch(_ hex: String) -> Color {
    var value = hex.trimmingCharacters(in: .whitespacesAndNewlines)
    if value.hasPrefix("#") { value.removeFirst() }
    guard value.count == 6, let int = Int(value, radix: 16) else {
        return Color(.systemGray3)
    }
    let red = Double((int >> 16) & 0xFF) / 255
    let green = Double((int >> 8) & 0xFF) / 255
    let blue = Double(int & 0xFF) / 255
    return Color(red: red, green: green, blue: blue)
}
