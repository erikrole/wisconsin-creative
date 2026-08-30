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
    var isAtPickupLocation = true
    var upcomingCommitmentLabel: String?
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
                    Label(conflictMessage ?? "Scheduling conflict", systemImage: "exclamationmark.triangle.fill")
                        .font(.caption2)
                        .foregroundStyle(Color.statusText(.red))
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityLabel(conflictMessage ?? "Scheduling conflict")
                }
                if !isAtPickupLocation {
                    Label("At \(asset.location.name)", systemImage: "mappin.and.ellipse")
                        .font(.caption2)
                        .foregroundStyle(Color.statusText(.orange))
                }
                if let upcomingCommitmentLabel {
                    Label(upcomingCommitmentLabel, systemImage: "clock.arrow.circlepath")
                        .font(.caption2)
                        .foregroundStyle(Color.statusText(.blue))
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
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

struct BulkQuantityRow: View {
    let sku: FormBulkSku
    let quantity: Int
    var locationName: String? = nil
    var isAtPickupLocation = true
    var turnaroundMessage: String?
    var turnaroundIsCritical = false
    let onDecrement: () -> Void
    let onIncrement: () -> Void
    @Environment(\.colorSchemeContrast) private var accessibilityContrast

    private var canIncrement: Bool { isAtPickupLocation && quantity < sku.availableQuantity }
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

            HStack(spacing: 8) {
                Button(action: onDecrement) {
                    Image(systemName: "minus")
                        .font(.caption.weight(.bold))
                        .frame(width: 28, height: 28)
                        .background(Color(.tertiarySystemFill), in: Circle())
                }
                .buttonStyle(.plain)
                .frame(width: 44, height: 44)
                .contentShape(Circle())
                .disabled(quantity == 0)
                .accessibilityLabel("Remove one \(sku.name)")

                Text("\(quantity)")
                    .font(.body.monospacedDigit())
                    .frame(minWidth: 24)
                    .accessibilityLabel("\(quantity) selected")

                Button(action: onIncrement) {
                    Image(systemName: "plus")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(Color.statusControlForeground(.purple, contrast: accessibilityContrast))
                        .frame(width: 28, height: 28)
                        .background(Color.statusText(.purple), in: Circle())
                }
                .buttonStyle(.plain)
                .frame(width: 44, height: 44)
                .contentShape(Circle())
                .disabled(!canIncrement)
                .accessibilityLabel("Add one \(sku.name)")
            }
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
    var isAtPickupLocation = true
    var upcomingCommitmentLabel: String?
    var turnaroundMessage: String?
    var turnaroundIsCritical = false
    let onTap: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 12) {
                BookingAssetThumbnail(imageUrl: asset.imageUrl)

                VStack(alignment: .leading, spacing: 3) {
                    Text(asset.itemListPrimaryTitle)
                        .font(.gothamBold(size: 16))
                        .foregroundStyle(.primary)
                    HStack(spacing: 6) {
                        if let subtitle = asset.itemListSecondaryTitle {
                            Text(subtitle)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        Text(asset.location.name)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    if isConflicted {
                        Label(conflictMessage ?? "Scheduling conflict", systemImage: "exclamationmark.triangle.fill")
                            .font(.caption2)
                            .foregroundStyle(Color.statusText(.red))
                            .lineLimit(2)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityLabel(conflictMessage ?? "Scheduling conflict")
                    }
                    if !isAtPickupLocation {
                        Text("Choose \(asset.location.name) pickup to add")
                            .font(.caption2.weight(.medium))
                            .foregroundStyle(Color.statusText(.orange))
                    }
                    if let upcomingCommitmentLabel {
                        Label(upcomingCommitmentLabel, systemImage: "clock.arrow.circlepath")
                            .font(.caption2)
                            .foregroundStyle(Color.statusText(.blue))
                            .lineLimit(2)
                            .fixedSize(horizontal: false, vertical: true)
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

                // Plus (not an empty radio) because tapping adds to the cart;
                // tapping an added row removes it.
                Image(systemName: isSelected ? "checkmark.circle.fill" : "plus.circle")
                    .font(.title3)
                    .foregroundStyle(indicatorColor)
                    .animation(reduceMotion ? nil : .easeInOut(duration: 0.15), value: isSelected)
                    .accessibilityHidden(true)
            }
            .contentShape(Rectangle())
            .opacity(((!isAtPickupLocation || isConflicted) && !isSelected) ? 0.48 : 1)
        }
        .buttonStyle(ScalePressStyle())
        .disabled((isConflicted && !isSelected) || (!isAtPickupLocation && !isSelected))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(rowAccessibilityLabel)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private var rowAccessibilityLabel: String {
        var parts: [String] = [asset.itemListPrimaryTitle]
        if let subtitle = asset.itemListSecondaryTitle { parts.append(subtitle) }
        parts.append(asset.location.name)
        if isConflicted { parts.append(conflictMessage ?? "Scheduling conflict") }
        if !isAtPickupLocation { parts.append("At another pickup location") }
        if let upcomingCommitmentLabel { parts.append(upcomingCommitmentLabel) }
        if let turnaroundMessage { parts.append(turnaroundMessage) }
        parts.append(isSelected ? "Selected" : "Not selected")
        return parts.joined(separator: ", ")
    }

    private var indicatorColor: Color {
        if isConflicted { return Color.statusText(.orange) }
        if turnaroundIsCritical { return Color.statusText(.red) }
        if turnaroundMessage != nil { return Color.statusText(.orange) }
        if upcomingCommitmentLabel != nil { return Color.statusText(.blue) }
        return isSelected ? Color.statusText(.purple) : Color(.systemGray2)
    }

}
