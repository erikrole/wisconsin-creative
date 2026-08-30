import SwiftUI

// MARK: - Single-match hero cards

/// Rich card shown in the scan result sheet when a scan resolves to exactly
/// one match. Multi-match scans keep the compact row list; this card is the
/// "scanned a sticker, got the thing" payoff: hero image, status badge,
/// prominent unit/tag number, availability, and custody info.

struct ScanAssetHeroCard: View {
    let asset: Asset
    var onViewItem: () -> Void
    var onReserve: () -> Void
    var onOpenBooking: ((String) -> Void)? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            ScanHeroImage(
                imageUrl: asset.imageUrl,
                placeholderIcon: "bag",
                photoLabel: "Photo of \(asset.itemListPrimaryTitle)"
            )

            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline) {
                    // The asset tag is what's printed on the sticker the user
                    // just scanned — it's the headline, in the web's Gotham
                    // title face. Name only steps in when there's no tag.
                    Text(asset.assetTag ?? asset.name ?? asset.displayName)
                        .font(.gothamBlack(size: 30))
                        .lineLimit(2)
                        .minimumScaleFactor(0.6)
                    Spacer()
                    AssetStatusBadge(status: asset.computedStatus)
                }
                Text(metaLine)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            if let booking = asset.activeBooking {
                ScanHeroCustodyRow(
                    holder: booking.requesterName,
                    holderAvatarUrl: booking.requesterAvatarUrl,
                    bookingTitle: booking.title,
                    dueAt: booking.endsAt,
                    isOverdue: booking.isOverdue,
                    onOpenBooking: onOpenBooking.map { open in { open(booking.id) } }
                )
            }

            HStack(spacing: 10) {
                // Retired or in-shop gear isn't reservable — don't offer it.
                if isReservable {
                    Button(action: onReserve) {
                        Label("Reserve", systemImage: "calendar.badge.plus")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.large)
                    .tint(.primary)
                }

                Button(action: onViewItem) {
                    Label("View item", systemImage: "arrow.right.circle.fill")
                        .foregroundStyle(Color(.systemBackground))
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .tint(Color(.label))
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 20)
        .padding(.bottom, 28)
        .frame(maxWidth: 560)
        .frame(maxWidth: .infinity)
    }

    private var isReservable: Bool {
        asset.computedStatus != .retired && asset.computedStatus != .maintenance
    }

    private var metaLine: String {
        var parts: [String] = []
        if let cat = asset.category { parts.append(cat.name) }
        parts.append(asset.location.name)
        return parts.joined(separator: " · ")
    }
}

struct ScanFamilyHeroCard: View {
    let family: AssetFamilySearchResult
    var onReserve: () -> Void
    var onOpenBooking: ((String) -> Void)? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            ScanHeroImage(
                imageUrl: family.imageUrl,
                placeholderIcon: "shippingbox",
                photoLabel: "Photo of \(family.name)"
            )

            VStack(alignment: .leading, spacing: 4) {
                Text(family.name)
                    .font(.gothamBlack(size: 24))
                    .lineLimit(2)
                    .minimumScaleFactor(0.7)
                Text("\(family.category) · \(family.locationName)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            // The status badge lives here, not on the title row: with dozens
            // of units in a family, "Available" is a claim about the scanned
            // unit, so it belongs next to the unit number.
            if let unitNumber = family.matchedUnitNumber {
                ScanHeroIdentifier(
                    label: "Scanned unit",
                    value: "#\(unitNumber)",
                    status: unitStatus
                )
            }

            ScanHeroStatsRow(family: family)

            if family.trackByNumber, let units = family.units, !units.isEmpty {
                ScanHeroUnitRoster(units: units, scannedUnitNumber: family.matchedUnitNumber)
            }

            if let holder = family.matchedUnitHolder {
                ScanHeroCustodyRow(
                    holder: holder,
                    holderAvatarUrl: family.matchedUnitHolderAvatarUrl,
                    bookingTitle: family.matchedUnitBookingTitle,
                    dueAt: family.matchedUnitDueAt,
                    isOverdue: family.matchedUnitDueAt.map { $0 < .now } ?? false,
                    onOpenBooking: family.matchedUnitBookingId.flatMap { id in
                        onOpenBooking.map { open in { open(id) } }
                    }
                )
            }

            // No bulk-SKU detail screen exists on iOS, so there's no View
            // item tap-through — Reserve is the one action that makes sense.
            Button(action: onReserve) {
                Label("Reserve", systemImage: "calendar.badge.plus")
                    .foregroundStyle(Color(.systemBackground))
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .tint(Color(.label))
        }
        .padding(.horizontal, 20)
        .padding(.top, 20)
        .padding(.bottom, 28)
        .frame(maxWidth: 560)
        .frame(maxWidth: .infinity)
    }

    /// Unit statuses come over the wire as the same raw strings as asset
    /// computed statuses (AVAILABLE, CHECKED_OUT, ...), so the asset badge
    /// taxonomy applies directly.
    private var unitStatus: AssetComputedStatus? {
        family.matchedUnitStatus.map { AssetComputedStatus(rawValue: $0) ?? .unknown }
    }
}

// MARK: - Unit roster

/// Per-unit status grid for numbered bulk families — fills the large detent
/// with the answer to "which units are out". The scanned unit gets a ring.
private struct ScanHeroUnitRoster: View {
    let units: [FamilyUnitSummary]
    let scannedUnitNumber: Int?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("ALL UNITS")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 52), spacing: 8)], spacing: 8) {
                ForEach(units, id: \.unitNumber) { unit in
                    chip(for: unit)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14))
    }

    private func chip(for unit: FamilyUnitSummary) -> some View {
        let status = AssetComputedStatus(rawValue: unit.status) ?? .unknown
        let tone = Self.tone(for: status)
        let isScanned = unit.unitNumber == scannedUnitNumber
        return Text("#\(unit.unitNumber)")
            .font(.caption.weight(isScanned ? .bold : .medium))
            .monospacedDigit()
            .frame(maxWidth: .infinity)
            .padding(.vertical, 6)
            .background(Color.statusBackground(tone), in: Capsule())
            .foregroundStyle(Color.statusText(tone))
            .overlay(
                Capsule().strokeBorder(
                    isScanned ? Color.statusText(tone) : .clear,
                    lineWidth: 1.5
                )
            )
            .accessibilityLabel("Unit \(unit.unitNumber), \(status.label)\(isScanned ? ", scanned unit" : "")")
    }

    private static func tone(for status: AssetComputedStatus) -> StatusTone {
        switch status {
        case .available:   return .green
        case .checkedOut:  return .blue
        case .pendingPickup, .maintenance: return .orange
        case .reserved:    return .purple
        case .retired, .unknown: return .gray
        }
    }
}

// MARK: - Hero image

private struct ScanHeroImage: View {
    let imageUrl: String?
    let placeholderIcon: String
    let photoLabel: String
    @State private var showZoom = false

    var body: some View {
        Group {
            if imageUrl != nil {
                Button {
                    showZoom = true
                } label: {
                    imageContent
                }
                .buttonStyle(.plain)
                .accessibilityLabel("View larger image")
                .accessibilityHint("Opens the item image full screen")
            } else {
                imageContent
                    .accessibilityHidden(true)
            }
        }
        .fullScreenCover(isPresented: $showZoom) {
            if let imageUrl, let url = URL(string: imageUrl) {
                ZoomableImageViewer(url: url, photoLabel: photoLabel)
            }
        }
    }

    private var imageContent: some View {
        ZStack {
            // Full white in both modes when a photo exists: inventory photos
            // are catalog shots on white, so the frame disappears into the
            // image instead of letterboxing it with gray. Placeholders keep
            // the neutral system fill (a stark white empty tile reads broken
            // in dark mode).
            if imageUrl != nil {
                Color.white
            } else {
                Color(.secondarySystemBackground)
            }
            if let imageUrl, let url = URL(string: imageUrl) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        // Fit, not fill: inventory photos are catalog-style
                        // product shots — cropping them cuts the object.
                        image
                            .resizable()
                            .scaledToFit()
                            .padding(12)
                    default:
                        placeholder
                    }
                }
            } else {
                placeholder
            }
        }
        .frame(height: 180)
        .frame(maxWidth: .infinity)
        .clipShape(RoundedRectangle(cornerRadius: 20))
        .overlay(
            RoundedRectangle(cornerRadius: 20)
                .strokeBorder(Color(.separator).opacity(0.5), lineWidth: 1)
        )
    }

    private var placeholder: some View {
        Image(systemName: placeholderIcon)
            .font(.system(size: 44))
            .foregroundStyle(Color(.systemGray3))
    }
}

// MARK: - Identifier (big unit/tag number)

private struct ScanHeroIdentifier: View {
    let label: String
    let value: String
    var status: AssetComputedStatus? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label.uppercased())
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
            HStack(alignment: .center) {
                Text(value)
                    .font(.system(.title, design: .rounded).weight(.bold))
                    .monospacedDigit()
                    .contentTransition(.numericText())
                Spacer()
                if let status {
                    AssetStatusBadge(status: status)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Availability stats

private struct ScanHeroStatsRow: View {
    let family: AssetFamilySearchResult

    var body: some View {
        HStack(spacing: 10) {
            // Zero available is the actionable state — flag it instead of
            // celebrating green.
            ScanHeroStatTile(
                value: family.availableQuantity,
                label: "Available",
                tone: family.availableQuantity > 0 ? .green : .orange
            )
            ScanHeroStatTile(
                value: family.checkedOutQuantity,
                label: "Checked out",
                tone: family.checkedOutQuantity > 0 ? .blue : nil
            )
            ScanHeroStatTile(
                value: family.onHandQuantity,
                label: family.trackByNumber ? "Units total" : "On hand",
                tone: nil,
                caption: absorbedCaption
            )
        }
    }

    /// Lost/retired units are excluded from Available but included in the
    /// total — without this, a family with 2 lost units shows 50/0/52 with
    /// no explanation.
    private var absorbedCaption: String? {
        var parts: [String] = []
        if family.lostQuantity > 0 { parts.append("\(family.lostQuantity) lost") }
        if family.retiredQuantity > 0 { parts.append("\(family.retiredQuantity) retired") }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

private struct ScanHeroStatTile: View {
    let value: Int
    let label: String
    let tone: StatusTone?
    var caption: String? = nil

    var body: some View {
        VStack(spacing: 2) {
            Text("\(value)")
                .font(.system(.title2, design: .rounded).weight(.bold))
                .monospacedDigit()
                .foregroundStyle(tone.map { Color.statusText($0) } ?? .primary)
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            if let caption {
                Text(caption)
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .background(
            tone.map { Color.statusBackground($0) } ?? Color(.secondarySystemBackground),
            in: RoundedRectangle(cornerRadius: 14)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilitySummary)
    }

    private var accessibilitySummary: String {
        var summary = "\(value) \(label.lowercased())"
        if let caption { summary += ", \(caption)" }
        return summary
    }
}

// MARK: - Custody (holder + due date)

private struct ScanHeroCustodyRow: View {
    let holder: String
    /// Holder's profile photo, when set. Falls back to initials inside UserAvatarView.
    var holderAvatarUrl: String? = nil
    let bookingTitle: String?
    let dueAt: Date?
    let isOverdue: Bool
    /// When set, the row is a tap target that deeplinks to the booking.
    var onOpenBooking: (() -> Void)? = nil

    var body: some View {
        if let onOpenBooking {
            Button(action: onOpenBooking) { content }
                .buttonStyle(.plain)
                .accessibilityHint("Opens the booking")
        } else {
            content
        }
    }

    private var content: some View {
        HStack(spacing: 12) {
            UserAvatarView(name: holder, avatarUrl: holderAvatarUrl, size: 40)
            VStack(alignment: .leading, spacing: 2) {
                Text(holder)
                    .font(.subheadline.weight(.medium))
                    .lineLimit(1)
                if let bookingTitle {
                    Text(bookingTitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            Spacer()
            if let dueAt {
                VStack(alignment: .trailing, spacing: 2) {
                    Text(isOverdue ? "Overdue" : "Due")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(isOverdue ? Color.statusText(.red) : .secondary)
                    Text(dueAt.formatted(.dateTime.month(.abbreviated).day().hour().minute()))
                        .font(.caption.weight(.medium))
                        .foregroundStyle(isOverdue ? Color.statusText(.red) : .primary)
                }
            }
            if onOpenBooking != nil {
                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(12)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14))
        .accessibilityElement(children: .combine)
    }
}
