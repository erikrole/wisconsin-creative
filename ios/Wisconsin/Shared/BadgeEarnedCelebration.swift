import SwiftUI
import UIKit

struct EarnedBadgeReward: Codable, Equatable, Identifiable, Hashable {
    let id: String
    let definitionId: String
    let key: String
    let name: String
    let description: String
    let icon: String
    let category: String
    let rarity: String
    let awardedAt: String

    /// The glyph for this award. One map serves every badge surface -- see
    /// `BadgeArtwork`.
    var symbolName: String { BadgeArtwork.symbolName(for: icon) }

    /// Served rarity, tolerant of an older payload or a newer server vocabulary.
    var badgeRarity: BadgeRarity { BadgeRarity(serverValue: rarity) ?? .common }
}

struct RecentBadgeRewards: Decodable {
    let awards: [EarnedBadgeReward]
    let nextCursor: String
}

extension Array where Element == EarnedBadgeReward {
    mutating func appendUnique(contentsOf rewards: [EarnedBadgeReward]) {
        let existing = Set(map(\.id))
        append(contentsOf: rewards.filter { !existing.contains($0.id) })
    }
}

struct BadgeEarnedCelebrationView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let reward: EarnedBadgeReward
    let remaining: Int
    let onDismiss: () -> Void
    @State private var appeared = false

    var body: some View {
        ZStack {
            Color.black.opacity(0.58)
                .ignoresSafeArea()
                .onTapGesture(perform: onDismiss)

            VStack(spacing: 0) {
                VStack(spacing: 18) {
                    Text("BADGE EARNED")
                        .font(.caption.weight(.heavy))
                        .tracking(2.2)
                        .foregroundStyle(.secondary)

                    ZStack {
                        Circle()
                            .fill(reward.accentColor.opacity(0.16))
                            .frame(width: 138, height: 138)
                            .blur(radius: appeared && !reduceMotion ? 12 : 4)
                        Circle()
                            .fill(reward.accentColor.gradient)
                            .frame(width: 104, height: 104)
                            .shadow(color: reward.accentColor.opacity(0.35), radius: 22, y: 10)
                        Image(systemName: reward.symbolName)
                            .font(.system(size: 43, weight: .semibold))
                            .foregroundStyle(.white)
                    }
                    .scaleEffect(appeared || reduceMotion ? 1 : 0.66)

                    VStack(spacing: 9) {
                        Text(reward.name)
                            .font(.largeTitle.weight(.bold))
                            .multilineTextAlignment(.center)
                        Text(reward.description)
                            .font(.body)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    HStack(spacing: 8) {
                        rewardChip(reward.badgeRarity.title)
                        rewardChip(reward.category.replacingOccurrences(of: "_", with: " ").capitalized)
                    }
                }
                .padding(.horizontal, 30)
                .padding(.top, 34)
                .padding(.bottom, 28)

                Divider()

                Button(action: onDismiss) {
                    Text(remaining > 0 ? "Next badge (\(remaining))" : "Nice")
                        .font(.headline)
                        .frame(maxWidth: .infinity, minHeight: 52)
                }
                .buttonStyle(.borderedProminent)
                .tint(reward.accentColor)
                .padding(18)
            }
            .frame(maxWidth: 430)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 30, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 30, style: .continuous)
                    .stroke(.white.opacity(0.16), lineWidth: 1)
            )
            .shadow(color: .black.opacity(0.34), radius: 36, y: 18)
            .padding(24)
            .opacity(appeared || reduceMotion ? 1 : 0)
            .offset(y: appeared || reduceMotion ? 0 : 18)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Badge earned. \(reward.name). \(reward.description)")
        .onAppear {
            if reduceMotion {
                appeared = true
            } else {
                withAnimation(.spring(response: 0.5, dampingFraction: 0.78)) {
                    appeared = true
                }
            }
            UIAccessibility.post(
                notification: .announcement,
                argument: "Badge earned. \(reward.name). \(reward.description)"
            )
        }
    }

    private func rewardChip(_ title: String) -> some View {
        Text(title)
            .font(.caption.weight(.bold))
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(.thinMaterial, in: Capsule())
    }
}

private extension EarnedBadgeReward {
    /// The celebration's accent, from the one rarity palette every badge
    /// surface now reads.
    var accentColor: Color { badgeRarity.accent }
}

// MARK: - Shared badge artwork

/// One Lucide-name -> SF Symbol map for every badge surface in the app.
///
/// `BadgeDefinition.icon` holds a Lucide name because the catalog was authored
/// for the web, so each native surface has to translate. There used to be two
/// translations -- this one and a second inside the profile badge page -- and
/// they had drifted: twelve catalog icons resolved to a different glyph
/// depending on where you looked at the badge, and none of the eleven
/// custom-badge picker icons existed here at all, so every custom award
/// celebrated as a generic trophy. Earning a badge and then finding a different
/// picture of it on your shelf is the same defect as the July icon collapse,
/// just split across two screens.
///
/// The map is one-to-one on purpose: two badges sharing a glyph is the milder
/// version of the same bug, because the shelf stops telling them apart.
/// `tests/ios-badge-icon-coverage.test.ts` fails if the seeded catalog or the
/// custom-icon picker gains a name this map does not answer, or if two names
/// ever collide.
enum BadgeArtwork {
    static func symbolName(for lucideIcon: String) -> String {
        switch lucideIcon {
        // Seeded catalog: gear flow
        case "PackageCheck": "shippingbox.circle.fill"
        case "PackageOpen": "shippingbox.fill"
        case "Boxes": "square.stack.3d.up.fill"
        case "Warehouse": "building.2.fill"
        // Seeded catalog: scans
        case "ScanLine": "barcode.viewfinder"
        case "ScanSearch": "text.viewfinder"
        case "QrCode": "qrcode"
        // Seeded catalog: time and reliability
        case "Clock3": "clock.fill"
        case "CalendarCheck2": "calendar.badge.checkmark"
        case "AlarmClockCheck": "alarm.waves.left.and.right.fill"
        case "CalendarClock": "calendar.badge.clock"
        case "CalendarDays": "calendar"
        case "CalendarRange": "calendar.badge.plus"
        case "ShieldCheck": "checkmark.shield.fill"
        case "BadgeCheck": "checkmark.seal.fill"
        // Seeded catalog: people and teamwork
        case "Handshake": "hands.sparkles.fill"
        case "UserCheck": "person.fill.checkmark"
        case "Repeat2": "arrow.triangle.2.circlepath"
        case "Flame": "flame.fill"
        case "Trophy": "trophy.fill"
        // Curated automatic awards, manual awards, and app-open easter eggs.
        case "Cable": "cable.connector"
        case "BatteryCharging": "battery.100percent.bolt"
        case "BatteryLow": "battery.25"
        case "Truck": "truck.box.fill"
        case "ArrowLeftRight": "arrow.left.arrow.right"
        case "Timer": "timer"
        case "AlarmClock": "alarm.fill"
        case "Clapperboard": "movieclapper.fill"
        case "Gift": "gift.fill"
        case "Aperture": "camera.aperture"
        case "AudioLines": "waveform"
        case "BusFront": "bus.fill"
        case "Camera": "camera.fill"
        case "Focus": "viewfinder"
        case "HardDrive": "externaldrive.fill"
        case "Lightbulb": "lightbulb.fill"
        case "ShoppingCart": "cart.fill"
        case "Sunrise": "sunrise.fill"
        case "Sunset": "sunset.fill"
        case "Shuffle": "shuffle"
        case "Ticket": "ticket.fill"
        case "CloudRain": "cloud.rain.fill"
        case "Combine": "arrow.triangle.merge"
        case "Dumbbell": "dumbbell.fill"
        case "Binoculars": "binoculars.fill"
        case "LayoutGrid": "square.grid.3x3.fill"
        case "LifeBuoy": "lifepreserver.fill"
        case "MoonStar": "moon.stars.fill"
        // Custom-badge picker options that are not already covered above.
        case "Medal": "medal.fill"
        case "Star": "star.fill"
        case "Sparkles": "sparkles"
        case "Shield": "shield.fill"
        case "Zap": "bolt.fill"
        case "Heart": "heart.fill"
        case "Crown": "crown.fill"
        case "Rocket": "paperplane.fill"
        case "Target": "target"
        case "Wrench": "wrench.adjustable.fill"
        case "Coffee": "cup.and.saucer.fill"
        default: "trophy.fill"
        }
    }
}

/// How scarce a badge is, as the server computes it from real holder counts.
///
/// The colour lives here rather than on each screen because it did not used to:
/// the celebration painted a Common award in brand red and Uncommon in blue
/// (matching the web medallion), while the profile badge page painted the same
/// two badges blue and green. A badge changed colour between the moment you
/// earned it and the shelf you found it on.
enum BadgeRarity: String, CaseIterable {
    case common, uncommon, rare, legendary

    /// The server sends title case ("Legendary"). An unrecognised value means a
    /// newer server vocabulary, so the caller falls back rather than guessing.
    init?(serverValue: String) {
        self.init(rawValue: serverValue.lowercased())
    }

    var title: String {
        switch self {
        case .common: "Common"
        case .uncommon: "Uncommon"
        case .rare: "Rare"
        case .legendary: "Legendary"
        }
    }

    /// The badge's colour, everywhere it appears: the celebration disc, the
    /// medallion on the shelf, the progress tint.
    ///
    /// These are the celebration's original values, kept exactly. They are
    /// saturated fills meant to sit under a white glyph, which is why Common is
    /// a fixed deep red rather than `brandPrimary` -- `brandPrimary` lightens to
    /// `#FF3B30` in dark mode for typography contrast, and a filled disc does
    /// not need that. `docs/COLOR_SYSTEM.md` draws the same distinction for
    /// chart fills. The point of the token is that the value lives in one place,
    /// not that every surface uses the text palette.
    var accent: Color {
        switch self {
        case .common: Color(red: 0.78, green: 0.05, blue: 0.12)
        case .uncommon: .blue
        case .rare: .orange
        case .legendary: .purple
        }
    }

    /// The soft wash behind `accent` -- locked tiles, progress tracks, and the
    /// halo on a freshly earned medallion.
    var accentBackground: Color { accent.opacity(0.16) }
}
