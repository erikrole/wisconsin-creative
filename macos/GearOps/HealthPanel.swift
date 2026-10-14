import SwiftUI

struct HealthRow: View {
    enum Accessory {
        case chevron
        case refresh
        case progress
    }

    let title: String
    let detail: String
    let severity: GearOpsHealthSeverity
    var accessory: Accessory = .chevron
    var action: (() -> Void)?

    @State private var isHovering = false

    var body: some View {
        if let action {
            Button(action: action) { content }
                .buttonStyle(.plain)
                .background(isHovering ? Color.primary.opacity(0.06) : .clear)
                .onHover { isHovering = $0 }
                .accessibilityElement(children: .combine)
                .accessibilityAddTraits(.isButton)
        } else {
            content.accessibilityElement(children: .combine)
        }
    }

    private var content: some View {
        HStack(spacing: 8) {
            Image(systemName: severity.symbol)
                .symbolRenderingMode(.hierarchical)
                .foregroundStyle(color)
            Text(title)
            Spacer()
            Text(detail)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.trailing)
            if action != nil {
                accessoryView
                    .foregroundStyle(isHovering ? .secondary : .tertiary)
                    .frame(width: 12)
                    .accessibilityHidden(true)
            }
        }
        .font(.callout)
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .contentShape(.rect)
    }

    @ViewBuilder
    private var accessoryView: some View {
        switch accessory {
        case .chevron:
            Image(systemName: "chevron.right")
                .font(.caption2.weight(.semibold))
        case .refresh:
            Image(systemName: "arrow.clockwise")
                .font(.caption2.weight(.semibold))
        case .progress:
            ProgressView()
                .controlSize(.mini)
        }
    }

    private var color: Color { severity.color }
}

struct KioskRow: View {
    let device: KioskDevice
    let now: Date
    let action: () -> Void

    @State private var isHovering = false

    private var state: KioskConnectionState { device.connectionState(at: now) }

    var body: some View {
        Button(action: action) { content }
            .buttonStyle(.plain)
            .background(isHovering ? Color.primary.opacity(0.06) : .clear)
            .onHover { isHovering = $0 }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isButton)
            .accessibilityHint("Opens kiosk devices in Wisconsin Creative")
            .help(buildHelp)
    }

    private var content: some View {
        HStack(spacing: 10) {
            Image(systemName: "ipad")
                .symbolRenderingMode(.hierarchical)
                .frame(width: 22)
                .foregroundStyle(stateColor)
            VStack(alignment: .leading, spacing: 1) {
                Text(device.name)
                    .lineLimit(1)
                Text(kioskDetail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer()
            Text(state.label)
                .font(.caption.weight(.medium))
                .foregroundStyle(stateColor)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .contentShape(.rect)
    }

    private var kioskDetail: String {
        if state == .online {
            return "\(device.location.name) · \(device.pendingPickupCount) pickup\(device.pendingPickupCount == 1 ? "" : "s") · \(device.openCheckoutCount) open"
        }
        guard let lastSeenAt = device.lastSeenAt else {
            return "\(device.location.name) · Never checked in"
        }
        return "\(device.location.name) · Last seen \(lastSeenAt.formatted(.relative(presentation: .named)))"
    }

    private var buildHelp: String {
        device.buildLabel.map { "Build \($0)" } ?? "Build unknown"
    }

    private var stateColor: Color {
        switch state {
        case .online: .green
        case .stale: .secondary
        case .offline: .red
        case .inactive: .secondary
        }
    }
}

extension GearOpsHealthSeverity {
    var color: Color {
        switch self {
        case .healthy: .green
        case .attention: .orange
        case .critical: .red
        }
    }
}
