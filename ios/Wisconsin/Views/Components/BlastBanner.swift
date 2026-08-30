import SwiftUI

/// A broadcast from staff, pinned at the top of the dashboard until acknowledged.
///
/// Deliberately not `BannerView`: that one is a single-line pill with a text
/// action, and a blast carries a title, a multi-line message, an attribution, and
/// a commitment button. The visual language is shared -- same status tones, same
/// Brand spacing and radii -- so the two read as siblings.
struct BlastBanner: View {
    let blast: ActiveBlast
    let onAcknowledge: () -> Void
    @Environment(\.colorSchemeContrast) private var accessibilityContrast

    private var tone: StatusTone {
        switch blast.severity {
        case .urgent: StatusTone.red
        case .warning: StatusTone.orange
        case .info, .unknown: StatusTone.blue
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Brand.Space.sm) {
            HStack(spacing: 6) {
                Image(systemName: iconName)
                    .font(.caption.weight(.bold))
                    .accessibilityHidden(true)
                Text(blast.title)
                    .font(.gothamBold(size: 16, relativeTo: .headline))
                    .lineLimit(2)
                Spacer(minLength: 8)
            }
            .foregroundStyle(Color.statusText(tone))

            Text(blast.body)
                .font(.subheadline)
                .foregroundStyle(.primary)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: Brand.Space.sm) {
                if let attribution {
                    Text(attribution)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 8)
                Button(action: onAcknowledge) {
                    Text("Got it")
                        .font(.subheadline.weight(.semibold))
                        .padding(.horizontal, 14)
                        .padding(.vertical, 7)
                }
                .buttonStyle(.plain)
                .background(Color.statusText(tone), in: Capsule())
                .foregroundStyle(Color.statusControlForeground(tone, contrast: accessibilityContrast))
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(Capsule())
                .accessibilityLabel("Acknowledge: \(blast.title)")
            }
        }
        .padding(Brand.Space.md)
        .background(
            Color.statusBackground(tone),
            in: RoundedRectangle(cornerRadius: Brand.Radius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: Brand.Radius.md, style: .continuous)
                .strokeBorder(Color.statusText(tone).opacity(0.25), lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
    }

    private var iconName: String {
        switch blast.severity {
        case .urgent: "exclamationmark.triangle.fill"
        case .warning: "exclamationmark.circle.fill"
        case .info, .unknown: "megaphone.fill"
        }
    }

    private var attribution: String? {
        guard let name = blast.senderName, !name.isEmpty else { return nil }
        guard let sentAt = blast.sentAt else { return name }
        return "\(name) · \(sentAt.formatted(date: .omitted, time: .shortened))"
    }
}

/// Stacks the active blasts most-severe first. Capped so a backlog of unacked
/// blasts can never bury the dashboard it sits on top of.
struct BlastBannerStack: View {
    let blasts: [ActiveBlast]
    let onAppearBlast: (String) -> Void
    let onAcknowledge: (String) -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var visible: [ActiveBlast] {
        blasts.sorted { $0.severity.rank < $1.severity.rank }.prefix(3).map { $0 }
    }

    var body: some View {
        VStack(spacing: Brand.Space.sm) {
            ForEach(visible) { blast in
                BlastBanner(blast: blast) { onAcknowledge(blast.id) }
                    .onAppear { onAppearBlast(blast.id) }
                    .transition(reduceMotion ? .opacity : .move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(reduceMotion ? nil : .snappy, value: visible.map(\.id))
    }
}
