import SwiftUI

/// The parked reservation, shown in the tab bar's bottom accessory while the
/// composer is minimized. Tapping reopens it; the close control routes back
/// through the same keep-or-discard choice the sheet uses, so a draft can never
/// disappear on a single stray tap.
struct ReservationDraftCard: View {
    let title: String
    let subtitle: String
    let isBusy: Bool
    let onOpen: () -> Void
    let onClose: () -> Void

    @Environment(\.tabViewBottomAccessoryPlacement) private var placement

    private var isInline: Bool { placement == .inline }

    var body: some View {
        HStack(spacing: Brand.Space.sm) {
            Button(action: onOpen) {
                HStack(spacing: Brand.Space.sm) {
                    Image(systemName: "calendar.badge.plus")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Color.statusText(.purple))
                    VStack(alignment: .leading, spacing: 1) {
                        Text(title)
                            .font(.subheadline.weight(.semibold))
                            .lineLimit(1)
                        if !isInline, !subtitle.isEmpty {
                            Text(subtitle)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }
                    Spacer(minLength: 0)
                    if isBusy {
                        ProgressView()
                            .controlSize(.small)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Reservation in progress, \(title)")
            .accessibilityHint("Opens the reservation you were working on")

            Button(action: onClose) {
                Image(systemName: "xmark")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Close reservation draft")
        }
        .padding(.horizontal, Brand.Space.md)
    }
}
