import SwiftUI

/// Shared vocabulary for every crew surface, the native sibling of the web's
/// `src/components/shift-detail/crew-row.tsx`.
///
/// A crew row carries one signal. Slot state is a small coloured dot plus a
/// neutral label, crew type is plain secondary text in a fixed-width column,
/// and area headings read as quiet section labels with a filled count.
/// Anything that would add a second filled capsule to a row belongs somewhere
/// else on the surface.

// MARK: - Slot state

enum CrewSlotState {
    case filled
    case open
    case requested

    /// Mirrors web `crewSlotState(hasAssignment, requestCount)`.
    static func resolve(hasAssignment: Bool, requestCount: Int = 0) -> CrewSlotState {
        if hasAssignment { return .filled }
        return requestCount > 0 ? .requested : .open
    }

    var tone: StatusTone {
        switch self {
        case .filled: return .green
        case .open: return .red
        case .requested: return .orange
        }
    }

    func label(requestCount: Int = 0) -> String {
        switch self {
        case .filled: return "Filled"
        case .open: return "Open"
        case .requested: return requestCount == 1 ? "1 request waiting" : "\(requestCount) requests waiting"
        }
    }
}

/// The state marker itself. Colour carries the state; nothing else needs to.
struct CrewStateDot: View {
    let state: CrewSlotState

    var body: some View {
        Circle()
            .fill(Color.statusText(state.tone))
            .frame(width: 6, height: 6)
            .accessibilityHidden(true)
    }
}

/// Dot plus neutral label — the crew row's only status treatment.
struct CrewSlotStatusLabel: View {
    let state: CrewSlotState
    var requestCount: Int = 0

    var body: some View {
        HStack(spacing: 6) {
            CrewStateDot(state: state)
            Text(state.label(requestCount: requestCount))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(state.label(requestCount: requestCount))
    }
}

// MARK: - Crew type

/// Staff/Student as plain text, never a capsule. A column of identical filled
/// pills was the loudest thing on a crew row and carried the least meaning.
struct CrewTypeLabel: View {
    let label: String
    /// Set when an assigned person's class differs from the slot they filled.
    var emphasis: Bool = false
    /// Column width at the default text size. Avatars and names start at the
    /// same x on every row; the column grows with Dynamic Type so "Student"
    /// does not truncate to "Stude…" at accessibility sizes.
    var baseWidth: CGFloat? = 62

    @ScaledMetric(relativeTo: .caption) private var typeScale: CGFloat = 1

    var body: some View {
        Text(label)
            .font(.caption)
            .foregroundStyle(emphasis ? .primary : .secondary)
            .lineLimit(1)
            .frame(width: baseWidth.map { $0 * typeScale }, alignment: .leading)
    }
}

/// Server worker-type code to the label every surface speaks.
func crewWorkerTypeLabel(_ workerType: String) -> String {
    switch workerType {
    case "FT", "STAFF": return "Staff"
    case "ST", "STUDENT": return "Student"
    default: return workerType
    }
}

// MARK: - Area heading

/// Group header for an area: icon, name, and how much of it is filled.
struct CrewAreaHeading: View {
    let area: String
    var filled: Int? = nil
    var total: Int? = nil

    var body: some View {
        HStack(spacing: 6) {
            Label(area.shiftAreaLabel, systemImage: Self.icon(for: area))
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)
            if let filled, let total, total > 0 {
                Text("\(filled)/\(total)")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.tertiary)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel)
    }

    private var accessibilityLabel: String {
        guard let filled, let total, total > 0 else { return area.shiftAreaLabel }
        return "\(area.shiftAreaLabel), \(filled) of \(total) filled"
    }

    /// SF Symbol per shift area, matching the area's job.
    static func icon(for area: String) -> String {
        switch area {
        case "VIDEO":    return "video.fill"
        case "PHOTO":    return "camera.fill"
        case "GRAPHICS": return "paintpalette.fill"
        case "SOCIAL":   return "person.2.fill"
        case "COMMS":    return "dot.radiowaves.left.and.right"
        default:         return "person.fill"
        }
    }
}

// MARK: - Coverage

/// How much of a crew is filled, in one chip.
///
/// The Schedule list row and Event detail each had their own version of this —
/// a private `coverageChip` in `ScheduleView` and a `CoveragePill` on the detail
/// screen — rendering the same `ShiftCoverage` two different ways, so the same
/// event reported its staffing one way in the list and another once opened.
/// Both already tinted from `coverageTone`; this is the merge.
struct CoverageChip: View {
    /// How much weight the chip is allowed to carry.
    ///
    /// A filled capsule is right for the one hero stat on Event detail. On a
    /// list it repeats on every row, so a screen of fully-staffed events read
    /// as a column of green pills competing with the rows that actually need
    /// someone. Dense keeps the number and drops the capsule, and stays grey
    /// until the crew is short.
    enum Emphasis {
        case hero
        case dense
    }

    let coverage: ShiftCoverage
    /// Dense surfaces (a list row) take the bare count. The detail header has
    /// room for the word, which is what makes "0/5" unambiguous on first read.
    var showsLabel = false
    var emphasis: Emphasis = .hero

    private var isShort: Bool { coverage.filled < coverage.total }

    private var tint: Color {
        if emphasis == .dense && !isShort { return .secondary }
        return Color.statusText(coverageTone(coverage))
    }

    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: "person.2.fill")
                .font(.caption.weight(.semibold))
            Text(showsLabel ? "\(coverage.filled)/\(coverage.total) filled" : "\(coverage.filled)/\(coverage.total)")
                .font(.caption.weight(.semibold).monospacedDigit())
                // Without this the ratio wraps mid-token at accessibility
                // sizes -- "4/" above "6" -- which reads as a rendering fault
                // rather than a staffing number.
                .lineLimit(1)
                .fixedSize(horizontal: true, vertical: false)
        }
        .foregroundStyle(tint)
        .padding(.horizontal, emphasis == .hero ? 6 : 0)
        .padding(.vertical, emphasis == .hero ? 2 : 0)
        .background {
            if emphasis == .hero {
                Capsule().fill(Color.statusBackground(coverageTone(coverage)))
            }
        }
        .accessibilityLabel("Crew coverage: \(coverage.filled) of \(coverage.total) filled")
    }
}

/// The staffing question in words, for surfaces with room to answer it.
func crewReadinessSummary(_ coverage: ShiftCoverage?) -> String {
    guard let coverage, coverage.total > 0 else { return "No crew set up" }
    let open = max(0, coverage.total - coverage.filled)
    if open == 0 { return "Fully staffed" }
    return open == 1 ? "1 slot open" : "\(open) slots open"
}
