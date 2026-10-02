import SwiftUI

// MARK: - Changes (redesign row H) and staff actions (C5)
//
// H1 extend, H2 transfer (immediate, decision 2: no accept step, so H3 is
// dropped), H4 swap a unit, H5 change a reservation, and C5 staff actions.
// Each screen talks to the kiosk route that already enforces the rule; the
// screen only says what the route will allow before anyone taps.

extension KioskUser {
    /// Mirrors `checkout.manage_custody` (ADMIN, STAFF) in `permissions.ts`.
    var canManageAnyCheckout: Bool { role == "ADMIN" || role == "STAFF" }

    /// "Avery N." for grids and pill labels.
    var shortName: String {
        let parts = name.split(separator: " ")
        guard parts.count > 1, let initial = parts.last?.first else { return name }
        return "\(parts[0]) \(initial)."
    }
}

/// Fixed reason sent with a staff transfer; the route requires one from staff.
enum KioskTransferCopy {
    static let staffReason = "Transferred by staff at the kiosk"
}

// MARK: - H1 Extend

struct KioskExtendScreen: View {
    @Environment(\.today) private var today
    let checkoutId: String
    let title: String
    let detailLine: String
    let actorId: String
    let onCancel: () -> Void
    let onExtended: () -> Void

    @State private var window: KioskExtendWindow?
    @State private var loadError: String?
    @State private var day = Date()
    @State private var chosen: Date?
    @State private var isSaving = false
    @State private var saveError: String?

    private var currentEndsAt: Date { window?.currentEndsAt ?? Date() }

    /// Four day choices starting from the later of now and the current due day.
    private var days: [Date] {
        let calendar = Calendar.current
        let start = calendar.startOfDay(for: max(Date(), currentEndsAt))
        return (0..<4).compactMap { calendar.date(byAdding: .day, value: $0, to: start) }
    }

    /// Eight hourly times on the chosen day, all after the current due time.
    private var times: [Date] {
        let calendar = Calendar.current
        let floor = max(Date(), currentEndsAt)
        let first: Date
        if calendar.isDate(day, inSameDayAs: floor) {
            let hour = calendar.component(.hour, from: floor) + 1
            first = calendar.date(bySettingHour: min(hour, 23), minute: 0, second: 0, of: day) ?? day
        } else {
            first = calendar.date(bySettingHour: 9, minute: 0, second: 0, of: day) ?? day
        }
        return (0..<8).compactMap { calendar.date(byAdding: .hour, value: $0, to: first) }
            .filter { calendar.isDate($0, inSameDayAs: day) && $0 > floor }
    }

    private func isAllowed(_ date: Date) -> Bool {
        guard let window else { return false }
        guard let max = window.maxEndsAt else { return true }
        return date <= max
    }

    var body: some View {
        KioskSheetScreen(onDismiss: onCancel) {
            VStack(alignment: .leading, spacing: 4) {
                Text(KioskDueCopy.due(currentEndsAt).uppercased())
                    .font(KioskType.overline)
                    .tracking(KioskType.overlineTracking)
                    .foregroundStyle(currentEndsAt < Date() ? KioskSection.problem.text : KioskSection.comingBack.text)
                Text(title)
                    .font(.system(size: 30, weight: .heavy))
                    .foregroundStyle(KioskText.primary)
                    .lineLimit(2)
                Text(detailLine)
                    .font(KioskType.body)
                    .foregroundStyle(KioskText.secondary)
            }
            if let window {
                VStack(alignment: .leading, spacing: 8) {
                    Text(Self.headline(window))
                        .font(KioskType.cardTitle)
                        .foregroundStyle(KioskText.primary)
                    Text(Self.explanation(window))
                        .font(KioskType.meta)
                        .foregroundStyle(KioskText.secondary)
                        .lineSpacing(3)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .kioskCard()
            }
        } choice: {
            Text("Extend until")
                .font(KioskType.heroAction)
                .foregroundStyle(KioskText.primary)
            if let loadError {
                KioskErrorState(title: loadError) { Task { await load() } }
            } else if window == nil {
                ProgressView().tint(KioskText.primary).frame(maxWidth: .infinity, minHeight: 120)
            } else {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), spacing: 8) {
                    ForEach(days, id: \.self) { value in
                        KioskSlotChip(
                            title: Self.dayTitle(value, today: today),
                            detail: value.formatted(.dateTime.month(.abbreviated).day()),
                            isSelected: Calendar.current.isDate(value, inSameDayAs: day),
                            isEnabled: true
                        ) {
                            day = value
                            if let chosen, !Calendar.current.isDate(chosen, inSameDayAs: value) { self.chosen = nil }
                        }
                    }
                }
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), spacing: 8) {
                    ForEach(times, id: \.self) { value in
                        let allowed = isAllowed(value)
                        KioskSlotChip(
                            title: value.formatted(.dateTime.hour().minute()),
                            detail: allowed ? nil : window?.limitingItem.map { "\($0.assetTag) needed" },
                            isSelected: chosen == value,
                            isEnabled: allowed
                        ) { chosen = value }
                    }
                }
                if let chosen {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("NEW DUE TIME")
                            .font(KioskType.overline)
                            .tracking(KioskType.overlineTracking)
                            .foregroundStyle(KioskText.tertiary)
                        Text(KioskDueCopy.relative(chosen, now: today))
                            .font(.system(size: 24, weight: .heavy))
                            .foregroundStyle(KioskText.primary)
                        Text(Self.moreTime(from: currentEndsAt, to: chosen))
                            .font(KioskType.meta)
                            .foregroundStyle(KioskText.tertiary)
                    }
                    .padding(.horizontal, 18)
                    .padding(.vertical, 16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .kioskCard()
                }
            }
            if let saveError {
                KioskFeedbackBanner(tone: .error, message: saveError)
            }
            Spacer(minLength: 8)
            KioskPrimaryPill(
                title: chosen.map { "Extend to \($0.formatted(.dateTime.hour().minute()))" } ?? "Pick a new time",
                isEnabled: chosen != nil && (window?.canExtend ?? false),
                isBusy: isSaving,
                height: 64
            ) { Task { await save() } }
        }
        .task { await load() }
    }

    private func load() async {
        loadError = nil
        do {
            let loaded = try await KioskAPI.shared.kioskExtendWindow(checkoutId: checkoutId)
            window = loaded
            day = Calendar.current.startOfDay(for: max(Date(), loaded.currentEndsAt))
        } catch {
            loadError = (error as? APIError)?.errorDescription ?? "Couldn't check how far this can go."
        }
    }

    private func save() async {
        guard let chosen, !isSaving else { return }
        isSaving = true
        saveError = nil
        defer { isSaving = false }
        do {
            let result = try await KioskAPI.shared.kioskUpdateActiveCheckout(id: checkoutId, actorId: actorId, title: nil, endsAt: chosen)
            if result.success {
                onExtended()
            } else {
                saveError = result.error ?? result.message ?? "That time didn't save. Pick another."
            }
        } catch {
            saveError = (error as? APIError)?.errorDescription ?? "That time didn't save. Try again."
        }
    }

    /// "Can go until 10:00 PM".
    static func headline(_ window: KioskExtendWindow) -> String {
        guard let max = window.maxEndsAt else { return "No limit" }
        guard window.canExtend else { return "Can't go later" }
        return "Can go until \(KioskDueCopy.relative(max).replacingOccurrences(of: "Today at ", with: ""))"
    }

    static func explanation(_ window: KioskExtendWindow) -> String {
        guard let item = window.limitingItem, let max = window.maxEndsAt else {
            return "Nothing else needs this gear, so pick any time."
        }
        let by = item.holderName.map { " by \($0)" } ?? ""
        let from = KioskDueCopy.midSentence(item.startsAt)
        guard window.canExtend else {
            return "\(item.assetTag) is reserved\(by) from \(from), so this can't go later. Return it on time."
        }
        return "\(item.assetTag) is reserved\(by) from \(from), so this can go until \(max.formatted(.dateTime.hour().minute())). Pick a later day only if you return the \(item.name) first."
    }

    static func dayTitle(_ date: Date, today: Date) -> String {
        let calendar = Calendar.current
        if calendar.dayOffset(of: date, from: today) == 0 { return "Today" }
        if calendar.dayOffset(of: date, from: today) == 1 { return "Tomorrow" }
        return date.formatted(.dateTime.weekday(.abbreviated))
    }

    static func moreTime(from: Date, to: Date) -> String {
        let hours = Int((to.timeIntervalSince(max(from, Date())) / 3600).rounded())
        if hours < 24 { return "\(max(hours, 1)) hour\(hours == 1 ? "" : "s") more" }
        let days = Int((Double(hours) / 24).rounded())
        return "\(days) day\(days == 1 ? "" : "s") more"
    }
}

/// A day or time choice: white fill when chosen, dimmed with a reason when
/// the gear is needed by then.
struct KioskSlotChip: View {
    let title: String
    var detail: String?
    let isSelected: Bool
    let isEnabled: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 1) {
                Text(title).font(.system(size: 16, weight: .bold))
                if let detail {
                    Text(detail)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(isSelected ? KioskText.onPrimaryDetail : KioskText.tertiary)
                }
            }
            .foregroundStyle(isSelected ? KioskText.onPrimary : (isEnabled ? KioskText.primary : KioskText.muted))
            .frame(maxWidth: .infinity, minHeight: 56)
            .background(
                isSelected ? KioskText.primary : (isEnabled ? KioskSurface.cardRaised : KioskSurface.card),
                in: RoundedRectangle(cornerRadius: KioskRadius.lg)
            )
            .overlay(
                RoundedRectangle(cornerRadius: KioskRadius.lg)
                    .stroke(isSelected ? KioskStroke.selected : KioskStroke.standard, lineWidth: 1)
            )
            .contentShape(RoundedRectangle(cornerRadius: KioskRadius.lg))
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
    }
}

// MARK: - H2 Transfer

struct KioskTransferScreen: View {
    let checkoutId: String
    let title: String
    let holderId: String?
    let holderName: String
    let actor: KioskUser
    /// C5 "Transfer the whole checkout": no "Just some" choice.
    var wholeOnly: Bool = false
    let onCancel: () -> Void
    let onTransferred: (KioskTransferResult, KioskUser) -> Void

    @State private var detail: KioskCheckoutDetail?
    @State private var roster: [KioskUser] = []
    @State private var loadError: String?
    @State private var justSome = false
    @State private var selectedIds: Set<String> = []
    @State private var target: KioskUser?
    @State private var isSaving = false
    @State private var saveError: String?
    /// One id per attempt, kept across retries so a lost answer replays.
    @State private var requestId = "\(Int64(Date().timeIntervalSince1970 * 1000)):\(UUID().uuidString)"

    /// Serialized and numbered units: the route moves these by id.
    private var movable: [KioskCheckoutDetail.ReturnItem] {
        (detail?.items ?? []).filter { !$0.returned && ($0.isNumberedBulk ? $0.unitNumber != nil : !$0.isBulkDisplay) }
    }

    private var counted: [KioskCheckoutDetail.ReturnItem] {
        (detail?.items ?? []).filter { !$0.returned && $0.isBulkQuantity }
    }

    private var chosenItems: [KioskCheckoutDetail.ReturnItem] {
        justSome ? movable.filter { selectedIds.contains($0.id) } : movable
    }

    private var candidates: [KioskUser] {
        roster.filter { $0.id != holderId }
    }

    var body: some View {
        KioskSheetScreen(onDismiss: onCancel) {
            VStack(alignment: .leading, spacing: 4) {
                Text("TRANSFER")
                    .font(KioskType.overline)
                    .tracking(KioskType.overlineTracking)
                    .foregroundStyle(KioskText.tertiary)
                Text(title)
                    .font(.system(size: 30, weight: .heavy))
                    .foregroundStyle(KioskText.primary)
                    .lineLimit(2)
                Text(contextLine)
                    .font(KioskType.body)
                    .foregroundStyle(KioskText.secondary)
            }
            if !wholeOnly && movable.count > 1 {
                VStack(spacing: 10) {
                    scopeChoice(title: movable.count == 2 ? "Both items" : "All \(movable.count) items", selected: !justSome) { justSome = false }
                    scopeChoice(title: "Just some of them", selected: justSome) {
                        justSome = true
                        if selectedIds.isEmpty { selectedIds = Set(movable.prefix(1).map(\.id)) }
                    }
                }
            }
            if justSome {
                ScrollView {
                    VStack(spacing: 0) {
                        ForEach(movable) { item in
                            Button {
                                if selectedIds.contains(item.id) { selectedIds.remove(item.id) } else { selectedIds.insert(item.id) }
                            } label: {
                                KioskItemRow(tag: item.itemListPrimaryTitle, name: item.itemListSecondaryTitle, isDone: selectedIds.contains(item.id))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .kioskCard()
                }
                .frame(maxHeight: 220)
            }
            Text(counted.isEmpty
                 ? "It moves to them right away. From then on it's on their record, not \(holderFirstName)'s."
                 : "It moves to them right away. Counted items like \(counted[0].bulkSkuName ?? counted[0].name) stay on \(holderFirstName)'s checkout.")
                .font(KioskType.meta)
                .foregroundStyle(KioskText.tertiary)
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
        } choice: {
            Text("Who's taking it over?")
                .font(KioskType.heroAction)
                .foregroundStyle(KioskText.primary)
            if let loadError {
                KioskErrorState(title: loadError) { Task { await load() } }
            } else if detail == nil || roster.isEmpty {
                ProgressView().tint(KioskText.primary).frame(maxWidth: .infinity, minHeight: 120)
            } else {
                ScrollView {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 3), spacing: 6) {
                        ForEach(candidates) { person in
                            KioskPersonChip(person: person, isSelected: target?.id == person.id) { target = person }
                        }
                    }
                }
                .scrollIndicators(.hidden)
            }
            if let saveError {
                KioskFeedbackBanner(tone: .error, message: saveError)
            }
            KioskPrimaryPill(
                title: target.map { "Transfer to \($0.shortName)" } ?? "Choose who's taking it",
                detail: target == nil ? nil : "\(chosenItems.count) item\(chosenItems.count == 1 ? "" : "s")",
                isEnabled: target != nil && !chosenItems.isEmpty && detail?.updatedAt != nil,
                isBusy: isSaving,
                height: 64
            ) { Task { await transfer() } }
        }
        .task { await load() }
    }

    private var holderFirstName: String {
        holderName.split(separator: " ").first.map(String.init) ?? holderName
    }

    private var contextLine: String {
        let count = movable.count
        let due = detail.map { KioskDueCopy.midSentence($0.endsAt) } ?? ""
        return "From \(holderName) · \(count) item\(count == 1 ? "" : "s")\(due.isEmpty ? "" : " · due \(due)")"
    }

    private func scopeChoice(title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: selected ? "largecircle.fill.circle" : "circle")
                    .foregroundStyle(KioskText.primary)
                Text(title).font(.system(size: 15, weight: selected ? .bold : .semibold))
                Spacer()
            }
            .foregroundStyle(KioskText.primary)
            .padding(.horizontal, 14)
            .frame(minHeight: 52)
            .background(selected ? KioskSurface.cardRaised : KioskSurface.card, in: RoundedRectangle(cornerRadius: KioskRadius.lg))
            .overlay(RoundedRectangle(cornerRadius: KioskRadius.lg).stroke(selected ? KioskStroke.selected : KioskStroke.standard, lineWidth: 1))
            .contentShape(RoundedRectangle(cornerRadius: KioskRadius.lg))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? [.isSelected] : [])
    }

    private func load() async {
        loadError = nil
        do {
            async let loadedDetail = KioskAPI.shared.kioskCheckoutDetail(id: checkoutId)
            async let loadedRoster = KioskAPI.shared.kioskUsers()
            detail = try await loadedDetail
            roster = try await loadedRoster
        } catch {
            loadError = (error as? APIError)?.errorDescription ?? "Couldn't load this checkout."
        }
    }

    private func transfer() async {
        guard let target, let updatedAt = detail?.updatedAt, !isSaving else {
            if detail?.updatedAt == nil { saveError = "Refresh this checkout before transferring it." }
            return
        }
        isSaving = true
        saveError = nil
        defer { isSaving = false }
        let items = chosenItems
        do {
            let result = try await KioskAPI.shared.kioskTransferCheckout(
                id: checkoutId,
                actorId: actor.id,
                requestId: requestId,
                expectedUpdatedAt: updatedAt,
                targetUserId: target.id,
                assetIds: items.filter { !$0.isNumberedBulk }.map(\.id),
                bulkUnitIds: items.filter(\.isNumberedBulk).map(\.id),
                reason: actor.canManageAnyCheckout ? KioskTransferCopy.staffReason : nil
            )
            onTransferred(result, target)
        } catch let rejected as KioskRequestRejected {
            // A refused transfer is sealed under this id; the next try is new.
            requestId = "\(Int64(Date().timeIntervalSince1970 * 1000)):\(UUID().uuidString)"
            saveError = rejected.message
        } catch {
            // Network, 5xx, or an unreadable receipt: the server may have
            // committed. Keep the id so the next tap replays the receipt.
            saveError = "We couldn't confirm that transfer. Tap Transfer again to check."
        }
    }
}

/// A roster tile for choosing a person: avatar, short name, white outline
/// when chosen.
struct KioskPersonChip: View {
    let person: KioskUser
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                KioskAvatar(url: person.avatarUrl, initials: person.initials, size: 28)
                Text(person.shortName)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(KioskText.primary)
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 8)
            .frame(minHeight: 44)
            .background(isSelected ? KioskSurface.cardRaised : KioskSurface.card, in: RoundedRectangle(cornerRadius: KioskRadius.md))
            .overlay(RoundedRectangle(cornerRadius: KioskRadius.md).stroke(isSelected ? KioskStroke.selected : KioskStroke.hairline, lineWidth: isSelected ? 2 : 1))
            .contentShape(RoundedRectangle(cornerRadius: KioskRadius.md))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(person.name)
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
    }
}

// MARK: - H4 Swap a unit

struct KioskSwapScreen: View {
    let checkoutId: String
    let item: KioskCheckoutDetail.ReturnItem
    let contextLine: String
    let actorId: String
    /// "Something's wrong with it" hands off to the return's damaged report
    /// (G4). Nil for batteries: reports key on serialized items only.
    let onReportProblem: (() -> Void)?
    let onCancel: () -> Void
    let onSwapped: (String) -> Void

    @State private var somethingWrong = false
    @State private var replacement: String?
    @State private var isSaving = false
    @State private var errorMessage: String?

    private var oldLabel: String { item.isNumberedBulk ? (item.unitNumber.map { "#\($0)" } ?? item.tagName) : item.tagName }

    var body: some View {
        KioskSheetScreen(onDismiss: onCancel) {
            VStack(alignment: .leading, spacing: 4) {
                Text("SWAP")
                    .font(KioskType.overline)
                    .tracking(KioskType.overlineTracking)
                    .foregroundStyle(KioskSection.takingOut.text)
                Text(item.name)
                    .font(.system(size: 30, weight: .heavy))
                    .foregroundStyle(KioskText.primary)
                    .lineLimit(2)
                Text(contextLine)
                    .font(KioskType.body)
                    .foregroundStyle(KioskText.secondary)
            }
            HStack(spacing: 8) {
                KioskChoiceChip(title: "Just swapping", isSelected: !somethingWrong) { somethingWrong = false }
                if onReportProblem != nil {
                    KioskChoiceChip(title: "Something's wrong with it", isSelected: somethingWrong) { somethingWrong = true }
                }
            }
            Text(somethingWrong
                 ? "Scan \(oldLabel) back on the return screen and report what's wrong. It's held for staff. Then add the replacement with Add items."
                 : "\(oldLabel) goes back on the shelf, ready for someone else. The replacement takes its place on the same checkout and due time.\(onReportProblem == nil ? "" : " Pick \"Something's wrong\" only if \(oldLabel) needs a look.")")
                .font(KioskType.meta)
                .foregroundStyle(KioskText.tertiary)
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
        } choice: {
            if somethingWrong, let onReportProblem {
                KioskNoticeStage(
                    section: .comingBack,
                    overline: "Report it",
                    title: "Tell staff what's wrong with \(oldLabel)",
                    message: "The return screen takes the photo and the note. Nothing on this checkout changes until you scan it there."
                )
                KioskPrimaryPill(title: "Report \(oldLabel)", height: 64, action: onReportProblem)
            } else {
                Text("Scan the replacement")
                    .font(KioskType.heroAction)
                    .foregroundStyle(KioskText.primary)
                if let replacement {
                    KioskConfirmationStage(
                        section: .takingOut,
                        title: "\(oldLabel) → \(replacement)",
                        detail: "\(replacement) scanned",
                        hint: "Nothing changes until you swap.",
                        onUndo: { self.replacement = nil; errorMessage = nil }
                    )
                } else {
                    KioskScanPrompt(
                        title: "Scan another \(item.bulkSkuName ?? item.name)",
                        detail: "It has to be the same model as \(oldLabel)."
                    )
                }
                if let errorMessage {
                    KioskFeedbackBanner(tone: .error, message: errorMessage)
                }
                KioskPrimaryPill(
                    title: replacement.map { "Swap \(oldLabel) for \($0)" } ?? "Scan the replacement",
                    isEnabled: replacement != nil,
                    isBusy: isSaving,
                    height: 64
                ) { Task { await swap() } }
            }
        }
        .overlay(alignment: .bottom) {
            HIDScannerField(isEnabled: !somethingWrong && !isSaving) { value in
                replacement = value
                errorMessage = nil
            }
            .frame(width: 1, height: 1)
            .opacity(0)
        }
        #if DEBUG
        .onAppear {
            if KioskFixtureScenario.active == .changesSwap { replacement = "#12" }
        }
        #endif
    }

    private func swap() async {
        guard let replacement, !isSaving else { return }
        isSaving = true
        errorMessage = nil
        defer { isSaving = false }
        do {
            let result = try await KioskAPI.shared.kioskSwapActiveCheckoutItem(id: checkoutId, actorId: actorId, item: item, scanValue: replacement)
            if result.success {
                onSwapped(result.message ?? "Swapped \(oldLabel) for \(result.added?.tagName ?? replacement)")
            } else {
                errorMessage = result.error ?? "That swap didn't go through. Nothing changed."
                self.replacement = nil
            }
        } catch {
            errorMessage = (error as? APIError)?.errorDescription ?? "That swap didn't go through. Nothing changed."
        }
    }
}

// MARK: - H5 Change a reservation

/// Staged edits to a reservation. Nothing is sent until Save; then each
/// change goes to the per-operation endpoint in `operations` order, and each
/// success hands its `updatedAt` to the next.
struct KioskReservationDraft: Equatable {
    struct Added: Identifiable, Equatable {
        let id = UUID()
        let scanValue: String
        /// The reservation row this scan replaces (swap = remove + add).
        var replacing: String?
    }

    enum Operation: Equatable {
        case add(scanValue: String)
        case quantity(itemId: String, name: String, quantity: Int)
        case remove(itemId: String, name: String)
    }

    var items: [KioskReservationManifest.Item]
    var removed: Set<String> = []
    var quantities: [String: Int] = [:]
    var added: [Added] = []

    var hasChanges: Bool { !operations.isEmpty }

    func quantity(of item: KioskReservationManifest.Item) -> Int {
        quantities[item.id] ?? item.quantity
    }

    mutating func stageAdd(_ scanValue: String, replacing: String? = nil) {
        added.append(Added(scanValue: scanValue, replacing: replacing))
        if let replacing { removed.insert(replacing) }
    }

    mutating func undoAdd(_ id: UUID) {
        guard let index = added.firstIndex(where: { $0.id == id }) else { return }
        if let replacing = added[index].replacing { removed.remove(replacing) }
        added.remove(at: index)
    }

    mutating func toggleRemove(_ item: KioskReservationManifest.Item) {
        if removed.contains(item.id) { removed.remove(item.id) } else { removed.insert(item.id) }
    }

    mutating func step(_ item: KioskReservationManifest.Item, by delta: Int) {
        let next = max(0, quantity(of: item) + delta)
        quantities[item.id] = next == item.quantity ? nil : next
    }

    /// Adds first, so a swap's replacement lands before its original leaves
    /// and removing everything then adding never trips "keep at least one".
    var operations: [Operation] {
        var ops = added.map { Operation.add(scanValue: $0.scanValue) }
        for item in items where !removed.contains(item.id) {
            if let quantity = quantities[item.id], item.isBulk {
                ops.append(quantity == 0 ? .remove(itemId: item.id, name: item.name) : .quantity(itemId: item.id, name: item.name, quantity: quantity))
            }
        }
        for item in items where removed.contains(item.id) {
            ops.append(.remove(itemId: item.id, name: item.name))
        }
        return ops
    }
}

struct KioskReservationEditView: View {
    let reservationId: String
    let title: String
    let user: KioskUser
    let onClose: (Bool) -> Void

    @State private var manifest: KioskReservationManifest?
    @State private var draft = KioskReservationDraft(items: [])
    @State private var loadError: String?
    @State private var swapping: KioskReservationManifest.Item?
    @State private var lastAdded: KioskReservationDraft.Added?
    @State private var isSaving = false
    @State private var failures: [String] = []
    @State private var savedAny = false
    @State private var showDiscard = false

    private var visibleItems: [KioskReservationManifest.Item] {
        (manifest?.items ?? []).filter { $0.quantity > 0 }
    }

    private var reservedCount: Int {
        visibleItems.filter { !draft.removed.contains($0.id) }.reduce(0) { $0 + draft.quantity(of: $1) } + draft.added.count
    }

    var body: some View {
        KioskTaskScaffold(header: KioskTaskHeader(
            title: "Change reservation",
            subtitle: "\(user.shortName) · \(manifest?.title ?? title)",
            avatarURL: user.avatarUrl,
            avatarInitials: user.initials,
            onBack: {
                if draft.hasChanges { showDiscard = true } else { onClose(savedAny) }
            }
        )) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Change your reservation")
                    .font(KioskType.heroAction)
                    .foregroundStyle(KioskText.primary)
                Text("Scan something to add it. Swap or remove on the right. Nothing changes until you save.")
                    .font(.system(size: 15))
                    .foregroundStyle(KioskText.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            stage
            KioskPrimaryPill(
                title: "Save changes",
                detail: draft.hasChanges ? "\(draft.operations.count) change\(draft.operations.count == 1 ? "" : "s")" : nil,
                isEnabled: draft.hasChanges,
                isBusy: isSaving
            ) { Task { await save() } }
        } panel: {
            KioskSectionHeader(title: "Reserved", detail: "\(manifest?.title ?? title)", count: "\(reservedCount) item\(reservedCount == 1 ? "" : "s")", section: .pickingUp)
            if let loadError {
                KioskErrorState(title: loadError) { Task { await load() } }
            } else if manifest == nil {
                ProgressView().tint(KioskText.primary).frame(maxWidth: .infinity, minHeight: 120)
            } else {
                ScrollView {
                    VStack(spacing: 0) {
                        ForEach(visibleItems) { item in row(item) }
                        ForEach(draft.added) { added in
                            KioskItemRow(tag: added.scanValue, isDone: false, section: .pickingUp) {
                                KioskRowNote(text: "Just added", color: KioskSection.pickingUp.text)
                                KioskRowRemoveButton(accessibilityLabel: "Remove \(added.scanValue)") {
                                    draft.undoAdd(added.id)
                                    if lastAdded?.id == added.id { lastAdded = nil }
                                }
                            }
                        }
                    }
                    .kioskCard()
                }
                .scrollIndicators(.hidden)
            }
        }
        .overlay(alignment: .bottom) {
            HIDScannerField(isEnabled: !isSaving && manifest != nil && !showDiscard) { stageScan($0) }
                .frame(width: 1, height: 1)
                .opacity(0)
        }
        .overlay {
            if showDiscard {
                KioskConfirmationCard(
                    title: "Leave without saving?",
                    message: "Your reservation stays the way it was.",
                    cancelTitle: "Keep editing",
                    confirmTitle: "Leave",
                    confirmRole: .destructive,
                    onCancel: { showDiscard = false },
                    onConfirm: { onClose(savedAny) }
                )
            }
        }
        .background(KioskSurface.base.ignoresSafeArea())
        .task { await load() }
    }

    @ViewBuilder
    private var stage: some View {
        if !failures.isEmpty {
            KioskNoticeStage(
                section: .problem,
                overline: "Not saved",
                title: failures.count == 1 ? "One change didn't go through" : "\(failures.count) changes didn't go through",
                message: failures.joined(separator: "\n") + "\n\nEverything else was saved. The list shows what's reserved now.",
                showsAlertGlyph: true
            )
        } else if let swapping {
            KioskScanPrompt(
                title: "Scan the replacement",
                detail: "It takes the place of \(swapping.name) when you save.",
                section: .pickingUp
            )
            Button("Cancel swap") { self.swapping = nil }
                .kioskButtonRole(.quiet)
        } else if let lastAdded {
            KioskConfirmationStage(
                section: .pickingUp,
                title: "\(lastAdded.scanValue) added",
                detail: lastAdded.replacing.flatMap { id in manifest?.items.first { $0.id == id }?.name }.map { "In place of \($0)" },
                hint: "Saved when you tap Save changes.",
                onUndo: {
                    draft.undoAdd(lastAdded.id)
                    self.lastAdded = nil
                }
            )
        } else {
            KioskScanPrompt(title: "Scan to add", detail: "Anything you scan joins this reservation.", section: .pickingUp)
        }
    }

    @ViewBuilder
    private func row(_ item: KioskReservationManifest.Item) -> some View {
        let isRemoved = draft.removed.contains(item.id)
        if item.isBulk {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 10) {
                    Image(systemName: "battery.100percent")
                        .foregroundStyle(KioskSection.pickingUp.accent)
                    Text("\(draft.quantity(of: item)) × \(item.name)")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(isRemoved ? KioskText.muted : KioskText.primary)
                        .strikethrough(isRemoved)
                    Spacer()
                    Button("− 1") { draft.step(item, by: -1) }
                        .kioskButtonRole(.quiet)
                        .disabled(draft.quantity(of: item) == 0 || isRemoved)
                    Button("+ 1") { draft.step(item, by: 1) }
                        .kioskButtonRole(.quiet)
                        .disabled(isRemoved)
                }
                Text(KioskBatteryCopy.reservedHint)
                    .font(KioskType.meta)
                    .foregroundStyle(KioskText.tertiary)
                    .padding(.leading, 32)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
        } else {
            KioskItemRow(tag: item.name, isDone: false, section: .pickingUp) {
                if isRemoved {
                    KioskRowNote(text: draft.added.contains { $0.replacing == item.id } ? "Swapped" : "Removed", color: KioskSection.problem.text)
                    Button("Keep") {
                        if let swap = draft.added.first(where: { $0.replacing == item.id }) { draft.undoAdd(swap.id) } else { draft.toggleRemove(item) }
                    }
                    .font(KioskType.chip)
                    .kioskButtonRole(.quiet)
                } else {
                    Button("Swap") { swapping = item; lastAdded = nil; failures = [] }
                        .font(KioskType.chip)
                        .kioskButtonRole(.quiet)
                    KioskRowRemoveButton(accessibilityLabel: "Remove \(item.name)") { draft.toggleRemove(item) }
                }
            }
        }
    }

    private func stageScan(_ value: String) {
        failures = []
        draft.stageAdd(value, replacing: swapping?.id)
        lastAdded = draft.added.last
        swapping = nil
    }

    private func load() async {
        loadError = nil
        do {
            let loaded = try await KioskAPI.shared.kioskReservationManifest(id: reservationId, actorId: user.id)
            manifest = loaded
            draft = KioskReservationDraft(items: loaded.items)
            #if DEBUG
            if KioskFixtureScenario.active == .changesReservation, let first = loaded.items.first(where: { !$0.isBulk }) {
                draft.stageAdd("MIC-09")
                lastAdded = draft.added.last
                draft.toggleRemove(first)
            }
            #endif
        } catch APIError.notFound {
            loadError = "This reservation is no longer available."
        } catch {
            loadError = (error as? APIError)?.errorDescription ?? "Couldn't load this reservation."
        }
    }

    private func save() async {
        guard let manifest, !isSaving else { return }
        isSaving = true
        defer { isSaving = false }
        var expected = manifest.updatedAt
        var failed: [String] = []
        // A swap's original must stay if its replacement never landed.
        var keepOriginals: Set<String> = []
        for operation in draft.operations {
            if case .remove(let itemId, let name) = operation, keepOriginals.contains(itemId) {
                failed.append("Remove \(name): kept because its replacement wasn't added.")
                continue
            }
            do {
                let result: KioskReservationMutationResult
                switch operation {
                case .add(let scanValue):
                    result = try await KioskAPI.shared.kioskUpdateReservationItem(id: reservationId, actorId: user.id, expectedUpdatedAt: expected, action: "add", scanValue: scanValue)
                case .quantity(let itemId, _, let quantity):
                    result = try await KioskAPI.shared.kioskUpdateReservationItem(id: reservationId, actorId: user.id, expectedUpdatedAt: expected, action: "quantity", itemId: itemId, quantity: quantity)
                case .remove(let itemId, _):
                    result = try await KioskAPI.shared.kioskUpdateReservationItem(id: reservationId, actorId: user.id, expectedUpdatedAt: expected, action: "remove", itemId: itemId)
                }
                if let updatedAt = result.updatedAt { expected = updatedAt }
                savedAny = true
            } catch {
                let reason = (error as? APIError)?.errorDescription ?? "Try again."
                failed.append("\(Self.label(operation)): \(reason)")
                if case .add(let scanValue) = operation {
                    for staged in draft.added where staged.scanValue == scanValue {
                        if let replacing = staged.replacing { keepOriginals.insert(replacing) }
                    }
                }
            }
        }
        if failed.isEmpty {
            onClose(true)
            return
        }
        failures = failed
        lastAdded = nil
        await load()
    }

    static func label(_ operation: KioskReservationDraft.Operation) -> String {
        switch operation {
        case .add(let scanValue): "Add \(scanValue)"
        case .quantity(_, let name, let quantity): "\(name) to \(quantity)"
        case .remove(_, let name): "Remove \(name)"
        }
    }
}

// MARK: - C5 Staff actions on a booking

/// Reached from a booking's sheet on home. Staff tap their name, then the
/// actions appear under it. Every action is recorded under that name.
struct KioskStaffActionsFlow: View {
    let context: KioskCheckoutDrawerContext
    let onClose: (Bool) -> Void

    private enum Step {
        case pick
        case actions
        case extend
        case transfer
        case report
    }

    @State private var step: Step = .pick
    @State private var staff: KioskUser?
    @State private var roster: [KioskUser] = []
    @State private var loadError: String?
    @State private var detail: KioskCheckoutDetail?
    @State private var reportStep: KioskReturnReportStep? = .choose(selectedId: nil)
    @State private var notice: String?
    @State private var changed = false

    var body: some View {
        ZStack {
            KioskSurface.base.ignoresSafeArea()
            switch step {
            case .pick: picker
            case .actions: actions
            case .extend:
                if let staff {
                    KioskExtendScreen(
                        checkoutId: context.checkoutId,
                        title: context.title,
                        detailLine: "\(context.requesterName) · \(detail?.refNumber ?? "")",
                        actorId: staff.id,
                        onCancel: { step = .actions },
                        onExtended: { finish("Due time changed. \(context.requesterName) is notified.") }
                    )
                }
            case .transfer:
                if let staff {
                    KioskTransferScreen(
                        checkoutId: context.checkoutId,
                        title: context.title,
                        holderId: context.requesterId,
                        holderName: context.requesterName,
                        actor: staff,
                        wholeOnly: true,
                        onCancel: { step = .actions },
                        onTransferred: { _, _ in
                            changed = true
                            onClose(true)
                        }
                    )
                }
            case .report:
                if let staff {
                    KioskReturnReportView(
                        bookingId: context.checkoutId,
                        actorId: staff.id,
                        checkoutTitle: context.title,
                        ownerSubtitle: "\(context.requesterName) · reported by \(staff.shortName)",
                        avatarURL: context.requesterAvatarUrl,
                        avatarInitials: context.requesterInitials,
                        items: reportableItems,
                        returnedIds: Set((detail?.items ?? []).filter(\.returned).map(\.id)),
                        step: $reportStep,
                        onReported: { result, item in
                            finish(result.type == "LOST" ? "\(item.itemListPrimaryTitle) marked missing." : "\(item.itemListPrimaryTitle) reported and held for staff.")
                        }
                    )
                    .onChange(of: reportStep) { _, next in
                        if next == nil { step = .actions; reportStep = .choose(selectedId: nil) }
                    }
                }
            }
        }
        .task { await load() }
    }

    private var reportableItems: [KioskCheckoutDetail.ReturnItem] {
        (detail?.items ?? []).filter { !$0.isBulkDisplay && $0.returnsByQuantity != true }
    }

    private func finish(_ message: String) {
        changed = true
        notice = message
        step = .actions
        reportStep = .choose(selectedId: nil)
        Task { detail = try? await KioskAPI.shared.kioskCheckoutDetail(id: context.checkoutId) }
    }

    private var picker: some View {
        KioskSheetScreen(onDismiss: { onClose(changed) }) {
            VStack(alignment: .leading, spacing: 4) {
                Text("STAFF ACTIONS")
                    .font(KioskType.overline)
                    .tracking(KioskType.overlineTracking)
                    .foregroundStyle(KioskText.tertiary)
                Text(context.title)
                    .font(.system(size: 30, weight: .heavy))
                    .foregroundStyle(KioskText.primary)
                    .lineLimit(2)
                Text(context.requesterName)
                    .font(KioskType.body)
                    .foregroundStyle(KioskText.secondary)
            }
            Text("Actions are recorded under your name. Returning it the normal way still works for anyone: scan the gear.")
                .font(KioskType.meta)
                .foregroundStyle(KioskText.tertiary)
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
        } choice: {
            Text("Staff: tap your name")
                .font(KioskType.heroAction)
                .foregroundStyle(KioskText.primary)
            if let loadError {
                KioskErrorState(title: loadError) { Task { await load() } }
            } else {
                ScrollView {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 3), spacing: 6) {
                        ForEach(roster.filter(\.canManageAnyCheckout)) { person in
                            KioskPersonChip(person: person, isSelected: staff?.id == person.id) {
                                staff = person
                                step = .actions
                            }
                        }
                    }
                }
                .scrollIndicators(.hidden)
            }
        }
    }

    private var actions: some View {
        ZStack {
            KioskSheetBackdrop.color.ignoresSafeArea()
            VStack(spacing: 0) {
                HStack(spacing: 12) {
                    if let staff {
                        KioskAvatar(url: staff.avatarUrl, initials: staff.initials, size: 32)
                        Text(staff.shortName).font(.system(size: 16, weight: .bold)).foregroundStyle(KioskText.primary)
                    }
                    Text("STAFF")
                        .font(KioskType.chipStrong)
                        .tracking(1.1)
                        .foregroundStyle(KioskText.secondary)
                        .padding(.horizontal, 10)
                        .frame(height: 24)
                        .background(KioskSurface.control, in: Capsule())
                    Spacer()
                    Text("Staff actions are recorded under your name")
                        .font(KioskType.meta)
                        .foregroundStyle(KioskText.tertiary)
                }
                .padding(.horizontal, 28)
                .frame(height: 60)
                .background(KioskSurface.cardRaised)
                HStack(alignment: .top, spacing: 28) {
                    VStack(alignment: .leading, spacing: 16) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(statusLine)
                                .font(KioskType.overline)
                                .tracking(KioskType.overlineTracking)
                                .foregroundStyle(context.isOverdue ? KioskSection.problem.text : KioskSection.comingBack.text)
                            Text(context.title)
                                .font(.system(size: 30, weight: .heavy))
                                .foregroundStyle(KioskText.primary)
                                .lineLimit(2)
                            Text([context.requesterName, detail?.refNumber].compactMap { $0 }.joined(separator: " · "))
                                .font(KioskType.body)
                                .foregroundStyle(KioskText.secondary)
                        }
                        VStack(spacing: 0) {
                            ForEach((detail?.items ?? []).filter { !$0.returned }.prefix(6)) { item in
                                KioskItemRow(tag: item.itemListPrimaryTitle, name: item.itemListSecondaryTitle, isDone: false, section: .comingBack)
                            }
                        }
                        .kioskCard()
                        if let notice {
                            KioskFeedbackBanner(tone: .success, message: notice)
                        }
                        Text("Returning it the normal way still works for anyone: scan the gear.")
                            .font(KioskType.meta)
                            .foregroundStyle(KioskText.tertiary)
                        Spacer(minLength: 0)
                        Button { onClose(changed) } label: {
                            Text("Done").font(.system(size: 17, weight: .semibold)).frame(maxWidth: .infinity, minHeight: 56)
                        }
                        .kioskButtonRole(.secondary)
                    }
                    .frame(width: 400)
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Staff actions")
                            .font(KioskType.heroAction)
                            .foregroundStyle(KioskText.primary)
                            .padding(.bottom, 4)
                        actionRow("Change due back", "Give \(firstName) more time. They're notified.") { step = .extend }
                        actionRow("Transfer the whole checkout", "Move all of it to someone else's record.") { step = .transfer }
                        if !reportableItems.isEmpty {
                            actionRow("Report lost or damaged", "Closes the item and opens a report.") { step = .report }
                        }
                        Spacer(minLength: 0)
                        Text("Students see this booking with Return only. These actions appear because \(staff?.shortName ?? "you") \(staff == nil ? "are" : "is") staff.")
                            .font(KioskType.meta)
                            .foregroundStyle(KioskText.muted)
                    }
                    .padding(.leading, 28)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    .overlay(alignment: .leading) { Rectangle().fill(KioskStroke.divider).frame(width: 1) }
                }
                .padding(.horizontal, 28)
                .padding(.top, 24)
                .padding(.bottom, 28)
            }
            .frame(width: 1060, height: 700)
            .kioskCard(KioskSurface.sheet, radius: KioskRadius.modal, stroke: KioskStroke.standard)
            .clipShape(RoundedRectangle(cornerRadius: KioskRadius.modal))
        }
    }

    private var firstName: String {
        context.requesterName.split(separator: " ").first.map(String.init) ?? context.requesterName
    }

    private var statusLine: String {
        guard context.isOverdue else { return KioskDueCopy.due(context.endsAt).uppercased() }
        let days = Calendar.current.dateComponents([.day], from: context.endsAt, to: Date()).day ?? 0
        return days >= 1 ? "OVERDUE · \(days) DAY\(days == 1 ? "" : "S")" : "OVERDUE"
    }

    private func actionRow(_ title: String, _ detail: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 14) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.system(size: 17, weight: .bold)).foregroundStyle(KioskText.primary)
                    Text(detail).font(KioskType.meta).foregroundStyle(KioskText.tertiary)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(KioskText.muted)
            }
            .padding(.horizontal, 16)
            .frame(minHeight: 64)
            .background(KioskSurface.cardRaised, in: RoundedRectangle(cornerRadius: KioskRadius.lg))
            .overlay(RoundedRectangle(cornerRadius: KioskRadius.lg).stroke(KioskStroke.standard, lineWidth: 1))
            .contentShape(RoundedRectangle(cornerRadius: KioskRadius.lg))
        }
        .buttonStyle(.plain)
    }

    private func load() async {
        loadError = nil
        do {
            async let loadedRoster = KioskAPI.shared.kioskUsers()
            async let loadedDetail = KioskAPI.shared.kioskCheckoutDetail(id: context.checkoutId)
            roster = try await loadedRoster
            detail = try? await loadedDetail
            #if DEBUG
            if KioskFixtureScenario.active == .changesStaff, staff == nil,
               let first = roster.first(where: \.canManageAnyCheckout) {
                staff = first
                step = .actions
            }
            #endif
        } catch {
            loadError = (error as? APIError)?.errorDescription ?? "Couldn't load the roster."
        }
    }
}

extension KioskIntentBooking: Identifiable {}
