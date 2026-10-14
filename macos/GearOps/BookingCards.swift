import AppKit
import SwiftUI

struct PickupBookingRow: View {
    let booking: BookingActivitySnapshot
    let now: Date
    var matchedItem: OpenBooking.ItemReference?
    var isHighlighted = false
    let onOpenWeb: () -> Void
    let action: () -> Void

    private var timingLabel: String { booking.pickupLabel(at: now) }

    var body: some View {
        BookingGlanceCard(
            tone: .orange,
            isOverdue: false,
            title: booking.title,
            timing: timingLabel,
            requester: booking.requester.name,
            location: booking.location.name,
            itemCount: nil,
            matchedItem: matchedItem,
            isHighlighted: isHighlighted,
            avatarName: booking.requester.name,
            avatarUrl: booking.requester.avatarUrl,
            help: booking.title,
            accessibilityLabel: "\(booking.title), \(timingLabel), \(booking.requester.name), \(booking.location.name)",
            accessibilityHint: "Shows details and items",
            refNumber: nil,
            onOpenWeb: onOpenWeb,
            action: action
        )
    }
}

struct OpenBookingRow: View {
    let booking: OpenBooking
    let now: Date
    var matchedItem: OpenBooking.ItemReference?
    var isHighlighted = false
    let onOpenWeb: () -> Void
    let action: () -> Void

    private var isOverdue: Bool { booking.isOverdue(at: now) }
    private var timingLabel: String { booking.dueLabel(at: now) }

    var body: some View {
        BookingGlanceCard(
            tone: isOverdue ? .red : .blue,
            isOverdue: isOverdue,
            title: booking.title,
            timing: timingLabel,
            requester: booking.requester.name,
            location: booking.location.name,
            itemCount: booking.itemCount,
            matchedItem: matchedItem,
            isHighlighted: isHighlighted,
            avatarName: booking.requester.name,
            avatarUrl: booking.requester.avatarUrl,
            help: booking.refNumber.map { "\(booking.title) · \($0)" } ?? booking.title,
            accessibilityLabel: "\(isOverdue ? "Overdue, " : "")\(booking.title), \(booking.requester.name), \(booking.location.name), \(timingLabel)",
            accessibilityHint: "Shows details and items",
            refNumber: booking.refNumber,
            onOpenWeb: onOpenWeb,
            action: action
        )
    }
}

/// iOS `BookingRow` compact card: 4pt rail, 40pt avatar, 16pt title, operational
/// timing, requester · location · items, 16pt continuous card.
struct BookingGlanceCard: View {
    let tone: StatusTone
    let isOverdue: Bool
    let title: String
    let timing: String
    let requester: String
    let location: String
    let itemCount: Int?
    let matchedItem: OpenBooking.ItemReference?
    let isHighlighted: Bool
    let avatarName: String
    let avatarUrl: String?
    let help: String
    let accessibilityLabel: String
    let accessibilityHint: String
    let refNumber: String?
    let onOpenWeb: () -> Void
    let action: () -> Void

    @State private var isHovering = false

    var body: some View {
        card
            .contextMenu {
            Button("Show Details", action: action)
            Button("Open in Wisconsin Creative", action: onOpenWeb)
            if let refNumber, !refNumber.isEmpty {
                Divider()
                Button("Copy Reference \(refNumber)") { Pasteboard.copy(refNumber) }
            }
        }
    }

    @ViewBuilder
    private var card: some View {
        if #available(macOS 26.0, *) {
            cardButton
                .glassEffect(
                    isOverdue
                        ? .regular.tint(Color.red.opacity(0.12)).interactive()
                        : .regular.interactive(),
                    in: .rect(cornerRadius: Brand.Radius.md)
                )
                .onHover { isHovering = $0 }
        } else {
            cardButton
                .background(
                    fallbackBackground,
                    in: RoundedRectangle(cornerRadius: Brand.Radius.md, style: .continuous)
                )
                .overlay {
                    RoundedRectangle(cornerRadius: Brand.Radius.md, style: .continuous)
                        .strokeBorder(Color.hairline, lineWidth: 0.5)
                }
                .shadow(color: Color.black.opacity(0.05), radius: 8, x: 0, y: 3)
                .onHover { isHovering = $0 }
        }
    }

    private var fallbackBackground: Color {
        if isOverdue { return Color.statusBackground(.red) }
        return isHovering ? Color.primary.opacity(0.1) : Color.primary.opacity(0.045)
    }

    private var cardButton: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                StatusRail(tone: tone)
                UserAvatarView(name: avatarName, avatarUrl: avatarUrl, size: 40)
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.system(size: 16, weight: .bold))
                        .lineLimit(1)
                    Text(timing)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.statusText(tone))
                        .lineLimit(1)
                    HStack(spacing: 4) {
                        Text(requester)
                        Text("·")
                        Text(location)
                        if let itemCount, itemCount > 0 {
                            Text("·")
                            Text("\(itemCount) item\(itemCount == 1 ? "" : "s")")
                                .monospacedDigit()
                        }
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    if let matchedItem {
                        Label(matchLabel(matchedItem), systemImage: "shippingbox")
                            .font(.caption.weight(.medium))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 8)
                Image(systemName: "chevron.right")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
            .padding(.vertical, 12)
            .padding(.horizontal, 14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay {
                // Keyboard highlight from the search field's arrow keys. Real
                // focus stays in the field so typing keeps refining. Drawn in
                // the content layer because Liquid Glass washes out overlays
                // applied outside it.
                if isHighlighted {
                    RoundedRectangle(cornerRadius: Brand.Radius.md, style: .continuous)
                        .strokeBorder(Color.accentColor, lineWidth: 2)
                        .accessibilityHidden(true)
                }
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .help(help)
        .accessibilityLabel(matchedItem.map { "\(accessibilityLabel), matched \(matchLabel($0))" } ?? accessibilityLabel)
        .accessibilityHint(accessibilityHint)
        .accessibilityAddTraits(isHighlighted ? .isSelected : [])
    }

    private func matchLabel(_ item: OpenBooking.ItemReference) -> String {
        [item.listPrimaryTitle, item.listSecondaryTitle].compactMap { $0 }.joined(separator: " · ")
    }
}

struct ExtraBookingDetail: View {
    let title: String
    let timing: String
    let tone: StatusTone
    let isOverdue: Bool
    let requester: OpenBooking.Person
    let locationName: String
    let refNumber: String?
    let items: [OpenBooking.ItemReference]
    let backLabel: String
    let onBack: () -> Void
    let onOpenWeb: () -> Void

    private var namedItems: [OpenBooking.ItemReference] { items.filter(\.hasIdentity) }
    private var itemsAreAnonymous: Bool { !items.isEmpty && namedItems.isEmpty }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Button(action: onBack) {
                Label(backLabel, systemImage: "chevron.left")
            }
            .buttonStyle(.link)
            .font(.callout.weight(.semibold))
            .keyboardShortcut(.cancelAction)
            .help("Back to all bookings (Esc)")
            .accessibilityLabel(backLabel)

            HStack(alignment: .top, spacing: 12) {
                StatusRail(tone: tone)
                UserAvatarView(name: requester.name, avatarUrl: requester.avatarUrl, size: 40)
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.system(size: 16, weight: .bold))
                        .fixedSize(horizontal: false, vertical: true)
                    Text(timing)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.statusText(tone))
                    HStack(spacing: 4) {
                        Text(requester.name)
                        Text("·")
                        Text(locationName)
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    if let refNumber, !refNumber.isEmpty {
                        Text(refNumber)
                            .font(.caption.monospaced())
                            .foregroundStyle(.tertiary)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.vertical, 12)
            .padding(.horizontal, 14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                isOverdue ? Color.statusBackground(.red) : Color.primary.opacity(0.045),
                in: RoundedRectangle(cornerRadius: Brand.Radius.md, style: .continuous)
            )

            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("Items")
                        .font(.caption.weight(.semibold))
                        .kerning(0.4)
                        .foregroundStyle(.secondary)
                        .textCase(.uppercase)
                    Spacer()
                    if !items.isEmpty {
                        Text("\(items.count)")
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                }

                if items.isEmpty {
                    Text("No items on this booking.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                } else if itemsAreAnonymous {
                    Text("Item details aren't available for this booking. Open it in Wisconsin Creative to see them.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                            if index > 0 { Divider() }
                            ExtraItemRow(item: item)
                        }
                    }
                    if items.count >= CompanionProjectionLimits.itemsPerBooking {
                        Text("Showing the first \(CompanionProjectionLimits.itemsPerBooking) items.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }

            HStack(spacing: 8) {
                Button(action: onOpenWeb) {
                    Label("Open in Wisconsin Creative", systemImage: "arrow.up.forward.app")
                }
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.defaultAction)
                .help("Open this booking in your browser (Return)")
                if let refNumber, !refNumber.isEmpty {
                    CopyReferenceButton(refNumber: refNumber)
                }
            }
            .controlSize(.regular)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct ExtraItemRow: View {
    let item: OpenBooking.ItemReference

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(item.listPrimaryTitle)
                    .font(.callout.weight(.semibold))
                    .lineLimit(1)
                if let subtitle = item.listSecondaryTitle {
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            if let quantity = item.quantity, quantity > 1 {
                Text("×\(quantity)")
                    .font(.callout.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 8)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel)
    }

    private var accessibilityLabel: String {
        var parts = [item.listPrimaryTitle]
        if let subtitle = item.listSecondaryTitle { parts.append(subtitle) }
        if let quantity = item.quantity { parts.append("quantity \(quantity)") }
        return parts.joined(separator: ", ")
    }
}

/// Reference numbers are what staff read aloud or paste into a search, so the
/// detail view offers a one-click copy with brief confirmation.
struct CopyReferenceButton: View {
    let refNumber: String

    @State private var didCopy = false

    var body: some View {
        Button {
            Pasteboard.copy(refNumber)
            didCopy = true
            Task {
                try? await Task.sleep(for: .seconds(1.5))
                didCopy = false
            }
        } label: {
            Label(didCopy ? "Copied" : "Copy Ref", systemImage: didCopy ? "checkmark" : "doc.on.doc")
                .contentTransition(.symbolEffect(.replace))
        }
        .buttonStyle(.bordered)
        .help("Copy \(refNumber)")
        .accessibilityLabel(didCopy ? "Copied reference \(refNumber)" : "Copy reference \(refNumber)")
    }
}

enum Pasteboard {
    @MainActor
    static func copy(_ string: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(string, forType: .string)
    }
}
