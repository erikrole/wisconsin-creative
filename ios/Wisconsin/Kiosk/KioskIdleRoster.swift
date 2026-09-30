import SwiftUI

// MARK: - Idle roster pieces
//
// The tappable roster tile, the fit-to-screen grid metrics, and the
// roster-label disambiguation helper.

/// First name when unique in the visible roster, "First L." when another
/// user shares the same first name. Prevents misclick attribution.
func disambiguatedLabels(for users: [KioskUser]) -> [String: String] {
    var firstNameCounts: [String: Int] = [:]
    for user in users {
        let first = user.name.components(separatedBy: " ").first ?? user.name
        firstNameCounts[first.lowercased(), default: 0] += 1
    }
    var result: [String: String] = [:]
    for user in users {
        let parts = user.name.components(separatedBy: " ").filter { !$0.isEmpty }
        let first = parts.first ?? user.name
        if firstNameCounts[first.lowercased(), default: 0] > 1, let last = parts.dropFirst().last,
           let lastInitial = last.first {
            result[user.id] = "\(first) \(lastInitial)."
        } else {
            result[user.id] = first
        }
    }
    return result
}

/// How to lay the whole roster out inside the space the panel actually has.
///
/// The roster used to be a fixed-metric `LazyVGrid` inside a `ScrollView`: tile
/// size was constant, so the number of people decided how much of the roster
/// you could see, and past roughly twenty names the rest were below the fold.
/// On a counter kiosk that is the worst possible failure — the people pushed
/// off screen are the ones who have to discover that this panel scrolls at all,
/// on a device they use for fifteen seconds at a time.
///
/// So the count is an input, not an outcome. Given the people and the box,
/// this picks the column count and tile height that shows *everyone at once*,
/// and the tile spends its height budget accordingly: portraits and a second
/// line when there is room, name-only when there is not.
struct KioskRosterMetrics: Equatable {
    let columns: Int
    let tileHeight: CGFloat
    let avatarSize: CGFloat
    let showsAvatar: Bool
    /// False when the roster is too large to fit even at the smallest legible
    /// tile — the grid scrolls rather than shrinking past a tappable target.
    let fitsOnOneScreen: Bool

    /// Comfortable tile height: portrait plus two lines of text.
    static let comfortableHeight: CGFloat = 68
    /// Past this a tile is mostly empty space around a short name.
    static let maximumHeight: CGFloat = 92
    /// The floor. Below this a tile stops being a reliable touch target on a
    /// shared device, and a mis-tap here attributes custody to another person.
    static let minimumHeight: CGFloat = 46
    static let gap: CGFloat = 8

    // Width budget, stated in the parts that actually consume it.
    private static let chrome: CGFloat = 22        // horizontal padding + trailing spacer
    private static let portrait: CGFloat = 46      // avatar at full size
    private static let portraitGap: CGFloat = 12
    /// "Madeleine" in the bold row rung measures about 76pt; this is that
    /// plus slack, and it is the number the whole layout now protects.
    private static let nameWidth: CGFloat = 88
    /// Narrowest tile that can hold a portrait *and* a readable name.
    static let portraitWidth: CGFloat = chrome + portrait + portraitGap + nameWidth
    /// Narrowest tile that can hold a readable name with no portrait.
    static let nameOnlyWidth: CGFloat = chrome + nameWidth
    /// Wider than this and the tile is a name floating in a field of nothing.
    static let idealMaxWidth: CGFloat = 240

    static func resolve(count: Int, in size: CGSize) -> KioskRosterMetrics {
        guard count > 0, size.width > 0, size.height > 0 else {
            return KioskRosterMetrics(
                columns: 1,
                tileHeight: comfortableHeight,
                avatarSize: portrait,
                showsAvatar: true,
                fitsOnOneScreen: true
            )
        }

        let maxColumns = max(1, Int((size.width + gap) / (nameOnlyWidth + gap)))

        func tileWidth(_ columns: Int) -> CGFloat {
            (size.width - gap * CGFloat(columns - 1)) / CGFloat(columns)
        }
        func tileHeight(_ columns: Int) -> CGFloat {
            let rows = Int((Double(count) / Double(columns)).rounded(.up))
            return (size.height - gap * CGFloat(rows - 1)) / CGFloat(rows)
        }

        // Pass 1 — the fewest columns that keeps a portrait *and* a whole name.
        //
        // This used to iterate upward and return the first column count whose
        // tile reached a comfortable *height*. More columns means fewer rows
        // means taller tiles, so "first comfortable height" was systematically
        // the *most* columns — the narrowest tiles — which is the opposite of
        // what a roster of names needs. On a 29-person roster it chose 4
        // columns and left 50pt for the name, so nine of twenty-nine names
        // truncated to "Ashl…", "Mad…", "Willi…". Width is the binding
        // constraint here, and it is now the one being solved for.
        for columns in 1...maxColumns {
            let width = tileWidth(columns)
            if width > idealMaxWidth { continue }
            if width < portraitWidth { break }
            let height = tileHeight(columns)
            if height >= minimumHeight {
                return metrics(columns: columns, height: height, showsAvatar: true, fits: true)
            }
        }

        // Pass 2 — too many people for a portrait. Spend the width on the name
        // rather than truncating it next to a face.
        for columns in 1...maxColumns where tileWidth(columns) >= nameOnlyWidth {
            let height = tileHeight(columns)
            if height >= minimumHeight {
                return metrics(columns: columns, height: height, showsAvatar: false, fits: true)
            }
        }

        // Too many people to show at a tappable size — scroll at the floor
        // rather than shrink into a target nobody can hit accurately.
        return metrics(columns: maxColumns, height: minimumHeight, showsAvatar: false, fits: false)
    }

    private static func metrics(
        columns: Int,
        height: CGFloat,
        showsAvatar: Bool,
        fits: Bool
    ) -> KioskRosterMetrics {
        let clamped = min(max(height, minimumHeight), maximumHeight)
        return KioskRosterMetrics(
            columns: columns,
            tileHeight: clamped,
            avatarSize: min(max(clamped * 0.6, 26), portrait),
            showsAvatar: showsAvatar,
            fitsOnOneScreen: fits
        )
    }

    var gridColumns: [GridItem] {
        Array(
            repeating: GridItem(.flexible(minimum: KioskRosterMetrics.nameOnlyWidth), spacing: KioskRosterMetrics.gap),
            count: columns
        )
    }
}

/// One person in the roster grid: portrait and name.
///
/// One line, deliberately. The tile carried a second line twice — the full name
/// under a disambiguated one, then a role — and both times it printed the same
/// string under most of the grid: "Erik Role" under "Erik R.", then "Staff"
/// under fourteen of twenty-nine people. A line identical on most tiles is not
/// information; it is contrast taken from the name above it and height taken
/// from the grid. An outside collaborator is marked by a blue ring on the
/// portrait instead, which costs no layout at all and still reads at a glance.
///
/// Two earlier answers were both half right. A grid of 112pt photo tiles read
/// as a wall of colourful avatars and made name-finding slower as the roster
/// grew. Replacing it with a 48pt row fixed the density but stripped the tile
/// back to a 32pt bubble and a first name, so the panel stopped looking like
/// people and started looking like a settings list.
struct UserRow: View {
    let user: KioskUser
    let displayName: String
    var metrics: KioskRosterMetrics = .resolve(count: 1, in: CGSize(width: 200, height: 68))
    /// What tapping this tile does, in the words of the screen showing it. The
    /// idle roster starts a session; the identity screen confirms who you are.
    var accessibilityHintText: String?
    let action: () -> Void

    private var isCollaborator: Bool {
        user.isAffiliatedCollaborator && user.affiliationBadge?.isEmpty == false
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: metrics.tileHeight >= 56 ? KioskSpacing.sm : KioskSpacing.xs) {
                if metrics.showsAvatar {
                    KioskAvatar(url: user.avatarUrl, initials: user.initials, size: metrics.avatarSize)
                        .overlay(
                            Circle().stroke(
                                isCollaborator ? KioskAffiliation.ring : KioskStroke.strong,
                                lineWidth: isCollaborator ? 2.5 : 1
                            )
                        )
                }

                Text(displayName)
                    .font(KioskType.rowTitle)
                    .foregroundStyle(KioskText.primary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)

                Spacer(minLength: 2)
            }
            .padding(.horizontal, KioskSpacing.xs + 2)
            .padding(.vertical, 6)
            .frame(maxWidth: .infinity, alignment: .leading)
            .frame(height: metrics.tileHeight)
            .kioskCard(KioskSurface.cardRaised, radius: KioskRadius.md, stroke: KioskStroke.standard)
        }
        .buttonStyle(KioskPressStyle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel)
        .accessibilityHint(accessibilityHintText ?? "Tap to start at the kiosk as \(user.name)")
    }

    private var accessibilityLabel: String {
        guard let badge = user.affiliationBadge, user.isAffiliatedCollaborator, !badge.isEmpty else {
            return user.name
        }
        return "\(user.name), \(badge)"
    }
}
