import SwiftUI
import UIKit

// MARK: - Shared kiosk components
//
// One implementation each for UI that was previously copied across the kiosk
// flows: the feedback banner existed in four places, the scan-zone header /
// progress ring / battery status / unit chips / error state / completion CTA
// in two or three each. Centralizing them kills the drift (so a polish change
// lands everywhere at once) and lets every flow share the same hit targets,
// motion, and color rules. Pure presentation -- no business logic.

// MARK: Flow header

/// Back · centered title (optional subtitle) · optional trailing content ·
/// optional camera. The title is optically centered via an overlay so unequal
/// side widths don't shift it. Buttons keep a 44pt touch target per
/// `docs/DESIGN_LANGUAGE.md`. The trailing slot lets screens hang their own
/// content (e.g. the student hub's avatar + name) off the shared header
/// instead of hand-rolling a top bar.
struct KioskFlowHeader<Trailing: View>: View {
    let title: String
    var subtitle: String?
    var backAccessibilityLabel: String = "Back to roster"
    let onBack: () -> Void
    var onCamera: (() -> Void)?
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        HStack(spacing: KioskSpacing.sm) {
            KioskHeaderButton(
                systemImage: "chevron.left",
                label: "Back",
                accessibilityLabel: backAccessibilityLabel,
                action: onBack
            )
            Spacer(minLength: 0)
            trailing()
            if let onCamera {
                KioskHeaderButton(
                    systemImage: "camera.fill",
                    label: "Camera",
                    accessibilityLabel: "Use camera to scan instead",
                    action: onCamera
                )
            } else if Trailing.self == EmptyView.self {
                Color.clear.frame(width: 44, height: 44)
            }
        }
        .overlay {
            VStack(spacing: 2) {
                Text(title)
                    .font(.kioskScreenTitle())
                    .foregroundStyle(KioskText.primary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                    .accessibilityAddTraits(.isHeader)
                if let subtitle {
                    Text(subtitle)
                        .font(.caption.weight(.medium))
                        .foregroundStyle(KioskText.tertiary)
                        .lineLimit(1)
                }
            }
            .allowsHitTesting(false)
        }
    }
}

extension KioskFlowHeader where Trailing == EmptyView {
    /// Existing call-site shape: back · title · optional camera.
    init(
        title: String,
        subtitle: String? = nil,
        backAccessibilityLabel: String = "Back to roster",
        onBack: @escaping () -> Void,
        onCamera: (() -> Void)? = nil
    ) {
        self.init(
            title: title,
            subtitle: subtitle,
            backAccessibilityLabel: backAccessibilityLabel,
            onBack: onBack,
            onCamera: onCamera,
            trailing: { EmptyView() }
        )
    }
}

private struct KioskHeaderButton: View {
    let systemImage: String
    let label: String
    let accessibilityLabel: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(label, systemImage: systemImage)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(KioskText.primary)
                .padding(.horizontal, 6)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.glass)
        .controlSize(.regular)
        .accessibilityLabel(accessibilityLabel)
    }
}

// MARK: Section icon

/// Leading glyph for a card section header: a tinted rounded square instead of
/// a bare SF Symbol floating in space. Purely decorative.
struct KioskSectionIcon: View {
    let systemImage: String
    var tint: Color = Color.kioskRed
    var size: CGFloat = 40

    var body: some View {
        RoundedRectangle(cornerRadius: KioskRadius.sm)
            .fill(tint.opacity(0.14))
            .frame(width: size, height: size)
            .overlay {
                Image(systemName: systemImage)
                    .font(.system(size: size * 0.42, weight: .semibold))
                    .foregroundStyle(tint)
            }
            .accessibilityHidden(true)
    }
}

// MARK: Scan target

/// The scan-zone focal point: viewfinder corner brackets around a barcode
/// glyph, tinted by the flow's scan-feedback color. Keep the bracket geometry
/// static: PhaseAnimator caused the shape to translate during its first phase
/// on the managed iPad instead of producing a clean opacity pulse.
struct KioskScanTarget: View {
    var tint: Color
    var width: CGFloat = 220
    var height: CGFloat = 140

    var body: some View {
        ZStack {
            KioskCornerBrackets()
                .stroke(tint, style: StrokeStyle(lineWidth: 3, lineCap: .round))
            Image(systemName: "barcode.viewfinder")
                .font(.system(size: 56))
                .foregroundStyle(tint)
        }
        .frame(width: width, height: height)
        .accessibilityHidden(true)
    }
}

/// Four rounded viewfinder corners.
private struct KioskCornerBrackets: Shape {
    var arm: CGFloat = 26
    var radius: CGFloat = 20

    func path(in rect: CGRect) -> Path {
        var path = Path()

        // Top-leading
        path.move(to: CGPoint(x: rect.minX, y: rect.minY + arm))
        path.addArc(
            tangent1End: CGPoint(x: rect.minX, y: rect.minY),
            tangent2End: CGPoint(x: rect.minX + arm, y: rect.minY),
            radius: radius
        )
        path.addLine(to: CGPoint(x: rect.minX + arm, y: rect.minY))

        // Top-trailing
        path.move(to: CGPoint(x: rect.maxX - arm, y: rect.minY))
        path.addArc(
            tangent1End: CGPoint(x: rect.maxX, y: rect.minY),
            tangent2End: CGPoint(x: rect.maxX, y: rect.minY + arm),
            radius: radius
        )
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY + arm))

        // Bottom-trailing
        path.move(to: CGPoint(x: rect.maxX, y: rect.maxY - arm))
        path.addArc(
            tangent1End: CGPoint(x: rect.maxX, y: rect.maxY),
            tangent2End: CGPoint(x: rect.maxX - arm, y: rect.maxY),
            radius: radius
        )
        path.addLine(to: CGPoint(x: rect.maxX - arm, y: rect.maxY))

        // Bottom-leading
        path.move(to: CGPoint(x: rect.minX + arm, y: rect.maxY))
        path.addArc(
            tangent1End: CGPoint(x: rect.minX, y: rect.maxY),
            tangent2End: CGPoint(x: rect.minX, y: rect.maxY - arm),
            radius: radius
        )
        path.addLine(to: CGPoint(x: rect.minX, y: rect.maxY - arm))

        return path
    }
}

// MARK: Scan stage

/// The scan surface for checkout, pickup, and return: one content card that *is*
/// the scanner's state, rather than a grey glyph floating above three separate
/// lines of chrome.
///
/// It replaces a stack of: a low-contrast bracket target, "Scan items to add",
/// "Or tap Camera if no scanner is connected", and a readiness pill — four
/// elements all reporting the same thing, none of them prominent. Here the
/// panel's own tint and border carry the state, the headline says what to do,
/// and the camera fallback only appears when it is actually the answer (no
/// scanner paired), instead of sitting there as permanent instruction text.
/// What a scan just put in someone's hands, for the flow to confirm.
struct KioskAcceptedScan: Equatable {
    let title: String
    let subtitle: String?
    /// Flow-specific progress line — "4 items scanned" while a cart builds up,
    /// "2 of 6 returned" while a checklist drains.
    let progress: String
}

struct KioskScanStage: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let isHardwareConnected: Bool
    let isReady: Bool
    var lastScanAt: Date?
    var feedbackTint: Color?
    /// Set for a few seconds after a scan lands. The stage becomes the receipt.
    var accepted: KioskAcceptedScan?
    var onCamera: (() -> Void)?
    var onHelp: (() -> Void)?

    private var tint: Color {
        if accepted != nil { return KioskStatus.ok }
        if let feedbackTint { return feedbackTint }
        if !isHardwareConnected { return KioskStatus.problem }
        return isReady ? Color.kioskRedGlyph : KioskStatus.attention
    }

    private var headline: String {
        if !isHardwareConnected { return "No scanner connected" }
        if !isReady { return "Scanner reconnecting" }
        return "Ready to scan"
    }

    private var detail: String {
        if !isHardwareConnected { return "Turn the scanner on, or use the camera instead." }
        if !isReady { return "Reconnecting to the hand scanner." }
        if let lastScanAt {
            let seconds = max(0, Int(Date().timeIntervalSince(lastScanAt)))
            if seconds < 5 { return "Scan received." }
            if seconds < 60 { return "Last scan \(seconds)s ago." }
        }
        return "Point the scanner at a barcode."
    }

    var body: some View {
        VStack(spacing: KioskSpacing.md) {
            if let accepted {
                // The confirmation *is* the stage, not a caption beside it.
                //
                // A landed scan used to produce a small text banner plus a new
                // row in the side rail. Both are correct and both are unreadable
                // from where a student stands — so the one question this screen
                // exists to answer, "did that scan take?", was answered in the
                // smallest type on it while the scan target sat unchanged in
                // the middle of the panel.
                acceptedView(accepted)
            } else {
                KioskScanTarget(tint: tint, width: 260, height: 156)

                VStack(spacing: 6) {
                    Text(headline)
                        .font(KioskType.actionTitle)
                        .foregroundStyle(KioskText.primary)
                    Text(detail)
                        .font(KioskType.rowDetail)
                        .foregroundStyle(KioskText.secondary)
                        .multilineTextAlignment(.center)
                }
            }

            HStack(spacing: KioskSpacing.sm) {
                // The camera is the answer only when there is no scanner to
                // wait for. Otherwise it stays in the header where it belongs.
                if !isHardwareConnected, let onCamera {
                    Button("Use Camera", action: onCamera)
                        .font(KioskType.chip)
                        .kioskButtonRole(.primary)
                        .controlSize(.large)
                }
                if let onHelp {
                    Button("Scanner help", action: onHelp)
                        .font(KioskType.chip)
                        .kioskButtonRole(.secondary)
                        .controlSize(.regular)
                }
            }
        }
        .padding(.horizontal, KioskSpacing.xl)
        .padding(.vertical, KioskSpacing.lg)
        .frame(maxWidth: .infinity)
        .kioskCard(KioskSurface.card, radius: KioskRadius.hero, stroke: KioskStroke.standard)
        .overlay(
            RoundedRectangle(cornerRadius: KioskRadius.hero)
                .stroke(tint.opacity(0.45), lineWidth: 1)
        )
        .animation(reduceMotion ? nil : .spring(response: 0.3, dampingFraction: 0.85), value: accepted)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accepted.map { "Added \($0.title). \($0.progress)." } ?? "\(headline). \(detail)")
    }

    private func acceptedView(_ accepted: KioskAcceptedScan) -> some View {
        KioskScanAcceptedView(accepted: accepted, reduceMotion: reduceMotion)
            .frame(minHeight: 268)
    }
}

/// The moment a scan lands, at counter-reading size.
///
/// Shared by all three scan flows. Checkout swaps its scan target for this;
/// pickup and return swap their progress ring. Those two kept only a caption
/// banner and a new checklist tick when this was checkout-only — the same
/// unreadable confirmation the checkout screen had just stopped having.
struct KioskScanAcceptedView: View {
    let accepted: KioskAcceptedScan
    var reduceMotion: Bool = false

    var body: some View {
        VStack(spacing: KioskSpacing.sm) {
            ZStack {
                Circle()
                    .fill(KioskStatus.ok.opacity(0.16))
                    .frame(width: 132, height: 132)
                Image(systemName: "checkmark")
                    .font(.system(size: 62, weight: .bold))
                    .foregroundStyle(KioskStatus.ok)
            }
            .accessibilityHidden(true)

            Text(accepted.title)
                .font(.gothamBlack(size: 40))
                .foregroundStyle(KioskText.primary)
                .lineLimit(1)
                .minimumScaleFactor(0.5)

            if let subtitle = accepted.subtitle {
                Text(subtitle)
                    .font(KioskType.rowDetail)
                    .foregroundStyle(KioskText.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }

            Text(accepted.progress)
                .font(KioskType.chip)
                .foregroundStyle(KioskStatus.ok)
                .padding(.horizontal, 12)
                .padding(.vertical, 5)
                .background(KioskStatus.ok.opacity(0.14), in: Capsule())
                .padding(.top, 2)
        }
        .transition(reduceMotion ? .opacity : .opacity.combined(with: .scale(scale: 0.94)))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(accepted.title). \(accepted.progress)")
    }
}

/// Reports the hidden HID sink's real first-responder state. Scan screens must
/// never claim the hand scanner is ready merely because the field is mounted.
struct KioskScannerReadinessBadge: View {
    let isReady: Bool
    var lastScanAt: Date?
    /// When false, no HID keyboard is paired at all — the scanner is off,
    /// asleep, or out of range. Distinct from "mounted but not focused",
    /// because the fix is different: charge/wake the gun vs. tap the screen.
    var isHardwareConnected: Bool = true
    var onTap: (() -> Void)?

    var body: some View {
        Group {
            if let onTap {
                Button(action: onTap) { content }
                    .buttonStyle(.plain)
            } else {
                content
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Scanner status, \(label)")
    }

    private var content: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(statusColor)
                .frame(width: 8, height: 8)
                .accessibilityHidden(true)
            Text(label)
                .font(.caption.weight(.semibold))
                .foregroundStyle(KioskText.secondary)
            if onTap != nil {
                Image(systemName: "info.circle")
                    .font(.caption)
                    .foregroundStyle(KioskText.muted)
                    .accessibilityHidden(true)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .kioskCard(KioskSurface.card, radius: KioskRadius.md, stroke: KioskStroke.hairline)
    }

    /// Armed is armed. This used to read blue before the first scan and green
    /// after it, which made a healthy scanner look like two different states
    /// and put a third color on "Scanner ready" alongside the shell pill and
    /// the detail sheet. The label already carries scan recency; the dot only
    /// answers "can I scan right now?".
    private var statusColor: Color {
        guard isHardwareConnected else { return KioskStatus.problem }
        return isReady ? KioskStatus.ok : KioskStatus.attention
    }

    private var label: String {
        guard isHardwareConnected else { return "No scanner connected" }
        guard isReady else { return "Scanner reconnecting" }
        guard let lastScanAt else { return "Scanner ready" }
        let seconds = max(0, Int(Date().timeIntervalSince(lastScanAt)))
        if seconds < 5 { return "Scan received" }
        if seconds < 60 { return "Last scan \(seconds)s ago" }
        return "Last scan \(seconds / 60)m ago"
    }
}

// MARK: Quarter-hour time input

/// Shared kiosk return-time policy. Custody times are chosen in quarter-hour
/// steps, and generated suggestions always round forward so a smart default
/// never promises an earlier return than the source event or safety minimum.
enum KioskQuarterHour {
    static let minuteInterval = 15
    private static let secondsPerInterval = TimeInterval(minuteInterval * 60)

    static func roundedUp(_ date: Date) -> Date {
        let intervals = date.timeIntervalSinceReferenceDate / secondsPerInterval
        return Date(timeIntervalSinceReferenceDate: ceil(intervals) * secondsPerInterval)
    }

    static func clamped(_ date: Date, minimum: Date) -> Date {
        roundedUp(max(date, minimum))
    }
}

/// Native compact time control with a real 15-minute wheel interval. SwiftUI's
/// `DatePicker` does not expose `UIDatePicker.minuteInterval`, which previously
/// made staff scroll through minute-by-minute values for a custody timestamp.
struct KioskQuarterHourTimePicker: UIViewRepresentable {
    @Binding var selection: Date
    var minimumDate: Date?
    var accessibilityLabel = "Return time, 15-minute increments"

    func makeUIView(context: Context) -> UIDatePicker {
        let picker = UIDatePicker()
        picker.datePickerMode = .time
        picker.preferredDatePickerStyle = .compact
        picker.minuteInterval = KioskQuarterHour.minuteInterval
        picker.tintColor = UIColor(Color.kioskRed)
        picker.addTarget(context.coordinator, action: #selector(Coordinator.valueChanged(_:)), for: .valueChanged)
        picker.accessibilityLabel = accessibilityLabel
        return picker
    }

    func updateUIView(_ picker: UIDatePicker, context: Context) {
        context.coordinator.parent = self
        picker.minimumDate = minimumDate
        picker.accessibilityLabel = accessibilityLabel
        if abs(picker.date.timeIntervalSince(selection)) >= 1 {
            picker.setDate(selection, animated: false)
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    @MainActor
    final class Coordinator: NSObject {
        var parent: KioskQuarterHourTimePicker

        init(parent: KioskQuarterHourTimePicker) {
            self.parent = parent
        }

        @objc func valueChanged(_ picker: UIDatePicker) {
            parent.selection = KioskQuarterHour.roundedUp(picker.date)
        }
    }
}

// MARK: Choice chip

/// A single-tap choice on the kiosk: return-time presets, purpose shortcuts.
/// Native glass carries the selected state so the chip reads as a control
/// rather than another dark card, and selection is brand red because choosing
/// is an action — not a status.
struct KioskChoiceChip: View {
    let title: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Group {
            // `.glass` and `.glassProminent` are distinct types, so this has to
            // branch rather than pick a style inline.
            if isSelected {
                button.buttonStyle(.glassProminent).tint(Color.kioskRed)
            } else {
                button.buttonStyle(.glass).tint(KioskText.primary)
            }
        }
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
        .accessibilityLabel(title)
    }

    private var button: some View {
        Button(action: action) {
            Text(title)
                .font(KioskType.chip)
                .foregroundStyle(isSelected ? Color.white : KioskText.secondary)
                .padding(.horizontal, 16)
                .padding(.vertical, 11)
        }
    }
}

/// Wraps its children onto as many rows as they need. `HStack` forced a single
/// row that clipped or squeezed chips on narrower kiosk scenes.
struct FlowingChips: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var rowWidth: CGFloat = 0
        var totalHeight: CGFloat = 0
        var rowHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if rowWidth > 0, rowWidth + spacing + size.width > maxWidth {
                totalHeight += rowHeight + spacing
                rowWidth = size.width
                rowHeight = size.height
            } else {
                rowWidth += rowWidth > 0 ? spacing + size.width : size.width
                rowHeight = max(rowHeight, size.height)
            }
        }
        return CGSize(width: maxWidth == .infinity ? rowWidth : maxWidth, height: totalHeight + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var rowHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX {
                x = bounds.minX
                y += rowHeight + spacing
                rowHeight = 0
            }
            subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}

// MARK: Feedback banner

/// Tinted icon + message banner used for scan results across every flow and
/// the camera overlay. Replaces four near-identical private copies.
struct KioskFeedbackBanner: View {
    let tone: KioskBannerTone
    let message: String

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: tone.icon).accessibilityHidden(true)
            Text(message).font(.subheadline.weight(.medium))
        }
        .foregroundStyle(tone.color)
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
        .background(tone.color.opacity(0.15), in: RoundedRectangle(cornerRadius: KioskRadius.md))
        .overlay(
            RoundedRectangle(cornerRadius: KioskRadius.md)
                .stroke(tone.color.opacity(0.4), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}

// MARK: Progress ring

/// Count-of-total scan progress ring. In-progress stroke is blue (active
/// progress) and turns green on completion -- one rule for both pickup and
/// return, which previously used red and blue respectively.
struct KioskProgressRing: View {
    let count: Int
    let total: Int
    let isComplete: Bool
    let reduceMotion: Bool
    var inProgressColor: Color = Color.statusText(.blue)
    var size: CGFloat = 176
    var accessibilityText: String?

    var body: some View {
        ZStack {
            Circle()
                .stroke(KioskStroke.divider, lineWidth: 10)
            Circle()
                .trim(from: 0, to: total > 0 ? CGFloat(count) / CGFloat(total) : 0)
                .stroke(
                    isComplete ? Color.statusText(.green) : inProgressColor,
                    style: StrokeStyle(lineWidth: 10, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))
                .animation(reduceMotion ? nil : .spring(response: 0.4), value: count)
            VStack(spacing: 2) {
                Text("\(count)")
                    .font(.system(size: 52, weight: .bold, design: .rounded))
                    .foregroundStyle(KioskText.primary)
                    .contentTransition(.numericText())
                    .animation(reduceMotion ? nil : .easeInOut(duration: 0.25), value: count)
                    .monospacedDigit()
                Text("of \(total)")
                    .font(.subheadline)
                    .foregroundStyle(KioskText.tertiary)
            }
        }
        .frame(width: size, height: size)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText ?? "\(count) of \(total)")
    }
}

// MARK: Completion CTA

/// Primary bottom action for the scan flows (Complete Checkout / Confirm
/// Pickup / Complete Return). Native prominent glass carries the shared
/// interactive hierarchy while disabled and busy states stay system-driven.
struct KioskCompletionButton: View {
    let title: String
    var icon: String?
    let isEnabled: Bool
    let isBusy: Bool
    var busyTitle: String = "Processing..."
    let accessibilityLabel: String
    let action: () -> Void

    private var isActive: Bool { isEnabled && !isBusy }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                if !isBusy, let icon {
                    Image(systemName: icon)
                        .font(.headline)
                        .accessibilityHidden(true)
                }
                Text(isBusy ? busyTitle : title)
                    .font(.headline)
                if isBusy {
                    ProgressView().tint(.white).scaleEffect(0.8)
                }
            }
            .foregroundStyle(KioskText.primary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
        }
        .buttonStyle(.glassProminent)
        .tint(Color.kioskRed)
        .controlSize(.large)
        .disabled(!isActive)
        .accessibilityLabel(accessibilityLabel)
    }
}

// MARK: Checklist row

/// A single scannable line in the pickup/return checklist. `strikethroughWhenDone`
/// is true for returns (the item is leaving) and false for pickups (the item is
/// being confirmed into the student's hands).
struct KioskChecklistRow: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let name: String
    let tag: String
    let isDone: Bool
    var isBattery: Bool = false
    var strikethroughWhenDone: Bool = false

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: isDone ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(isDone ? Color.statusText(.green) : KioskText.muted)
                .font(.title3)
                .frame(width: 28)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(tag)
                        .font(.gothamBold(size: 16))
                        .foregroundStyle(isDone ? KioskText.tertiary : KioskText.primary)
                        .strikethrough(isDone && strikethroughWhenDone, color: KioskText.muted)
                    if isBattery {
                        Image(systemName: "battery.100percent")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(Color.statusText(.orange))
                            .accessibilityLabel("Battery unit")
                    }
                }
                // Hide the name line when it just repeats the tag so
                // rows stay scannable.
                if tag.caseInsensitiveCompare(name) != .orderedSame {
                    Text(name)
                        .font(.caption)
                        .foregroundStyle(KioskText.tertiary)
                }
            }
            Spacer()
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 16)
        .animation(reduceMotion ? nil : .spring(response: 0.25, dampingFraction: 1), value: isDone)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(tag), \(name), \(isDone ? "done" : "pending")")
    }
}

// MARK: Checklist progress summary

/// "n of m <verb>" line + thin progress bar for the pickup/return checklist
/// header. In-progress fill is blue (matching `KioskProgressRing`), green when
/// complete. Shared by pickup ("confirmed") and return ("returned").
struct ChecklistProgressSummary: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let done: Int
    let total: Int
    let verb: String
    let complete: Bool
    var inProgressColor: Color = Color.statusText(.blue)

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("\(done) of \(total) \(verb)")
                .font(.caption.weight(.semibold).monospacedDigit())
                .foregroundStyle(complete ? Color.statusText(.green) : KioskText.secondary)
                .contentTransition(.numericText())
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule()
                        .fill(KioskStroke.divider)
                    Capsule()
                        .fill(complete ? Color.statusText(.green) : inProgressColor)
                        .frame(width: total > 0 ? geo.size.width * CGFloat(done) / CGFloat(total) : 0)
                        .animation(reduceMotion ? nil : .spring(response: 0.4, dampingFraction: 1), value: done)
                }
            }
            .frame(height: 4)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(done) of \(total) \(verb)")
    }
}

// MARK: Battery scan status

/// A scanned numbered battery unit, decoupled from the pickup/return payload
/// types so both flows feed the shared chips/status views.
struct KioskScannedUnit: Identifiable, Equatable {
    let id: String
    let tag: String
}

/// Numbered-battery scan progress card shown above the flow CTA. `unitsHeader`
/// differs by flow ("Scanned units" vs "Returned units").
struct KioskBatteryScanStatus: View {
    let title: String
    let count: Int
    let total: Int
    let pendingCopy: String
    let completeCopy: String
    let progressCopy: String
    let unitsHeader: String
    let scannedUnits: [KioskScannedUnit]

    private var complete: Bool { count >= total && total > 0 }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                Image(systemName: complete ? "battery.100percent" : "battery.25percent")
                    .font(.title3)
                    .foregroundStyle(complete ? Color.statusText(.green) : Color.statusText(.orange))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(KioskText.primary)
                    Text(complete ? completeCopy : progressCopy)
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(KioskText.tertiary)
                    if !complete {
                        Text(pendingCopy)
                            .font(.caption2)
                            .foregroundStyle(KioskText.tertiary)
                    }
                }
                Spacer()
            }
            if !scannedUnits.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text(unitsHeader)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(KioskText.tertiary)
                    KioskUnitChips(units: scannedUnits)
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .kioskCard(KioskSurface.card, stroke: KioskStroke.hairline)
        .accessibilityElement(children: .combine)
    }
}

/// Wrapping summary of scanned numbered-unit tags.
struct KioskUnitChips: View {
    let units: [KioskScannedUnit]

    private var unitSummary: String {
        units.map(\.tag).joined(separator: "  •  ")
    }

    var body: some View {
        Text(unitSummary)
            .font(.caption2.monospaced().weight(.semibold))
            .foregroundStyle(Color.statusText(.green))
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(
                Color.statusText(.green).opacity(0.12),
                in: RoundedRectangle(cornerRadius: KioskRadius.sm)
            )
            .overlay(
                RoundedRectangle(cornerRadius: KioskRadius.sm)
                    .stroke(Color.statusText(.green).opacity(0.25), lineWidth: 1)
            )
            .accessibilityLabel(units.map(\.tag).joined(separator: ", "))
    }
}

// MARK: Error state

/// Connection/load error with an optional message and a brand retry button.
/// Replaces the per-flow `wifi.exclamationmark` + retry blocks.
struct KioskErrorState: View {
    var icon: String = "wifi.exclamationmark"
    let title: String
    var message: String?
    var retryTitle: String = "Retry"
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: icon)
                .font(.system(size: 44))
                .foregroundStyle(KioskText.tertiary)
                .accessibilityHidden(true)
            Text(title)
                .font(.headline)
                .foregroundStyle(KioskText.primary)
                .multilineTextAlignment(.center)
            if let message {
                Text(message)
                    .font(.subheadline)
                    .foregroundStyle(KioskText.tertiary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
            }
            Button(action: onRetry) {
                Text(retryTitle)
                    .font(.headline)
                    .foregroundStyle(KioskText.primary)
                    .padding(.horizontal, 24)
                    .frame(minHeight: 44)
                    .background(Color.kioskRed, in: Capsule())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(retryTitle)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .contain)
    }
}

// MARK: Skeleton

/// A shimmering placeholder block for loading states — softer than a bare
/// spinner and matches the dark kiosk surfaces. Respects Reduce Motion (it
/// holds a static dim fill instead of animating).
struct KioskSkeletonBox: View {
    var cornerRadius: CGFloat = KioskRadius.md
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var animate = false

    var body: some View {
        RoundedRectangle(cornerRadius: cornerRadius)
            .fill(KioskSurface.cardRaised)
            .overlay {
                if !reduceMotion {
                    GeometryReader { geo in
                        RoundedRectangle(cornerRadius: cornerRadius)
                            .fill(
                                LinearGradient(
                                    colors: [.clear, Color.white.opacity(0.07), .clear],
                                    startPoint: .leading,
                                    endPoint: .trailing
                                )
                            )
                            .frame(width: geo.size.width * 0.6)
                            .offset(x: animate ? geo.size.width : -geo.size.width * 0.6)
                    }
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.linear(duration: 1.15).repeatForever(autoreverses: false)) {
                    animate = true
                }
            }
            .accessibilityHidden(true)
    }
}

// MARK: Avatar

/// Async avatar with an initials fallback, used by the roster, student hub,
/// active-checkout rows, and event worker rows. Initials type scales with size.
struct KioskAvatar: View {
    let url: String?
    let initials: String
    var size: CGFloat = 42
    var placeholderFill: Color = KioskSurface.placeholder
    @ScaledMetric(relativeTo: .caption2) private var minimumInitialsSize: CGFloat = 11

    var body: some View {
        Group {
            if let url, let resolved = URL(string: url) {
                AsyncImage(url: resolved) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().scaledToFill()
                    default:
                        initialsView
                    }
                }
            } else {
                initialsView
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
    }

    private var initialsView: some View {
        Circle()
            .fill(placeholderFill)
            .overlay {
                Text(initials)
                    .font(.system(size: max(size * 0.4, minimumInitialsSize), weight: .bold))
                    .foregroundStyle(KioskText.primary)
            }
    }
}

// MARK: Press style

/// Subtle press-scale + dim for kiosk tap targets (roster tiles, stat tiles,
/// event rows). Gives tactile feedback on the iPad without shifting layout, and
/// reads as "plain" otherwise — a drop-in for `.buttonStyle(.plain)` on the
/// kiosk's large touch surfaces. Honors Reduce Motion.
struct KioskPressStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var scale: CGFloat = 0.97

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? scale : 1)
            .opacity(configuration.isPressed ? 0.9 : 1)
            .animation(reduceMotion ? nil : .spring(response: 0.25, dampingFraction: 0.7), value: configuration.isPressed)
    }
}

// MARK: Keyboard hint

/// Centered "Double-tap trigger to enable keyboard" popup for kiosk text input.
///
/// When a paired HID scanner is awake, iPadOS counts it as a hardware keyboard
/// and suppresses the software one — the field takes focus and nothing comes
/// up, which reads as "typing is broken". This watches keyboard frame
/// notifications while a field is focused; if no real keyboard lands within a
/// short grace, it says what to do about it, and it clears itself the instant a
/// keyboard appears or focus ends. The missing keyboard is the authoritative
/// signal: some scanner models suppress software input without being exposed
/// through `GCKeyboard`, so hardware monitoring must not gate this recovery.
///
/// It is mounted at screen level and centered rather than tucked under the
/// field, which two earlier placements ruled out. Anchored above the field the
/// card covered the field's own "BOOKING NAME · REQUIRED" label — hiding what
/// to type in order to explain how to type it. Placed inline beneath it, the
/// card was taller than the advisory line it replaced, and on a checkout step
/// with no spare height that pushed the committed due-back stamp off the
/// bottom. Centered, it costs no layout at all and is the most legible thing on
/// the screen, which is what an "input is not working" message should be.
///
/// `allowsHitTesting(false)`: the fix is a physical double-tap on the scanner
/// trigger, so the popup never needs to take a touch — and a kiosk must not put
/// an undismissable scrim between someone and the controls underneath it.
struct KioskKeyboardHint: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// True while a kiosk text field holds focus. Screens feed this from
    /// `store.scanner.isEditing`, which the fields already maintain.
    let isFieldFocused: Bool

    @State private var keyboardVisible = false
    @State private var showTip = KioskKeyboardHint.fixtureForcesTip

    /// Capture-only seed. A simulator cannot attach a HID keyboard without the
    /// Simulator app's own ⌘⇧K toggle, so the state this popup exists for is
    /// unreachable under automation. Always false in a real build.
    static var fixtureForcesTip: Bool {
        #if DEBUG
        return KioskFixtureScenario.active == .keyboardTip
        #else
        return false
        #endif
    }

    private static let message = "Double-tap trigger to enable keyboard"
    private static let detail = "The hand scanner is acting as this iPad's keyboard."

    private var waitingForKeyboard: Bool {
        #if DEBUG
        if Self.fixtureForcesTip { return true }
        #endif
        return isFieldFocused && !keyboardVisible
    }

    var body: some View {
        Group {
            if showTip {
                ZStack {
                    KioskScrim.modal.opacity(0.55).ignoresSafeArea()

                    VStack(spacing: KioskSpacing.md) {
                        Image(systemName: "keyboard.badge.ellipsis")
                            .font(.system(size: 46, weight: .semibold))
                            .foregroundStyle(Color.kioskRedGlyph)
                            .frame(width: 92, height: 92)
                            .background(Color.kioskRedGlyph.opacity(0.14), in: Circle())
                            .accessibilityHidden(true)

                        Text(Self.message)
                            .font(.gothamBold(size: 28))
                            .foregroundStyle(KioskText.primary)
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)

                        Text(Self.detail)
                            .font(KioskType.body)
                            .foregroundStyle(KioskText.tertiary)
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(.horizontal, 40)
                    .padding(.vertical, 34)
                    .frame(maxWidth: 520)
                    .background(KioskSurface.modal, in: RoundedRectangle(cornerRadius: KioskRadius.modal))
                    .overlay(
                        RoundedRectangle(cornerRadius: KioskRadius.modal)
                            .stroke(Color.kioskRedGlyph.opacity(0.55), lineWidth: 1)
                    )
                    .shadow(color: .black.opacity(0.6), radius: 30, y: 12)
                }
                .transition(
                    reduceMotion
                        ? .opacity
                        : .opacity.combined(with: .scale(scale: 0.92))
                )
                .accessibilityElement(children: .combine)
                .accessibilityLabel("\(Self.message). \(Self.detail)")
            }
        }
        .allowsHitTesting(false)
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardDidShowNotification)) { note in
            keyboardVisible = Self.isRealKeyboard(note)
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in
            keyboardVisible = false
        }
        .task(id: waitingForKeyboard) {
            if waitingForKeyboard {
                // Grace so a normally-appearing keyboard never flashes the tip.
                try? await Task.sleep(nanoseconds: 750_000_000)
                guard !Task.isCancelled else { return }
                withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.2)) { showTip = true }
                UIAccessibility.post(notification: .announcement, argument: Self.message)
            } else if showTip {
                withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.2)) { showTip = false }
            }
        }
    }

    /// The hardware-keyboard assistant strip also posts keyboard notifications
    /// with a short frame — only a real software keyboard should count.
    private static func isRealKeyboard(_ note: Notification) -> Bool {
        guard let frame = note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else {
            return false
        }
        return frame.height > 120
    }
}
