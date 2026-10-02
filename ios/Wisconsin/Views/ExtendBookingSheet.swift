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

    private var dueOverline: String {
        let relative = RelativeDateTimeFormatter()
        relative.unitsStyle = .full
        let text = relative.localizedString(for: currentEndsAt, relativeTo: Date())
        return currentEndsAt < Date() ? "OVERDUE · \(text.uppercased())" : "DUE \(text.uppercased())"
    }

    private func neededNextCard(_ needAt: Date) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "clock.badge.exclamationmark")
                .font(.title3)
                .foregroundStyle(Color.statusText(.orange))
            VStack(alignment: .leading, spacing: 2) {
                Text("NEEDED NEXT")
                    .font(.caption2.weight(.bold))
                    .tracking(0.8)
                    .foregroundStyle(.secondary)
                Text(dayTime(needAt))
                    .font(.headline)
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.statusBackground(.orange), in: RoundedRectangle(cornerRadius: 14))
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
                    VStack(alignment: .leading, spacing: 4) {
                        Text(dueOverline)
                            .font(.caption2.weight(.bold))
                            .tracking(0.8)
                            .foregroundStyle(currentEndsAt < Date() ? Color.statusText(.red) : Color.statusText(.blue))
                        Text(booking.title)
                            .font(.title.weight(.heavy))
                            .lineLimit(2)
                        Text("\(booking.requester.name) · ends \(dayTime(currentEndsAt))")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }

                    if let latestEndsAt, latestEndsAt > currentEndsAt {
                        Text("Can go until \(dayTime(latestEndsAt))")
                            .font(.title3.weight(.heavy))
                            .padding(.top, 6)
                        if let nextNeedAt {
                            neededNextCard(nextNeedAt)
                        }
                    } else if nextNeedAt != nil {
                        Text("This can't be extended")
                            .font(.title3.weight(.heavy))
                            .foregroundStyle(Color.statusText(.red))
                            .padding(.top, 6)
                        if let nextNeedAt { neededNextCard(nextNeedAt) }
                    } else {
                        Text("Nothing else needs this gear, so pick any time.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .padding(.top, 6)
                    }

                    sectionHeading("Extend until")
                    DayTimeChipPicker(selection: $newEndsAt, minimum: currentEndsAt, latest: latestEndsAt)

                    if hasChanges {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("NEW DUE TIME")
                                .font(.caption2.weight(.bold))
                                .tracking(0.8)
                                .foregroundStyle(.secondary)
                            Text(dayTime(newEndsAt))
                                .font(.title2.weight(.heavy))
                            Text(moreTime)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                            if exceedsLimit, let latestEndsAt {
                                Label("Gear is needed again then. Latest is \(dayTime(latestEndsAt)).", systemImage: "exclamationmark.triangle.fill")
                                    .font(.footnote)
                                    .foregroundStyle(Color.statusText(.red))
                                    .padding(.top, 4)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(16)
                        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
                        .accessibilityElement(children: .combine)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 24)
                .disabled(isLoading)
            }
            .background(Color(.systemGroupedBackground))
            .safeAreaInset(edge: .bottom) {
                Button {
                    Task { await extend() }
                } label: {
                    Group {
                        if isLoading {
                            ProgressView()
                        } else {
                            Text(canSubmit ? "Extend to \(dayTime(newEndsAt))" : "Pick a new time")
                        }
                    }
                    .font(.headline)
                    .frame(maxWidth: .infinity, minHeight: 56)
                }
                .buttonStyle(.plain)
                .foregroundStyle(canSubmit ? Color.white : Color.secondary)
                .background(
                    canSubmit ? Color.statusText(.blue) : Color(.tertiarySystemFill),
                    in: RoundedRectangle(cornerRadius: 16)
                )
                .disabled(!canSubmit || isLoading)
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
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await extend() }
                    } label: {
                        if isLoading {
                            ProgressView().controlSize(.small)
                        } else {
                            Text("Extend").fontWeight(.semibold)
                        }
                    }
                    .disabled(!canSubmit || isLoading)
                    .accessibilityLabel(isLoading ? "Extending booking" : "Extend booking")
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

    /// "+2 days 3 hours" style gap between the current and new end.
    private var moreTime: String {
        let parts = calendar.dateComponents([.day, .hour, .minute], from: currentEndsAt, to: newEndsAt)
        var out: [String] = []
        if let d = parts.day, d > 0 { out.append("\(d) day\(d == 1 ? "" : "s")") }
        if let h = parts.hour, h > 0 { out.append("\(h) hour\(h == 1 ? "" : "s")") }
        if let m = parts.minute, m > 0, parts.day == 0 { out.append("\(m) min") }
        return out.isEmpty ? "No extra time" : "+" + out.joined(separator: " ") + " more"
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
