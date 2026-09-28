import SwiftUI
import UIKit

struct KioskSuccessView: View {
    @Environment(KioskStore.self) private var store
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let info: KioskSuccessInfo
    @State private var countdown: Int
    @State private var appeared = false

    init(info: KioskSuccessInfo) {
        self.info = info
        _countdown = State(initialValue: info.earnedBadges.isEmpty ? 6 : 9)
    }

    /// Entrance values driven by the keyframe animators below. The icon pops
    /// in with a small overshoot; the checkmark badge follows a beat later.
    fileprivate struct Entrance {
        var scale: CGFloat = 0.6
        var opacity: Double = 0
        var badgeScale: CGFloat = 0
    }

    private var accent: Color {
        switch info.kind {
        case .checkout: return KioskSection.takingOut.accent
        case .returned: return KioskSection.comingBack.accent
        case .pickup:   return KioskSection.pickingUp.accent
        }
    }

    var body: some View {
        if let receipt = info.receipt {
            receiptBody(receipt)
        } else {
            legacyBody
        }
    }

    // MARK: - Receipt (redesign D7, D8, F5, G6)

    private func receiptBody(_ receipt: KioskReceipt) -> some View {
        VStack(spacing: 0) {
            HStack(alignment: .top, spacing: 18) {
                KioskAvatar(url: receipt.avatarURL, initials: receipt.initials, size: 76)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    Text("All set, \(receipt.firstName).")
                        .font(KioskType.taskTitle)
                        .foregroundStyle(KioskText.primary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                    Text("It's on the record.")
                        .font(KioskType.headerDetail)
                        .foregroundStyle(KioskText.secondary)
                }
                Spacer(minLength: 16)
                Text("Home in \(countdown)s")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(KioskText.tertiary)
                    .monospacedDigit()
                    .contentTransition(.numericText(countsDown: true))
                    .padding(.top, 14)
            }
            .padding(.horizontal, KioskSpacing.xl)
            .padding(.top, KioskSpacing.screenTop)
            .frame(height: 132, alignment: .top)

            HStack(spacing: 0) {
                VStack(alignment: .leading, spacing: 14) {
                    if let reward = info.earnedBadges.first {
                        badgeCard(reward)
                            .modifier(EntranceFade(visible: appeared || reduceMotion, reduceMotion: reduceMotion, delay: 0.18))
                    }
                    if let nextStep = receipt.nextStep {
                        Text(nextStep)
                            .font(.system(size: 18))
                            .foregroundStyle(KioskText.secondary)
                            .lineSpacing(6)
                            .frame(maxWidth: 460, alignment: .leading)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 0)
                    Button(action: skip) {
                        Text("Done")
                            .font(.system(size: 22, weight: .bold))
                            .frame(maxWidth: .infinity, minHeight: 84)
                    }
                    .kioskButtonRole(.secondary)
                    .accessibilityLabel("Done, return to home now")
                }
                .padding(.leading, KioskSpacing.xl)
                .padding(.trailing, KioskSpacing.lg)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                Rectangle().fill(KioskStroke.divider).frame(width: 1)
                VStack(alignment: .leading, spacing: 14) {
                    ForEach(Array(receipt.cards.enumerated()), id: \.offset) { index, card in
                        receiptCard(card)
                            .modifier(EntranceFade(visible: appeared || reduceMotion, reduceMotion: reduceMotion, delay: 0.06 * Double(index)))
                    }
                }
                .padding(.leading, KioskSpacing.lg)
                .padding(.trailing, KioskSpacing.xl)
                .frame(width: 500)
                .frame(maxHeight: .infinity, alignment: .top)
            }
            .padding(.top, 16)
            .padding(.bottom, KioskSpacing.screenBottom)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .contentShape(Rectangle())
        .onTapGesture { skip() }
        .accessibilityElement(children: .contain)
        .accessibilityAction(named: "Return to home") { skip() }
        .onAppear { appeared = true }
        .task { await runCountdown() }
    }

    private func receiptCard(_ card: KioskReceipt.Card) -> some View {
        let section: KioskSection = card.isProblem ? .problem : sectionForKind
        return VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(card.overline.uppercased())
                    .font(KioskType.overline)
                    .tracking(KioskType.overlineTracking)
                    .foregroundStyle(section.text)
                Spacer(minLength: 8)
                if let ref = card.refNumber {
                    Text(ref)
                        .font(KioskType.meta)
                        .foregroundStyle(KioskText.tertiary)
                }
            }
            Text(card.title)
                .font(KioskType.cardTitle)
                .foregroundStyle(KioskText.primary)
            if let detail = card.detail {
                Text(detail)
                    .font(KioskType.meta)
                    .foregroundStyle(KioskText.secondary)
            }
            if let footnote = card.footnote {
                Text(footnote)
                    .font(card.footnoteSection == nil ? KioskType.meta : KioskType.meta.weight(.semibold))
                    .foregroundStyle(card.footnoteSection?.text ?? KioskText.tertiary)
                    .padding(.top, 2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 20)
        .padding(.vertical, 18)
        .kioskCard(radius: 18)
        .accessibilityElement(children: .combine)
    }

    private func badgeCard(_ reward: EarnedBadgeReward) -> some View {
        HStack(spacing: 18) {
            Image(systemName: "star.fill")
                .font(.system(size: 30, weight: .bold))
                .foregroundStyle(KioskText.onPrimary)
                .frame(width: 72, height: 72)
                .background(KioskSection.comingBack.accent, in: Circle())
                .scaleEffect(appeared || reduceMotion ? 1 : 0.8)
                .animation(reduceMotion ? KioskMotion.fadeUnderReduceMotion : .spring(response: 0.35, dampingFraction: 0.55), value: appeared)
            VStack(alignment: .leading, spacing: 3) {
                Text("BADGE EARNED")
                    .font(KioskType.overline)
                    .tracking(KioskType.overlineTracking)
                    .foregroundStyle(KioskSection.comingBack.text)
                Text(reward.name)
                    .font(.system(size: 24, weight: .heavy))
                    .foregroundStyle(KioskText.primary)
                Text(reward.description)
                    .font(.system(size: 15))
                    .foregroundStyle(KioskText.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding(20)
        .kioskCard(Color(red: 0x1A / 255, green: 0x16 / 255, blue: 0x10 / 255), radius: 20,
                   stroke: Color(red: 0x3D / 255, green: 0x32 / 255, blue: 0x20 / 255))
        .accessibilityElement(children: .combine)
    }

    private var sectionForKind: KioskSection {
        switch info.kind {
        case .checkout: .takingOut
        case .returned: .comingBack
        case .pickup: .pickingUp
        }
    }

    private func runCountdown() async {
        Haptics.success()
        // J4: the done chime; with a badge, the chime plus a sparkle.
        KioskFeedbackSound.play(info.earnedBadges.isEmpty ? .done : .badge)
        UIAccessibility.post(notification: .announcement, argument: accessibilitySummary)
        for i in stride(from: countdown - 1, through: 0, by: -1) {
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            if Task.isCancelled { return }
            countdown = i
        }
        store.deferSleepMode()
        store.screen = .idle
    }

    // MARK: - Sentence-only receipt

    private var legacyBody: some View {
        VStack(spacing: 28) {
            Spacer()

            // With a badge earned, the badge *is* the moment. It used to be a
            // modest card sitting under a full-width custody sentence, which
            // made the reward the third thing on the screen and quieter than
            // the receipt. One focal point: the badge disc replaces the kind
            // icon, the badge name takes the headline, and the custody message
            // demotes to the supporting line it always was.
            if let reward = info.earnedBadges.first {
                KioskBadgeCelebration(
                    reward: reward,
                    additionalRewards: Array(info.earnedBadges.dropFirst()),
                    appeared: appeared,
                    reduceMotion: reduceMotion
                )

                VStack(spacing: 10) {
                    Text(info.kind.label.uppercased())
                        .font(KioskType.chip)
                        .tracking(2)
                        .foregroundStyle(accent)
                    Text(info.message)
                        .font(KioskType.body)
                        .foregroundStyle(KioskText.tertiary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 48)
                }
                .modifier(EntranceFade(visible: appeared || reduceMotion, reduceMotion: reduceMotion, delay: 0.3))
            } else {
                successIcon

                VStack(spacing: 14) {
                    Text(info.kind.label.uppercased())
                        .font(KioskType.sectionTitle)
                        .tracking(2)
                        .foregroundStyle(accent)

                    Text(info.message)
                        .font(.kioskSuccessTitle())
                        .foregroundStyle(KioskText.primary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 48)
                }
                .modifier(EntranceFade(visible: appeared || reduceMotion, reduceMotion: reduceMotion, delay: 0.2))
            }

            countdownView
                .modifier(EntranceFade(visible: appeared || reduceMotion, reduceMotion: reduceMotion, delay: 0.3))

            Button {
                skip()
            } label: {
                Text("Done")
                    .font(KioskType.sectionTitle)
                    .foregroundStyle(KioskText.onPrimary)
                    .padding(.horizontal, 44)
                    .frame(minHeight: 56)
                    .background(
                        KioskText.primary,
                        in: Capsule()
                    )
            }
            .buttonStyle(KioskPressStyle())
            .accessibilityLabel("Done — return to home now")
            .modifier(EntranceFade(visible: appeared || reduceMotion, reduceMotion: reduceMotion, delay: 0.3))

            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .contentShape(Rectangle())
        .onTapGesture { skip() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(accessibilitySummary)
        .accessibilityAction(named: "Return to home") { skip() }
        .accessibilityAddTraits(.isHeader)
        .onAppear { appeared = true }
        .task { await runCountdown() }
    }

    private var countdownDuration: Int {
        info.earnedBadges.isEmpty ? 6 : 9
    }

    private var accessibilitySummary: String {
        let rewards = info.earnedBadges.map(\.name)
        guard !rewards.isEmpty else { return "\(info.kind.label): \(info.message)" }
        return "\(info.kind.label): \(info.message) Badge earned: \(rewards.joined(separator: ", "))."
    }

    // MARK: - Icon moment

    /// Kind-tinted icon in a ring, sitting on a soft radial glow. The glow is
    /// a layout-free background so it can breathe past the cluster's bounds.
    private var successIcon: some View {
        ZStack(alignment: .bottomTrailing) {
            ZStack {
                Circle()
                    .fill(accent.opacity(0.12))
                Circle()
                    .stroke(accent.opacity(0.35), lineWidth: 1.5)
                Image(systemName: info.kind.icon)
                    .font(.system(size: 64))
                    .foregroundStyle(accent)
            }
            .frame(width: 132, height: 132)
            .modifier(IconEntrance(trigger: appeared, reduceMotion: reduceMotion))

            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 40))
                .foregroundStyle(KioskStatus.ok)
                .background(KioskSurface.base, in: Circle())
                .offset(x: 10, y: 10)
                .modifier(BadgeEntrance(trigger: appeared, reduceMotion: reduceMotion))
        }
        .background(
            Circle()
                .fill(
                    RadialGradient(
                        colors: [accent.opacity(0.10), .clear],
                        center: .center,
                        startRadius: 0,
                        endRadius: 210
                    )
                )
                .frame(width: 420, height: 420)
        )
        .accessibilityHidden(true)
    }

    /// Pop-in for the icon ring: fade up while overshooting to 106% and
    /// settling. Holds the settled state after the run. Static under Reduce
    /// Motion.
    fileprivate struct IconEntrance: ViewModifier {
        let trigger: Bool
        let reduceMotion: Bool

        func body(content: Content) -> some View {
            if reduceMotion {
                content
            } else {
                content.keyframeAnimator(initialValue: Entrance(), trigger: trigger) { view, value in
                    view
                        .scaleEffect(value.scale)
                        .opacity(value.opacity)
                } keyframes: { _ in
                    KeyframeTrack(\.scale) {
                        SpringKeyframe(1.06, duration: 0.3, spring: .snappy)
                        SpringKeyframe(1.0, duration: 0.2, spring: .smooth)
                    }
                    KeyframeTrack(\.opacity) {
                        LinearKeyframe(1.0, duration: 0.18)
                    }
                }
            }
        }
    }

    /// The green checkmark lands a beat after the icon: held at zero scale for
    /// 0.25s, then springs past full size and settles.
    fileprivate struct BadgeEntrance: ViewModifier {
        let trigger: Bool
        let reduceMotion: Bool

        func body(content: Content) -> some View {
            if reduceMotion {
                content
            } else {
                content.keyframeAnimator(initialValue: Entrance(), trigger: trigger) { view, value in
                    view.scaleEffect(value.badgeScale)
                } keyframes: { _ in
                    KeyframeTrack(\.badgeScale) {
                        LinearKeyframe(0, duration: 0.25)
                        SpringKeyframe(1.15, duration: 0.22, spring: .bouncy)
                        SpringKeyframe(1.0, duration: 0.18, spring: .smooth)
                    }
                }
            }
        }
    }

    /// Fade-and-rise entrance for the text/CTA blocks under the icon.
    fileprivate struct EntranceFade: ViewModifier {
        let visible: Bool
        let reduceMotion: Bool
        let delay: Double

        func body(content: Content) -> some View {
            content
                .opacity(visible ? 1 : 0)
                .offset(y: visible || reduceMotion ? 0 : 12)
                .animation(reduceMotion ? KioskMotion.fadeUnderReduceMotion : .easeOut(duration: 0.35).delay(delay), value: visible)
        }
    }

    // MARK: - Countdown

    /// "Returning home" with numeric seconds and a thin draining capsule so
    /// the auto-return is visible at a glance. Decorative — the whole screen
    /// is one tap target and the copy is announced on entry.
    private var countdownView: some View {
        VStack(spacing: 10) {
            HStack(spacing: 5) {
                Text("Returning home in")
                Text("\(countdown)s")
                    .contentTransition(.numericText(countsDown: true))
                    .animation(reduceMotion ? KioskMotion.fadeUnderReduceMotion : .easeInOut(duration: 0.2), value: countdown)
            }
            .font(KioskType.rowDetail)
            .foregroundStyle(KioskText.secondary)
            .monospacedDigit()

            if !reduceMotion {
                ZStack(alignment: .leading) {
                    Capsule()
                        .fill(KioskStroke.divider)
                    Capsule()
                        .fill(accent)
                        .frame(width: 180 * CGFloat(countdown) / CGFloat(countdownDuration))
                        .animation(.linear(duration: 1), value: countdown)
                }
                .frame(width: 180, height: 4)
            }
        }
        .accessibilityHidden(true)
    }

    /// Tap "Done" or anywhere on the screen to short-circuit the 5 s countdown
    /// and return to idle immediately.
    private func skip() {
        store.deferSleepMode()
        store.screen = .idle
    }
}

/// The badge moment on the kiosk success screen.
///
/// Borrows the shared celebration's visual language — rarity-gradient disc,
/// glow, rarity chip — so a badge looks the same everywhere it is awarded,
/// while staying inside the kiosk's own terminal screen rather than being a
/// modal with its own dismiss button. `BadgeEarnedCelebrationView` could not be
/// dropped in directly: it is a `.regularMaterial` sheet built to be dismissed
/// by hand, and this screen auto-returns on a countdown.
private struct KioskBadgeCelebration: View {
    let reward: EarnedBadgeReward
    let additionalRewards: [EarnedBadgeReward]
    let appeared: Bool
    let reduceMotion: Bool

    private var color: Color { reward.badgeRarity.accent }
    private var additionalCount: Int { additionalRewards.count }

    var body: some View {
        VStack(spacing: KioskSpacing.md) {
            ZStack(alignment: .bottomTrailing) {
                ZStack {
                    Circle()
                        .fill(color.opacity(0.18))
                        .frame(width: 176, height: 176)
                        .blur(radius: reduceMotion ? 6 : 16)
                    Circle()
                        .fill(color.gradient)
                        .frame(width: 132, height: 132)
                        .shadow(color: color.opacity(0.45), radius: 28, y: 12)
                    Image(systemName: reward.symbolName)
                        .font(.system(size: 58, weight: .semibold))
                        .foregroundStyle(.white)
                }
                .modifier(KioskSuccessView.IconEntrance(trigger: appeared, reduceMotion: reduceMotion))

                if additionalCount > 0 {
                    Text("+\(additionalCount)")
                        .font(.system(size: 18, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 44, height: 44)
                        .background(color, in: Circle())
                        .overlay(Circle().stroke(KioskSurface.base, lineWidth: 3))
                        .offset(x: 6, y: 6)
                        .modifier(KioskSuccessView.BadgeEntrance(trigger: appeared, reduceMotion: reduceMotion))
                        .accessibilityLabel(
                            "Also earned: \(additionalRewards.map(\.name).joined(separator: ", "))"
                        )
                }
            }
            .background(
                Circle()
                    .fill(
                        RadialGradient(
                            colors: [color.opacity(0.14), .clear],
                            center: .center,
                            startRadius: 0,
                            endRadius: 210
                        )
                    )
                    .frame(width: 420, height: 420)
            )

            VStack(spacing: 8) {
                Text("BADGE EARNED")
                    .font(KioskType.overline)
                    .tracking(2.2)
                    .foregroundStyle(color)
                Text(reward.name)
                    .font(.system(size: 40, weight: .heavy))
                    .foregroundStyle(KioskText.primary)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .minimumScaleFactor(0.7)
                Text(reward.description)
                    .font(KioskType.rowDetail)
                    .foregroundStyle(KioskText.secondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 48)
                Text(reward.badgeRarity.title.uppercased())
                    .font(KioskType.micro)
                    .tracking(1.2)
                    .foregroundStyle(color)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(color.opacity(0.16), in: Capsule())
                    .padding(.top, 2)
            }
            .modifier(KioskSuccessView.EntranceFade(visible: appeared || reduceMotion, reduceMotion: reduceMotion, delay: 0.24))
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            additionalRewards.isEmpty
                ? "Badge earned. \(reward.name), \(reward.badgeRarity.title). \(reward.description)"
                : "Badge earned. \(reward.name), \(reward.badgeRarity.title). Also earned: \(additionalRewards.map(\.name).joined(separator: ", ")). \(reward.description)"
        )
    }
}
