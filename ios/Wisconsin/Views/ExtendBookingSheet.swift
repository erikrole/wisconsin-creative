import SwiftUI

struct ExtendBookingSheet: View {
    let booking: Booking
    let onSuccess: (Booking) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var newEndsAt: Date
    @State private var isLoading = false
    @State private var error: String?
    @State private var showDiscardConfirm = false
    @State private var nextNeedAt: Date?
    @Environment(\.colorSchemeContrast) private var colorSchemeContrast

    init(booking: Booking, onSuccess: @escaping (Booking) -> Void) {
        self.booking = booking
        self.onSuccess = onSuccess
        _newEndsAt = State(initialValue: booking.endsAt)
    }

    private var currentEndsAt: Date { booking.endsAt }

    private var calendar: Calendar { .current }

    /// Latest end that leaves a 30-minute grace before another booking needs
    /// the gear, floored to the quarter hour. Same rule as the kiosk.
    private var latestEndsAt: Date? {
        guard let nextNeedAt else { return nil }
        let latest = nextNeedAt.addingTimeInterval(-30 * 60)
        let step = TimeInterval(QuarterHour.minuteInterval * 60)
        let floored = floor(latest.timeIntervalSinceReferenceDate / step) * step
        return Date(timeIntervalSinceReferenceDate: floored)
    }

    private var exceedsLimit: Bool {
        guard let latestEndsAt else { return false }
        return newEndsAt > latestEndsAt
    }

    /// The day the chips treat as picked: the new end once the user has moved
    /// it, otherwise the booking's current end day.
    private var canSubmit: Bool { hasChanges && !exceedsLimit }

    private var hasChanges: Bool { newEndsAt > currentEndsAt }

    private func dayTime(_ date: Date) -> String {
        chipDayTime(date)
    }

    private var isOverdue: Bool { currentEndsAt < Date() }

    /// The current due time, said once: "Due back today at 3:30 AM", or
    /// "Overdue · was due yesterday at 6:00 PM".
    private var stateLine: String {
        let when = currentEndsAt.operationalDateTimeLabel(capitalizesRelativeDay: false)
        return isOverdue ? "Overdue · was due \(when)" : "Due back \(when)"
    }

    /// One card for the one constraint: when the gear is needed next and,
    /// from that, the latest this booking can run.
    @ViewBuilder
    private var limitCard: some View {
        if let nextNeedAt {
            let canExtend = (latestEndsAt ?? currentEndsAt) > currentEndsAt
            let tone: StatusTone = canExtend ? .orange : .red
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "clock.badge.exclamationmark")
                    .font(.title3)
                    .foregroundStyle(Color.statusText(tone))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Needed again \(nextNeedAt.operationalDateTimeLabel(capitalizesRelativeDay: false))")
                        .font(.subheadline.weight(.semibold))
                    if canExtend, let latestEndsAt {
                        Text("Extend until \(latestEndsAt.operationalDateTimeLabel(capitalizesRelativeDay: false)) at the latest.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    } else {
                        Text("This can't be extended.")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(Color.statusText(.red))
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.statusBackground(tone), in: RoundedRectangle(cornerRadius: Brand.Radius.md, style: .continuous))
            .accessibilityElement(children: .combine)
        } else {
            Text("Nothing else needs this gear, so pick any time.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
    }

    private func sectionHeading(_ text: String) -> some View {
        Text(text)
            .font(.title3.weight(.heavy))
            .padding(.top, 4)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    // Same header as Booking detail: title, who, and state.
                    VStack(alignment: .leading, spacing: 3) {
                        Text(booking.title)
                            .font(.gothamBold(size: 24))
                            .lineLimit(2)
                        Text(booking.requester.name)
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(.secondary)
                        Text(stateLine)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Color.statusText(isOverdue ? .red : .blue))
                    }

                    limitCard

                    sectionHeading("Extend until")
                    DayTimeChipPicker(selection: $newEndsAt, minimum: currentEndsAt, latest: latestEndsAt)

                    // The new time itself is on the button below; this line
                    // only says what it buys, or why it can't be had.
                    if hasChanges {
                        if exceedsLimit, let latestEndsAt {
                            Label("Gear is needed again then. Latest is \(dayTime(latestEndsAt)).", systemImage: "exclamationmark.triangle.fill")
                                .font(.footnote.weight(.semibold))
                                .foregroundStyle(Color.statusText(.red))
                        } else {
                            Label(moreTime, systemImage: "plus.circle.fill")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(Color.statusText(.blue))
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 24)
                .disabled(isLoading)
            }
            .background(Color(.systemGroupedBackground))
            .safeAreaInset(edge: .bottom) {
                extendButton
                    .padding(.horizontal, 16)
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
            .task { nextNeedAt = await APIClient.shared.checkoutReturnInsight(for: booking).nextNeedAt }
            .navigationTitle("Extend Booking")
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

    /// The filled capsule Booking detail uses, once there is a time to
    /// extend to. Before that, a plain outlined prompt that stays legible --
    /// a disabled filled button fades to near-invisible.
    @ViewBuilder
    private var extendButton: some View {
        if canSubmit || isLoading {
            Button {
                Task { await extend() }
            } label: {
                Group {
                    if isLoading {
                        ProgressView()
                    } else {
                        Text("Extend to \(dayTime(newEndsAt))")
                    }
                }
                .font(.headline)
                .frame(maxWidth: .infinity)
                .foregroundStyle(Color.statusControlForeground(.blue, contrast: colorSchemeContrast))
            }
            .buttonStyle(.borderedProminent)
            .buttonBorderShape(.capsule)
            .controlSize(.large)
            .tint(Color.statusText(.blue))
            .disabled(isLoading)
            .accessibilityLabel(isLoading ? "Extending booking" : "Extend booking")
        } else {
            Text(exceedsLimit ? "Pick an earlier time" : "Pick a new time")
                .font(.headline)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, minHeight: 50)
                .background(Color(.tertiarySystemFill), in: Capsule())
                .accessibilityAddTraits(.isStaticText)
        }
    }

    /// "+2 days 3 hours" style gap between the current and new end.
    private var moreTime: String {
        let parts = calendar.dateComponents([.day, .hour, .minute], from: currentEndsAt, to: newEndsAt)
        var out: [String] = []
        if let d = parts.day, d > 0 { out.append("\(d) day\(d == 1 ? "" : "s")") }
        if let h = parts.hour, h > 0 { out.append("\(h) hour\(h == 1 ? "" : "s")") }
        if let m = parts.minute, m > 0, parts.day == 0 { out.append("\(m) min") }
        return out.isEmpty ? "No extra time" : out.joined(separator: " ") + " more"
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
