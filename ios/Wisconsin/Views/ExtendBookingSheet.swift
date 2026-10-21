import SwiftUI

/// One decision: when the gear comes back now. The top compares the current
/// return with the new one, a short list offers the usual answers, and the
/// calendar is there for anything else. The latest choice always stops before
/// the next booking that needs this gear.
struct ExtendBookingSheet: View {
    let booking: Booking
    let onSuccess: (Booking) -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.today) private var today
    @State private var newEndsAt: Date
    @State private var choice: ReturnChoice?
    @State private var isLoading = false
    @State private var error: String?
    @State private var showDiscardConfirm = false
    @State private var insight: CheckoutReturnInsight?
    /// The pre-selected choice isn't an edit; only a tap is.
    @State private var didPick = false

    init(booking: Booking, onSuccess: @escaping (Booking) -> Void) {
        self.booking = booking
        self.onSuccess = onSuccess
        _newEndsAt = State(initialValue: booking.endsAt)
    }

    private var currentEndsAt: Date { booking.endsAt }
    private var calendar: Calendar { .current }
    private var nextNeedAt: Date? { insight?.nextNeedAt }
    private var isCheckingNextNeed: Bool { insight == nil }

    /// Latest end that leaves a 30-minute grace before another booking needs
    /// the gear, floored to the quarter hour. Same rule as the kiosk.
    private var latestEndsAt: Date? {
        guard let nextNeedAt else { return nil }
        let latest = nextNeedAt.addingTimeInterval(-30 * 60)
        let step = TimeInterval(QuarterHour.minuteInterval * 60)
        let floored = floor(latest.timeIntervalSinceReferenceDate / step) * step
        return Date(timeIntervalSinceReferenceDate: floored)
    }

    /// Extensions count from now when the booking is already late.
    private var base: Date { max(currentEndsAt, Date()) }

    private var earliestCustom: Date { QuarterHour.roundedUp(base.addingTimeInterval(15 * 60)) }

    private var canExtendAtAll: Bool {
        guard let latestEndsAt else { return true }
        return latestEndsAt >= earliestCustom
    }

    private var exceedsLimit: Bool {
        guard let latestEndsAt else { return false }
        return newEndsAt > latestEndsAt
    }

    private var hasNewReturn: Bool { choice != nil && newEndsAt > currentEndsAt }

    private var hasChanges: Bool { didPick && hasNewReturn }

    private var canSubmit: Bool { hasNewReturn && !exceedsLimit && !isCheckingNextNeed }

    private func label(_ date: Date, lowercased: Bool = false) -> String {
        date.operationalDateTimeLabel(now: today, capitalizesRelativeDay: !lowercased)
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    comparison
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 4, leading: 4, bottom: 8, trailing: 4))

                if isCheckingNextNeed {
                    Section {
                        HStack(spacing: Brand.Space.sm) {
                            ProgressView()
                            Text("Checking what's booked next…")
                                .foregroundStyle(.secondary)
                        }
                        .frame(minHeight: 44)
                    }
                } else if !canExtendAtAll {
                    Section {
                        Label {
                            Text(cannotExtendMessage)
                                .fixedSize(horizontal: false, vertical: true)
                        } icon: {
                            Image(systemName: "calendar.badge.exclamationmark")
                        }
                        .foregroundStyle(Color.statusText(.orange))
                    }
                } else {
                    Section {
                        ForEach(options) { option in
                            optionRow(option)
                        }
                        customRow
                        if choice == .custom {
                            ReturnTimeCalendar(
                                selection: $newEndsAt,
                                minimum: earliestCustom,
                                latest: latestEndsAt
                            )
                        }
                    } header: {
                        Text("New return")
                    } footer: {
                        Text(limitFooter)
                    }
                }
            }
            .listStyle(.insetGrouped)
            .listSectionSpacing(Brand.Space.md)
            .disabled(isLoading)
            .safeAreaInset(edge: .bottom) {
                Button {
                    Task { await extend() }
                } label: {
                    Group {
                        if isLoading {
                            ProgressView()
                        } else {
                            Text(canSubmit ? "Extend to \(label(newEndsAt, lowercased: true))" : "Choose a new return")
                                .font(.body.weight(.semibold))
                                .lineLimit(1)
                                .minimumScaleFactor(0.8)
                        }
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .buttonBorderShape(.capsule)
                .controlSize(.large)
                .tint(.green)
                .disabled(!canSubmit || isLoading)
                .accessibilityLabel(isLoading ? "Extending booking" : "Extend booking")
                .padding(.horizontal, Brand.Space.md)
                .padding(.vertical, 10)
                .background(.bar)
            }
            .safeAreaInset(edge: .top) {
                if let error {
                    ActionErrorBanner(title: "Couldn't extend booking", message: error) {
                        self.error = nil
                    }
                }
            }
            .task { await loadInsight() }
            .navigationTitle("Extend Return")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        if isLoading { return }
                        if hasChanges {
                            showDiscardConfirm = true
                        } else {
                            dismiss()
                        }
                    }
                    .disabled(isLoading)
                }
            }
            .interactiveDismissDisabled(isLoading || hasChanges)
            .confirmationDialog(
                "Discard changes?",
                isPresented: $showDiscardConfirm,
                titleVisibility: .visible
            ) {
                Button("Discard", role: .destructive) { dismiss() }
                Button("Keep Editing", role: .cancel) {}
            } message: {
                Text("Your changes will be lost.")
            }
        }
    }

    // MARK: Comparison

    /// Current return on the left, the new one on the right, like a
    /// before-and-after. Red only marks a return that's already late.
    private var comparison: some View {
        VStack(alignment: .leading, spacing: Brand.Space.sm) {
            Text(booking.title)
                .font(.gothamBold(size: 22))
                .lineLimit(2)
                .accessibilityAddTraits(.isHeader)
            HStack(alignment: .top) {
                endpoint(
                    label: currentEndsAt < Date() ? "Was due" : "Due back",
                    date: currentEndsAt,
                    color: currentEndsAt < Date() ? Color.statusText(.red) : .secondary,
                    alignment: .leading
                )
                Spacer(minLength: Brand.Space.sm)
                Image(systemName: "arrow.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.tertiary)
                    .padding(.top, 22)
                    .accessibilityHidden(true)
                Spacer(minLength: Brand.Space.sm)
                if hasNewReturn {
                    endpoint(label: moreTime, date: newEndsAt, color: .primary, alignment: .trailing)
                        .transition(.opacity)
                } else {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text("New return").font(.footnote).foregroundStyle(.secondary)
                        Text("Pick below").font(.subheadline).foregroundStyle(.tertiary)
                        Text("—").font(.title3.weight(.semibold)).foregroundStyle(.tertiary)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
            .padding(Brand.Space.md)
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .animation(.easeInOut(duration: 0.2), value: newEndsAt)
    }

    private func endpoint(label: String, date: Date, color: Color, alignment: HorizontalAlignment) -> some View {
        VStack(alignment: alignment, spacing: 2) {
            Text(label)
                .font(.footnote)
                .foregroundStyle(color == .primary ? Color.secondary : color)
            Text(date.operationalDayLabel(now: today))
                .font(.subheadline)
                .foregroundStyle(color)
            Text(date.gearTime)
                .font(.title3.weight(.semibold).monospacedDigit())
                .foregroundStyle(color)
                .contentTransition(.numericText())
        }
        .multilineTextAlignment(alignment == .leading ? .leading : .trailing)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(label), \(self.label(date))")
    }

    // MARK: Choices

    private enum ReturnChoice: Hashable {
        case option(ReturnOption.Kind)
        case custom
    }

    private struct ReturnOption: Identifiable {
        enum Kind: Hashable { case moreHours, tonight, tomorrow, latest }
        let kind: Kind
        let title: String
        let date: Date
        var id: Kind { kind }
    }

    /// The usual answers, earliest first. Anything past the next booking's
    /// limit is left out rather than shown disabled.
    private var options: [ReturnOption] {
        let now = Date()
        var out: [ReturnOption] = []
        out.append(ReturnOption(kind: .moreHours, title: "2 more hours", date: QuarterHour.roundedUp(base.addingTimeInterval(2 * 60 * 60))))
        if let tonight = calendar.date(bySettingHour: 22, minute: 0, second: 0, of: now),
           tonight > base.addingTimeInterval(3 * 60 * 60) {
            out.append(ReturnOption(kind: .tonight, title: "Tonight", date: tonight))
        }
        let endTime = calendar.dateComponents([.hour, .minute], from: currentEndsAt)
        let hour = (8...22).contains(endTime.hour ?? 17) ? (endTime.hour ?? 17) : 17
        let minute = hour == endTime.hour ? (endTime.minute ?? 0) : 0
        if let tomorrowDay = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: now)),
           let tomorrow = calendar.date(bySettingHour: hour, minute: minute, second: 0, of: tomorrowDay) {
            out.append(ReturnOption(kind: .tomorrow, title: "Tomorrow", date: QuarterHour.roundedUp(tomorrow)))
        }
        var valid = out.filter { option in option.date > base && (latestEndsAt.map { option.date <= $0 } ?? true) }
        if let latestEndsAt, latestEndsAt >= earliestCustom {
            valid.removeAll { $0.date == latestEndsAt }
            valid.append(ReturnOption(kind: .latest, title: "As late as possible", date: latestEndsAt))
        }
        return valid.sorted { $0.date < $1.date }
    }

    private func optionRow(_ option: ReturnOption) -> some View {
        choiceRow(
            title: option.title,
            detail: label(option.date),
            isSelected: choice == .option(option.kind)
        ) {
            choice = .option(option.kind)
            newEndsAt = option.date
        }
    }

    private var customRow: some View {
        choiceRow(
            title: "Another time",
            detail: choice == .custom ? label(newEndsAt) : "Pick a day and time",
            isSelected: choice == .custom
        ) {
            if choice != .custom {
                choice = .custom
                newEndsAt = min(max(newEndsAt, earliestCustom), latestEndsAt ?? .distantFuture)
            }
        }
    }

    private func choiceRow(title: String, detail: String, isSelected: Bool, action: @escaping () -> Void) -> some View {
        Button {
            withAnimation(.easeInOut(duration: 0.2)) { action() }
            didPick = true
            Haptics.selection()
        } label: {
            HStack(spacing: Brand.Space.sm) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .foregroundStyle(.primary)
                    Text(detail)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                if isSelected {
                    Image(systemName: "checkmark")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(Color.statusText(.blue))
                        .accessibilityHidden(true)
                }
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
    }

    private var nextNeedName: String {
        insight?.nextNeedTitle ?? "Another booking"
    }

    private var limitFooter: String {
        guard let nextNeedAt, let latestEndsAt else {
            return "Nothing else is booked on this gear afterward."
        }
        return "\(nextNeedName) needs this gear \(label(nextNeedAt, lowercased: true)), so the latest return is \(label(latestEndsAt, lowercased: true))."
    }

    private var cannotExtendMessage: String {
        guard let nextNeedAt else { return "This can't be extended." }
        return "This can't be extended. \(nextNeedName) needs this gear \(label(nextNeedAt, lowercased: true))."
    }

    /// "2 days 3 hours more" style gap between the current and new end.
    private var moreTime: String {
        let parts = calendar.dateComponents([.day, .hour, .minute], from: currentEndsAt, to: newEndsAt)
        var out: [String] = []
        if let d = parts.day, d > 0 { out.append("\(d) day\(d == 1 ? "" : "s")") }
        if let h = parts.hour, h > 0 { out.append("\(h) hr") }
        if let m = parts.minute, m > 0, parts.day == 0 { out.append("\(m) min") }
        return out.isEmpty ? "New return" : "+" + out.joined(separator: " ")
    }

    // MARK: Loading and saving

    /// Pre-selects the most common answer, the same time tomorrow, so one tap
    /// on the green button is enough when that's what's needed.
    private func loadInsight() async {
        let loaded = await APIClient.shared.checkoutReturnInsight(for: booking)
        insight = loaded
        guard choice == nil, canExtendAtAll else { return }
        let preferred = options.first { $0.kind == .tomorrow } ?? options.first
        if let preferred {
            choice = .option(preferred.kind)
            newEndsAt = preferred.date
        }
    }

    private func extend() async {
        if isLoading { return }
        isLoading = true
        error = nil
        do {
            let updatedBooking = try await APIClient.shared.extendBooking(
                id: booking.id,
                endsAt: newEndsAt,
                updatedAt: booking.updatedAt
            )
            onSuccess(updatedBooking)
            Haptics.success()
            dismiss()
        } catch {
            self.error = error.localizedDescription
            Haptics.warning()
        }
        isLoading = false
    }
}
