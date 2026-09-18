import SwiftUI

struct BookingAssetThumbnail: View {
    let imageUrl: String?
    var size: CGFloat = 44
    var cornerRadius: CGFloat = 8

    var body: some View {
        Group {
            if let urlString = imageUrl, let url = URL(string: urlString) {
                ZStack {
                    assetPlaceholder
                    CachedThumbnail(url: url, size: size)
                }
                .frame(width: size, height: size)
                .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
                .overlay(RoundedRectangle(cornerRadius: cornerRadius).strokeBorder(Color(.separator), lineWidth: 1))
            } else {
                assetPlaceholder
                    .frame(width: size, height: size)
            }
        }
        .accessibilityHidden(true)
    }

    private var assetPlaceholder: some View {
        RoundedRectangle(cornerRadius: cornerRadius)
            .fill(Color(.systemGray5))
            .overlay(
                Image(systemName: "bag")
                    .foregroundStyle(Color(.systemGray2))
            )
    }
}

struct BookingBulkThumbnail: View {
    let imageUrl: String?
    var size: CGFloat = 44
    var cornerRadius: CGFloat = 10

    var body: some View {
        Group {
            if let urlString = imageUrl, let url = URL(string: urlString) {
                ZStack {
                    bulkPlaceholder
                    CachedThumbnail(url: url, size: size)
                }
                .frame(width: size, height: size)
                .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
                .overlay(RoundedRectangle(cornerRadius: cornerRadius).strokeBorder(Color(.separator), lineWidth: 1))
            } else {
                bulkPlaceholder
                    .frame(width: size, height: size)
            }
        }
        .accessibilityHidden(true)
    }

    private var bulkPlaceholder: some View {
        Image(systemName: "shippingbox")
            .foregroundStyle(.secondary)
            .frame(width: size, height: size)
            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: cornerRadius))
    }
}

struct SelectedEquipmentRow: View {
    let asset: Asset
    let isConflicted: Bool
    var conflictMessage: String?
    var availabilityTone: StatusTone = .red
    var isAtPickupLocation = true
    var upcomingCommitmentLabel: String?
    var upcomingTone: StatusTone = .purple
    var turnaroundMessage: String?
    var turnaroundIsCritical = false
    let onRemove: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            BookingAssetThumbnail(imageUrl: asset.imageUrl, size: 40, cornerRadius: 8)

            VStack(alignment: .leading, spacing: 3) {
                Text(asset.itemListPrimaryTitle)
                    .font(.gothamBold(size: 16))
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                if let subtitle = asset.itemListSecondaryTitle {
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                if isConflicted {
                    BookingAdvisoryLabel(
                        text: conflictMessage ?? "Scheduling conflict",
                        systemImage: "exclamationmark.triangle.fill",
                        tone: Color.statusText(availabilityTone)
                    )
                }
                if !isAtPickupLocation {
                    BookingAdvisoryLabel(
                        text: "At \(asset.location.name)",
                        systemImage: "mappin.and.ellipse",
                        tone: Color.statusText(.orange)
                    )
                }
                if let upcomingCommitmentLabel {
                    BookingAdvisoryLabel(
                        text: upcomingCommitmentLabel,
                        systemImage: "clock.arrow.circlepath",
                        tone: Color.statusText(upcomingTone)
                    )
                }
                if let turnaroundMessage {
                    BookingAdvisoryLabel(
                        text: turnaroundMessage,
                        systemImage: "exclamationmark.triangle.fill",
                        tone: Color.statusText(turnaroundIsCritical ? .red : .orange)
                    )
                }
            }
            Spacer()
            Button(action: onRemove) {
                Image(systemName: "xmark.circle.fill")
                    .font(.title3)
                    .foregroundStyle(Color.statusText(.red))
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel)
    }

    private var accessibilityLabel: String {
        var parts: [String] = ["Selected", asset.itemListPrimaryTitle]
        if let subtitle = asset.itemListSecondaryTitle { parts.append(subtitle) }
        if isConflicted { parts.append(conflictMessage ?? "Scheduling conflict") }
        if !isAtPickupLocation { parts.append("At another pickup location") }
        if let upcomingCommitmentLabel { parts.append(upcomingCommitmentLabel) }
        if let turnaroundMessage { parts.append(turnaroundMessage) }
        parts.append("Remove button")
        return parts.joined(separator: ", ")
    }
}

/// Compact native stepper that keeps the selected count visible.
/// SwiftUI's `.labelsHidden()` hides a Stepper label, so the count has to
/// live beside the control instead of inside it.
struct ReservationQuantityStepper: View {
    let value: Int
    let range: ClosedRange<Int>
    let label: String
    let onIncrement: () -> Void
    let onDecrement: () -> Void

    var body: some View {
        HStack(spacing: 6) {
            Text("\(value)")
                .font(.subheadline.weight(.semibold).monospacedDigit())
                .frame(minWidth: 22, alignment: .center)
                .contentTransition(.numericText())
                .accessibilityHidden(true)
            Stepper(
                value: Binding(
                    get: { value },
                    set: { newValue in
                        if newValue > value { onIncrement() }
                        else if newValue < value { onDecrement() }
                    }
                ),
                in: range
            ) {
                EmptyView()
            }
            .labelsHidden()
            .fixedSize()
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(label)
        .accessibilityValue("\(value) selected")
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: onIncrement()
            case .decrement: onDecrement()
            default: break
            }
        }
    }
}

struct BulkQuantityRow: View {
    let sku: FormBulkSku
    let quantity: Int
    var locationName: String? = nil
    var isAtPickupLocation = true
    var turnaroundMessage: String?
    var turnaroundIsCritical = false
    let onDecrement: () -> Void
    let onIncrement: () -> Void

    private var stepperRange: ClosedRange<Int> {
        isAtPickupLocation ? 0...sku.availableQuantity : 0...quantity
    }
    private var unitLabel: String {
        sku.unit?.isEmpty == false ? " \(sku.unit!)" : ""
    }
    private var subtitle: String {
        let pickup = sku.trackByNumber ? " · units scan at pickup" : ""
        return "\(sku.availableQuantity)/\(sku.currentQuantity) available\(unitLabel)\(pickup)"
    }

    var body: some View {
        HStack(spacing: 12) {
            BookingBulkThumbnail(imageUrl: sku.imageUrl)

            VStack(alignment: .leading, spacing: 3) {
                Text(sku.name)
                    .font(.gothamBold(size: 16))
                    .lineLimit(1)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                if !isAtPickupLocation, let locationName {
                    Label("At \(locationName)", systemImage: "mappin.and.ellipse")
                        .font(.caption2)
                        .foregroundStyle(Color.statusText(.orange))
                }
                if let turnaroundMessage {
                    Label(turnaroundMessage, systemImage: "exclamationmark.triangle.fill")
                        .font(.caption2)
                        .foregroundStyle(Color.statusText(turnaroundIsCritical ? .red : .orange))
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            Spacer()

            ReservationQuantityStepper(
                value: quantity,
                range: stepperRange,
                label: "\(sku.name) quantity",
                onIncrement: onIncrement,
                onDecrement: onDecrement
            )
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel)
    }

    private var accessibilityLabel: String {
        var parts = [sku.name, subtitle, "\(quantity) selected"]
        if let turnaroundMessage { parts.append(turnaroundMessage) }
        return parts.joined(separator: ", ")
    }
}

struct AssetPickerRow: View {
    let asset: Asset
    let isSelected: Bool
    var isConflicted: Bool = false
    var conflictMessage: String?
    var conflictDetail: String?
    var conflictTone: StatusTone = .red
    var isAtPickupLocation = true
    var upcomingCommitmentLabel: String?
    var upcomingTone: StatusTone = .purple
    var turnaroundMessage: String?
    var turnaroundIsCritical = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: 12) {
            BookingAssetThumbnail(imageUrl: asset.imageUrl)

            VStack(alignment: .leading, spacing: 3) {
                Text(asset.itemListPrimaryTitle)
                    .font(.gothamBold(size: 16))
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                if isConflicted {
                    if let conflictDetail {
                        Text(conflictDetail)
                            .font(.caption.weight(.medium))
                            .foregroundStyle(Color.statusText(conflictTone))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                } else if !isAtPickupLocation {
                    Label("Choose \(asset.location.name) pickup to add", systemImage: "mappin.and.ellipse")
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(Color.statusText(.orange))
                        .fixedSize(horizontal: false, vertical: true)
                } else if let upcomingCommitmentLabel {
                    Text(upcomingCommitmentLabel)
                        .font(.caption.weight(.medium))
                        .foregroundStyle(Color.statusText(upcomingTone))
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let turnaroundMessage, !isConflicted {
                    BookingAdvisoryLabel(
                        text: turnaroundMessage,
                        systemImage: "exclamationmark.triangle.fill",
                        tone: Color.statusText(turnaroundIsCritical ? .red : .orange)
                    )
                }
            }

            Spacer(minLength: 8)

            trailingIndicator
        }
        .contentShape(Rectangle())
        .opacity((!isAtPickupLocation && !isConflicted && !isSelected) ? 0.48 : 1)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(rowAccessibilityLabel)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    @ViewBuilder
    private var trailingIndicator: some View {
        Image(systemName: indicatorSystemImage)
            .font(.title3)
            .foregroundStyle(indicatorColor)
            .symbolEffect(.bounce, options: .nonRepeating, isActive: !reduceMotion && isSelected)
            .accessibilityHidden(true)
    }

    private var indicatorSystemImage: String {
        if isSelected { return "checkmark.circle.fill" }
        if isConflicted { return "exclamationmark.triangle.fill" }
        if !isAtPickupLocation { return "mappin.circle" }
        return "plus.circle"
    }

    private var indicatorColor: Color {
        if isSelected { return Color.statusText(.purple) }
        if isConflicted { return Color.statusText(.red) }
        if !isAtPickupLocation { return Color.statusText(.orange) }
        return Color(.systemGray2)
    }

    private var rowAccessibilityLabel: String {
        var parts: [String] = [asset.itemListPrimaryTitle]
        if let subtitle = asset.itemListSecondaryTitle { parts.append(subtitle) }
        parts.append(asset.location.name)
        if isConflicted { parts.append(conflictMessage ?? "Unavailable") }
        if !isAtPickupLocation { parts.append("At another pickup location") }
        if let upcomingCommitmentLabel { parts.append(upcomingCommitmentLabel) }
        if let turnaroundMessage { parts.append(turnaroundMessage) }
        if isSelected {
            parts.append("Selected")
        } else if isConflicted || !isAtPickupLocation {
            parts.append("Unavailable")
        } else {
            parts.append("Not selected")
        }
        return parts.joined(separator: ", ")
    }
}

private struct BookingAdvisoryLabel: View {
    let text: String
    let systemImage: String
    var tone: Color

    var body: some View {
        HStack(alignment: .top, spacing: 4) {
            Image(systemName: systemImage)
                .font(.caption2)
                .padding(.top, 1)
            Text(text)
                .font(.caption2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .foregroundStyle(tone)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(text)
    }
}
