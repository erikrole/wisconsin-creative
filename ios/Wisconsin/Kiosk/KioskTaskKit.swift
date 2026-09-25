import SwiftUI

// MARK: - Task-screen kit (2026-09-25 redesign)
//
// The shared pieces every redesigned kiosk screen is assembled from, measured
// from the 1180×820pt design canvas (`tasks/kiosk-redesign-brief-2026-09-25.md`):
//
//   header      task name, then person and context; time and Back on the right
//   scan area   context card with Edit, the stage, the one white primary pill
//   list        a 500pt panel on the right, sectioned by what the gear is doing
//
// Pure presentation. Flows own their state and pass values in.

// MARK: Motion

/// The motion vocabulary from canvas frame J4. Reduce Motion turns every
/// movement into a 150 ms fade.
enum KioskMotion {
    static let fadeUnderReduceMotion = Animation.easeInOut(duration: 0.15)

    /// A new confirmation: the check scales in 0.9 → 1 over 200 ms.
    static func confirm(_ reduceMotion: Bool) -> Animation {
        reduceMotion ? fadeUnderReduceMotion : .easeOut(duration: 0.2)
    }

    /// Screen cross-fade (200 ms).
    static func screen(_ reduceMotion: Bool) -> Animation {
        reduceMotion ? fadeUnderReduceMotion : .easeInOut(duration: 0.2)
    }

    /// Sheet slide-up (280 ms).
    static func sheet(_ reduceMotion: Bool) -> Animation {
        reduceMotion ? fadeUnderReduceMotion : .easeOut(duration: 0.28)
    }

    static func confirmTransition(_ reduceMotion: Bool) -> AnyTransition {
        reduceMotion ? .opacity : .opacity.combined(with: .scale(scale: 0.9))
    }
}

/// A single 6 px shake for a rejected scan. Animate `shakes` from n to n + 1.
struct KioskShakeEffect: GeometryEffect {
    var shakes: CGFloat
    var animatableData: CGFloat {
        get { shakes }
        set { shakes = newValue }
    }

    func effectValue(size: CGSize) -> ProjectionTransform {
        ProjectionTransform(CGAffineTransform(translationX: 6 * sin(shakes * .pi * 2), y: 0))
    }
}

// MARK: Header

/// The top band shared by hubs and task screens: an optional portrait, the
/// title, the person-and-context line, then the time and Back on the right.
struct KioskTaskHeader: View {
    let title: String
    var subtitle: String?
    var avatarURL: String?
    var avatarInitials: String?
    var backTitle: String = "Back"
    var backAccessibilityLabel: String = "Back"
    var onBack: (() -> Void)?

    var body: some View {
        HStack(alignment: .top, spacing: 18) {
            if let avatarInitials {
                KioskAvatar(url: avatarURL, initials: avatarInitials, size: 76)
                    .accessibilityHidden(true)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(KioskType.taskTitle)
                    .foregroundStyle(KioskText.primary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .accessibilityAddTraits(.isHeader)
                if let subtitle {
                    Text(subtitle)
                        .font(KioskType.headerDetail)
                        .foregroundStyle(KioskText.secondary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 16)
            HStack(spacing: 16) {
                KioskHeaderClock()
                if let onBack {
                    Button(backTitle, action: onBack)
                        .frame(minHeight: 48)
                        .kioskButtonRole(.secondary)
                        .accessibilityLabel(backAccessibilityLabel)
                }
            }
            .padding(.top, 14)
        }
        .padding(.horizontal, KioskSpacing.xl)
        .padding(.top, KioskSpacing.screenTop)
        .frame(height: 132, alignment: .top)
    }
}

/// "2:18 PM" beside Back. Minute resolution; the home clock owns seconds.
struct KioskHeaderClock: View {
    var body: some View {
        TimelineView(.everyMinute) { context in
            Text(context.date, format: .dateTime.hour().minute())
                .font(KioskType.headerClock)
                .foregroundStyle(KioskText.tertiary)
        }
        .accessibilityHidden(true)
    }
}

// MARK: Task scaffold

/// Header over a two-column body: the scan area on the left, the 500pt list
/// panel on the right, separated by a hairline.
struct KioskTaskScaffold<Main: View, Panel: View>: View {
    let header: KioskTaskHeader
    var panelWidth: CGFloat = KioskTaskScaffoldMetrics.panelWidth
    @ViewBuilder var main: () -> Main
    @ViewBuilder var panel: () -> Panel

    var body: some View {
        VStack(spacing: 0) {
            header
            HStack(spacing: 0) {
                VStack(spacing: 14) { main() }
                    .padding(.leading, KioskSpacing.xl)
                    .padding(.trailing, KioskSpacing.lg)
                    .padding(.top, 4)
                    .padding(.bottom, KioskSpacing.screenBottom)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                Rectangle()
                    .fill(KioskStroke.divider)
                    .frame(width: 1)
                VStack(alignment: .leading, spacing: 14) { panel() }
                    .padding(.leading, KioskSpacing.lg)
                    .padding(.trailing, KioskSpacing.xl)
                    .padding(.top, 4)
                    .padding(.bottom, KioskSpacing.screenBottom)
                    .frame(width: panelWidth, alignment: .topLeading)
                    .frame(maxHeight: .infinity, alignment: .top)
            }
            .padding(.top, 16)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }
}

enum KioskTaskScaffoldMetrics {
    static let panelWidth: CGFloat = 500
}

// MARK: Section header

/// "TAKING OUT  new checkout ··· 3": an overline, an optional detail, and a
/// count, colored by what the section is doing.
struct KioskSectionHeader: View {
    let title: String
    var detail: String?
    var count: String?
    var section: KioskSection?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(title.uppercased())
                .font(KioskType.overline)
                .tracking(KioskType.overlineTracking)
                .foregroundStyle(section?.text ?? KioskText.tertiary)
            if let detail {
                Text(detail)
                    .font(KioskType.meta)
                    .foregroundStyle(KioskText.tertiary)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            if let count {
                Text(count)
                    .font(KioskType.chipStrong)
                    .foregroundStyle(section?.text ?? KioskText.muted)
            }
        }
        .padding(.horizontal, 2)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

// MARK: List card

/// A rounded card holding rows separated by hairlines.
struct KioskListCard<Data: RandomAccessCollection, Row: View>: View where Data.Element: Identifiable {
    let items: Data
    @ViewBuilder var row: (Data.Element) -> Row

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                row(item)
                if index < items.count - 1 {
                    Rectangle().fill(KioskStroke.divider).frame(height: 1)
                }
            }
        }
        .kioskCard()
        .clipShape(RoundedRectangle(cornerRadius: KioskRadius.xl))
    }
}

// MARK: Check mark

/// The 22pt circle leading every item row: filled in the section's accent with
/// a check once scanned, an outline while still to scan.
struct KioskCheckMark: View {
    let isDone: Bool
    var section: KioskSection = .takingOut
    var size: CGFloat = 22

    var body: some View {
        ZStack {
            if isDone {
                Circle().fill(section.accent)
                Image(systemName: "checkmark")
                    .font(.system(size: size * 0.55, weight: .heavy))
                    .foregroundStyle(KioskText.onPrimary)
            } else {
                Circle().strokeBorder(KioskStroke.pending, lineWidth: 2)
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

// MARK: Item row

/// One line in a task list: check, tag, model, and an optional trailing
/// control or note ("Remove", "Not in kit", "Just added").
struct KioskItemRow<Trailing: View>: View {
    let tag: String
    var name: String?
    let isDone: Bool
    var section: KioskSection = .takingOut
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        HStack(spacing: 12) {
            KioskCheckMark(isDone: isDone, section: section)
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(tag)
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(KioskText.primary)
                    .lineLimit(1)
                if let name {
                    Text(name)
                        .font(KioskType.meta)
                        .foregroundStyle(KioskText.secondary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            trailing()
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(tag)\(name.map { ", \($0)" } ?? ""), \(isDone ? "scanned" : "not scanned yet")")
    }
}

extension KioskItemRow where Trailing == EmptyView {
    init(tag: String, name: String? = nil, isDone: Bool, section: KioskSection = .takingOut) {
        self.init(tag: tag, name: name, isDone: isDone, section: section, trailing: { EmptyView() })
    }
}

/// The small outlined "Remove" pill on a row.
struct KioskRowRemoveButton: View {
    let accessibilityLabel: String
    let action: () -> Void

    var body: some View {
        Button("Remove", action: action)
            .font(KioskType.chip)
            .kioskButtonRole(.quiet)
            .accessibilityLabel(accessibilityLabel)
    }
}

/// A quiet note at the end of a row ("Not in kit", "Just added").
struct KioskRowNote: View {
    let text: String
    var color: Color = KioskText.tertiary

    var body: some View {
        Text(text)
            .font(KioskType.chip)
            .foregroundStyle(color)
    }
}

// MARK: Battery row

/// A numbered-battery family: "V-Mount batteries · 1 of 2", then each unit's
/// number, filled once scanned and outlined while still to scan. Before any
/// unit is scanned against a reservation there are no numbers yet, only the
/// count ("numbers are saved as you scan them").
struct KioskBatteryRow: View {
    struct Unit: Identifiable, Equatable {
        let id: String
        let label: String
        let isScanned: Bool
    }

    let title: String
    let scanned: Int
    let total: Int
    var units: [Unit] = []
    var note: String?
    var section: KioskSection = .takingOut

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                Image(systemName: "battery.75percent")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(scanned >= total && total > 0 ? section.accent : KioskText.tertiary)
                    .frame(width: 22)
                Text("\(title) · \(scanned) of \(total)")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(KioskText.primary)
                Spacer(minLength: 0)
            }
            if !units.isEmpty {
                FlowingChips(spacing: 6) {
                    ForEach(units) { unit in
                        KioskBatteryUnitChip(label: unit.label, isScanned: unit.isScanned, section: section)
                    }
                }
                .padding(.leading, 32)
            }
            if let note {
                Text(note)
                    .font(KioskType.meta)
                    .foregroundStyle(KioskText.tertiary)
                    .padding(.leading, 32)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .accessibilityElement(children: .combine)
    }
}

struct KioskBatteryUnitChip: View {
    let label: String
    let isScanned: Bool
    var section: KioskSection = .takingOut

    var body: some View {
        Text(label)
            .font(KioskType.chipStrong)
            .foregroundStyle(isScanned ? KioskText.onPrimary : KioskText.secondary)
            .padding(.horizontal, 10)
            .frame(minWidth: 44, minHeight: 30)
            .background {
                if isScanned {
                    Capsule().fill(section.accent)
                } else {
                    Capsule().strokeBorder(KioskStroke.pending, lineWidth: 1)
                }
            }
            .accessibilityLabel("\(label), \(isScanned ? "scanned" : "still to scan")")
    }
}

// MARK: Context card

/// What this task is for and when it's due, with Edit where it applies.
struct KioskContextCard: View {
    let title: String
    var detail: String?
    var editTitle: String = "Edit"
    var onEdit: (() -> Void)?

    var body: some View {
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(KioskType.cardTitle)
                    .foregroundStyle(KioskText.primary)
                    .lineLimit(1)
                if let detail {
                    Text(detail)
                        .font(KioskType.meta)
                        .foregroundStyle(KioskText.tertiary)
                        .lineLimit(2)
                }
            }
            Spacer(minLength: 8)
            if let onEdit {
                Button(editTitle, action: onEdit)
                    .kioskButtonRole(.secondary)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .kioskCard()
    }
}

// MARK: Stages

/// The scan area before anything has landed: brackets, the ask, and the
/// camera fallback. `status` replaces the detail line when the scanner needs
/// a word ("Scanner is asleep. Press its trigger to wake it.") — a sleeping
/// scanner is normal, so it never turns red.
struct KioskScanPrompt: View {
    let title: String
    let detail: String
    var status: String?
    var section: KioskSection = .takingOut
    var onCamera: (() -> Void)?

    var body: some View {
        VStack(spacing: 22) {
            KioskScanTarget(tint: section.accent, width: 176, height: 112)
            VStack(spacing: 8) {
                Text(title)
                    .font(.system(size: 30, weight: .bold))
                    .foregroundStyle(KioskText.primary)
                    .multilineTextAlignment(.center)
                Text(status ?? detail)
                    .font(KioskType.body)
                    .foregroundStyle(status == nil ? KioskText.tertiary : KioskStatus.attention)
                    .multilineTextAlignment(.center)
            }
            if let onCamera {
                Button("Use the iPad camera", action: onCamera)
                    .kioskButtonRole(.quiet)
            }
        }
        .padding(26)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .kioskCard(radius: KioskRadius.hero)
    }
}

/// The confirmation a scan becomes: a section-colored check, what happened,
/// and Undo. Every scan confirmation offers Undo.
struct KioskConfirmationStage: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let section: KioskSection
    let title: String
    var detail: String?
    var hint: String?
    var onUndo: (() -> Void)?

    var body: some View {
        VStack(spacing: 14) {
            ZStack {
                Circle().fill(section.accent)
                Image(systemName: "checkmark")
                    .font(.system(size: 34, weight: .heavy))
                    .foregroundStyle(KioskText.onPrimary)
            }
            .frame(width: 72, height: 72)
            .transition(KioskMotion.confirmTransition(reduceMotion))
            .accessibilityHidden(true)
            Text(title)
                .font(KioskType.stageTitle)
                .foregroundStyle(KioskText.primary)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .minimumScaleFactor(0.7)
            if let detail {
                Text(detail)
                    .font(.system(size: 17))
                    .foregroundStyle(KioskText.secondary)
                    .multilineTextAlignment(.center)
            }
            if let hint {
                Text(hint)
                    .font(KioskType.meta)
                    .foregroundStyle(KioskText.muted)
                    .multilineTextAlignment(.center)
            }
            if let onUndo {
                Button(action: onUndo) {
                    Text("Undo")
                        .font(KioskType.chipStrong)
                        .foregroundStyle(section.stageSecondary)
                        .padding(.horizontal, 16)
                        .frame(minHeight: 40)
                        .overlay(Capsule().stroke(section.stageStroke, lineWidth: 1))
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .frame(minHeight: 44)
                .accessibilityLabel("Undo \(title)")
            }
        }
        .padding(26)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .kioskCard(section.stageFill, radius: KioskRadius.hero, stroke: section.stageStroke)
        .accessibilityElement(children: .contain)
    }
}

/// A stage that stops the flow to say something: "NOT ADDED" for a blocked
/// scan (red, with a single shake), "BEFORE YOU CHECK OUT" for a question
/// (amber, no shake). Extra content — alternatives, actions — goes below.
struct KioskNoticeStage<Content: View>: View {
    let section: KioskSection
    let overline: String
    let title: String
    var message: String?
    var showsAlertGlyph: Bool = false
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 12) {
                if showsAlertGlyph {
                    Text("!")
                        .font(.system(size: 24, weight: .heavy))
                        .foregroundStyle(KioskText.onPrimary)
                        .frame(width: 44, height: 44)
                        .background(section.accent, in: Circle())
                        .accessibilityHidden(true)
                }
                Text(overline.uppercased())
                    .font(KioskType.overline)
                    .tracking(KioskType.overlineTracking)
                    .foregroundStyle(section.text)
            }
            VStack(alignment: .leading, spacing: 8) {
                Text(title)
                    .font(KioskType.sheetTitle)
                    .foregroundStyle(KioskText.primary)
                    .fixedSize(horizontal: false, vertical: true)
                if let message {
                    Text(message)
                        .font(KioskType.body)
                        .foregroundStyle(KioskText.secondary)
                        .lineSpacing(3)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            content()
        }
        .padding(26)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .kioskCard(section.stageFill, radius: KioskRadius.hero, stroke: section.stageStroke)
        .accessibilityElement(children: .contain)
    }
}

extension KioskNoticeStage where Content == EmptyView {
    init(section: KioskSection, overline: String, title: String, message: String? = nil, showsAlertGlyph: Bool = false) {
        self.init(section: section, overline: overline, title: title, message: message, showsAlertGlyph: showsAlertGlyph, content: { EmptyView() })
    }
}

// MARK: Primary pill

/// The one white action at the bottom of a task screen: "Check out · 3 items".
/// Disabled, it drops to a dark outline so nobody mistakes it for ready.
struct KioskPrimaryPill: View {
    let title: String
    var detail: String?
    var isEnabled: Bool = true
    var isBusy: Bool = false
    var height: CGFloat = 84
    let action: () -> Void

    private var isActive: Bool { isEnabled && !isBusy }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 14) {
                if isBusy {
                    ProgressView().tint(KioskText.onPrimary)
                }
                Text(title)
                    .font(isActive || isBusy ? KioskType.primaryLabel : .system(size: 20, weight: .bold))
                    .foregroundStyle(isActive || isBusy ? KioskText.onPrimary : KioskText.muted)
                if let detail, isActive {
                    Text(detail)
                        .font(KioskType.body)
                        .foregroundStyle(KioskText.onPrimaryDetail)
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: height)
            .background(
                isActive || isBusy ? KioskText.primary : KioskSurface.control.opacity(0.6),
                in: Capsule()
            )
            .overlay(Capsule().stroke(isActive || isBusy ? KioskText.primary : KioskStroke.standard, lineWidth: 1))
            .contentShape(Capsule())
        }
        .buttonStyle(KioskPressStyle())
        .disabled(!isActive)
        .accessibilityLabel(detail.map { "\(title), \($0)" } ?? title)
    }
}

/// Two pills side by side, secondary then primary ("Keep scanning" /
/// "Check out without them").
struct KioskPillPair: View {
    let secondaryTitle: String
    let primaryTitle: String
    var primaryRole: KioskButtonRole = .primary
    var height: CGFloat = 84
    let onSecondary: () -> Void
    let onPrimary: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Button(action: onSecondary) {
                Text(secondaryTitle)
                    .font(.system(size: 20, weight: .bold))
                    .frame(maxWidth: .infinity, minHeight: height)
            }
            .kioskButtonRole(.secondary)
            Button(action: onPrimary) {
                Text(primaryTitle)
                    .font(.system(size: 20, weight: .heavy))
                    .frame(maxWidth: .infinity, minHeight: height)
            }
            .kioskButtonRole(primaryRole)
        }
    }
}

// MARK: Confirmation card

/// A centered card over a dimmed screen for choices that lose work or leave
/// gear out ("Discard these 3 scans?"). Confirmations only guard those.
struct KioskConfirmationCard: View {
    let title: String
    let message: String
    let cancelTitle: String
    let confirmTitle: String
    var confirmRole: KioskButtonRole = .primary
    let onCancel: () -> Void
    let onConfirm: () -> Void

    var body: some View {
        ZStack {
            KioskScrim.modal
                .ignoresSafeArea()
                .onTapGesture(perform: onCancel)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 14) {
                Text(title)
                    .font(KioskType.sheetTitle)
                    .foregroundStyle(KioskText.primary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                Text(message)
                    .font(KioskType.body)
                    .foregroundStyle(KioskText.secondary)
                    .lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 10) {
                    Button(action: onCancel) {
                        Text(cancelTitle)
                            .font(.system(size: 17, weight: .semibold))
                            .frame(maxWidth: .infinity, minHeight: 60)
                    }
                    .kioskButtonRole(.secondary)
                    Button(action: onConfirm) {
                        Text(confirmTitle)
                            .font(.system(size: 17, weight: .heavy))
                            .frame(maxWidth: .infinity, minHeight: 60)
                    }
                    .kioskButtonRole(confirmRole)
                }
                .padding(.top, 6)
            }
            .padding(30)
            .frame(width: 540)
            .kioskCard(KioskSurface.modal, radius: KioskRadius.modal, stroke: KioskStroke.strong)
            .accessibilityElement(children: .contain)
            .accessibilityAddTraits(.isModal)
        }
    }
}

// MARK: Sheet screen

/// The two-panel sheet used when a scan or a row needs a person or a choice
/// (B1 "Who's taking it?", A6 "Who's returning it?", H1 Extend): a 1060×700
/// panel over a near-black backdrop, context on the left, the choice on the
/// right, and a Cancel/Close pill at the bottom of the left panel.
struct KioskSheetScreen<Context: View, Choice: View>: View {
    var dismissTitle: String = "Cancel"
    let onDismiss: () -> Void
    var contextWidth: CGFloat = 400
    @ViewBuilder var context: () -> Context
    @ViewBuilder var choice: () -> Choice

    var body: some View {
        ZStack {
            KioskSheetBackdrop.color.ignoresSafeArea()
            HStack(alignment: .top, spacing: 28) {
                VStack(alignment: .leading, spacing: 16) {
                    context()
                    Spacer(minLength: 0)
                    Button(action: onDismiss) {
                        Text(dismissTitle)
                            .font(.system(size: 17, weight: .semibold))
                            .frame(maxWidth: .infinity, minHeight: 56)
                    }
                    .kioskButtonRole(.secondary)
                }
                .frame(width: contextWidth)
                .frame(maxHeight: .infinity, alignment: .top)
                VStack(alignment: .leading, spacing: 14) { choice() }
                    .padding(.leading, 28)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    .overlay(alignment: .leading) {
                        Rectangle().fill(KioskStroke.divider).frame(width: 1)
                    }
            }
            .padding(28)
            .frame(width: 1060, height: 700)
            .kioskCard(KioskSurface.sheet, radius: KioskRadius.modal, stroke: KioskStroke.standard)
        }
    }
}

enum KioskSheetBackdrop {
    static let color = Color(red: 6 / 255, green: 6 / 255, blue: 7 / 255)
}
