import SwiftUI

struct ExtendBookingSheet: View {
    let booking: Booking
    let onSuccess: (Booking) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var newEndsAt: Date
    @State private var isLoading = false
    @State private var error: String?
    @State private var showDiscardConfirm = false

    init(booking: Booking, onSuccess: @escaping (Booking) -> Void) {
        self.booking = booking
        self.onSuccess = onSuccess
        _newEndsAt = State(initialValue: booking.endsAt)
    }

    private var currentEndsAt: Date { booking.endsAt }

    /// Web parity: +1 day / +3 days / +1 week chips on `BookingDetailPage`.
    private static let quickPresets: [(label: String, days: Int)] = [
        ("+1 day", 1),
        ("+3 days", 3),
        ("+1 week", 7),
    ]

    private var hasChanges: Bool { newEndsAt > currentEndsAt }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    LabeledContent("Current End") {
                        Text(currentEndsAt.formatted(date: .abbreviated, time: .shortened))
                            .font(.callout.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                }

                Section("Quick Extend") {
                    HStack(spacing: 8) {
                        ForEach(Self.quickPresets, id: \.days) { preset in
                            Button {
                                applyPreset(days: preset.days)
                            } label: {
                                Text(preset.label)
                                    .font(.footnote.weight(.medium))
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 8)
                            }
                            .buttonStyle(.bordered)
                            .tint(Color.statusText(.blue))
                            .controlSize(.regular)
                            .disabled(isLoading)
                            .accessibilityLabel(presetAccessibilityLabel(preset))
                        }
                    }
                    .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
                }

                Section("New End Date & Time") {
                    DatePicker(
                        "Ends At",
                        selection: $newEndsAt,
                        in: currentEndsAt...,
                        displayedComponents: [.date, .hourAndMinute]
                    )
                    .datePickerStyle(.graphical)
                    .disabled(isLoading)
                }

                if let error {
                    Section {
                        Text(error)
                            .foregroundStyle(Color.statusText(.red))
                            .font(.footnote)
                    }
                }
            }
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
                    .disabled(!hasChanges || isLoading)
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

    /// Offset from the current picker value if the user has already nudged it,
    /// otherwise from the booking's current end. Mirrors web's `handleQuickExtend`.
    private func applyPreset(days: Int) {
        let base = newEndsAt > currentEndsAt ? newEndsAt : currentEndsAt
        if let next = Calendar.current.date(byAdding: .day, value: days, to: base) {
            newEndsAt = next
        }
    }

    /// Builds the VoiceOver label for a preset chip including the resulting
    /// end date. Computes off the same base as `applyPreset(days:)` so it
    /// stays accurate after the user has already nudged.
    private func presetAccessibilityLabel(_ preset: (label: String, days: Int)) -> String {
        let base = newEndsAt > currentEndsAt ? newEndsAt : currentEndsAt
        guard let resulting = Calendar.current.date(byAdding: .day, value: preset.days, to: base) else {
            return "Extend by \(preset.label)"
        }
        let formatted = resulting.formatted(date: .abbreviated, time: .shortened)
        return "Extend by \(preset.label.replacingOccurrences(of: "+", with: "")), to \(formatted)"
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
