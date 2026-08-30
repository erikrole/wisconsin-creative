import SwiftUI

// MARK: - Asset row

struct AssetResultRow: View {
    let asset: Asset

    var body: some View {
        HStack(spacing: 12) {
            AssetThumbnail(imageUrl: asset.imageUrl, size: 44)

            VStack(alignment: .leading, spacing: 3) {
                Text(asset.itemListPrimaryTitle)
                    .font(.gothamBold(size: 16))
                    .lineLimit(1)
                if let subtitle = asset.itemListSecondaryTitle {
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                HStack(spacing: 4) {
                    if let cat = asset.category {
                        Text(cat.name)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    if asset.category != nil {
                        Text("·").font(.caption).foregroundStyle(.tertiary)
                    }
                    Text(asset.location.name)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .lineLimit(1)
            }

            Spacer()

            AssetStatusBadge(status: asset.computedStatus)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityLabel)
        .accessibilityHint("Opens item details")
    }

    private var accessibilityLabel: String {
        [
            asset.itemListPrimaryTitle,
            asset.itemListSecondaryTitle,
            asset.category?.name,
            asset.location.name,
            asset.computedStatus.label,
        ].compactMap { $0 }.joined(separator: ", ")
    }
}

// MARK: - Item-family row

struct ItemFamilyResultRow: View {
    let family: AssetFamilySearchResult
    var showsReserveAction = false

    var body: some View {
        HStack(spacing: 12) {
            SearchBulkThumbnail(imageUrl: family.imageUrl, size: 44)

            VStack(alignment: .leading, spacing: 3) {
                Text(family.name)
                    .font(.gothamBold(size: 16))
                    .lineLimit(1)
                Text(family.scannedUnitLabel ?? family.availabilityLabel)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Text("\(family.category) · \(family.locationName)")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                    .lineLimit(1)
            }

            Spacer()

            if showsReserveAction {
                Label("Reserve", systemImage: "plus.circle")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.tint)
                    .labelStyle(.titleAndIcon)
            } else {
                Text(family.trackByNumber ? "Units" : "Quantity")
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(.quaternary, in: Capsule())
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(family.name), \(family.scannedUnitLabel ?? family.availabilityLabel), \(family.category), \(family.locationName), \(family.trackByNumber ? "Units" : "Quantity")")
    }
}

struct SearchBulkThumbnail: View {
    let imageUrl: String?
    let size: CGFloat

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 8)
                .fill(Color(.secondarySystemBackground))
                .frame(width: size, height: size)
            if let imageUrl, let url = URL(string: imageUrl) {
                CachedThumbnail(url: url, size: size, placeholderSystemImage: "shippingbox")
                .frame(width: size, height: size)
                .clipShape(RoundedRectangle(cornerRadius: 8))
            } else {
                placeholder
            }
        }
    }

    private var placeholder: some View {
        Image(systemName: "shippingbox")
            .font(.system(size: 18))
            .foregroundStyle(.secondary)
    }
}

// MARK: - Booking row

struct BookingResultRow: View {
    let booking: Booking
    /// Defaults to the requester's name, which is what a search result needs.
    /// A profile passes the booking's timing instead -- on someone's own page
    /// every row would otherwise repeat the name in the title bar above it.
    var subtitle: String?

    private var subtitleText: String { subtitle ?? booking.requester.name }

    var body: some View {
        // Booking kind → status taxonomy: checkout = blue (active), reservation = purple (planned).
        let kindTone: StatusTone = booking.kind == .checkout ? .blue : .purple
        return HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 8)
                    .fill(Color.statusBackground(kindTone))
                    .frame(width: 40, height: 40)
                Image(systemName: booking.kind == .checkout ? "arrow.up.circle" : "calendar")
                    .font(.system(size: 16))
                    .foregroundStyle(Color.statusText(kindTone))
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(booking.title)
                    .font(.subheadline.weight(.medium))
                    .lineLimit(1)
                Text(subtitleText)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer()
            StatusBadge(status: booking.status, kind: booking.kind)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(booking.title), \(subtitleText), \(booking.kind == .checkout ? "Checkout" : "Reservation"), \(booking.status.label)")
        .accessibilityHint("Opens booking details")
    }
}

// MARK: - User row

struct UserResultRow: View {
    let user: AppUser

    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(Color.secondary.opacity(0.15))
                    .frame(width: 40, height: 40)
                Text(user.name.searchInitials)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color.secondary)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(user.name)
                    .font(.subheadline.weight(.medium))
                    .lineLimit(1)
                Text(user.email)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer()
            Text(user.role.lowercased().capitalized)
                .font(.caption2.weight(.medium))
                .foregroundStyle(.secondary)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(.quaternary, in: Capsule())
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(user.name), \(user.email), \(user.role.lowercased().capitalized)")
        .accessibilityHint("Opens person details")
    }
}

// MARK: - String helper (scoped to avoid conflicts)

extension String {
    var searchInitials: String {
        let parts = self.split(separator: " ")
        if parts.count >= 2 {
            return "\(parts[0].prefix(1))\(parts[1].prefix(1))".uppercased()
        }
        return String(self.prefix(2)).uppercased()
    }
}
