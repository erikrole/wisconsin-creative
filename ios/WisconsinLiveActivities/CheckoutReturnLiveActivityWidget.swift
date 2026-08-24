import ActivityKit
import SwiftUI
import WidgetKit

private extension Color {
    static let liveActivityGreen = Color(red: 0.32, green: 0.85, blue: 0.45)
    static let liveActivityAmber = Color(red: 1.0, green: 0.66, blue: 0.18)
    static let liveActivityRed = Color(red: 1.0, green: 0.27, blue: 0.23)
    static let liveActivitySurface = Color(red: 0.055, green: 0.055, blue: 0.065)

    /// Always-on display variants. The lock screen keeps rendering while the
    /// panel is dimmed, and full-intensity red burns through that dimming as a
    /// bright block instead of reading as a calm ambient glance.
    static let liveActivityGreenDim = Color(red: 0.24, green: 0.58, blue: 0.33)
    static let liveActivityAmberDim = Color(red: 0.70, green: 0.48, blue: 0.16)
    static let liveActivityRedDim = Color(red: 0.70, green: 0.23, blue: 0.20)

    /// Used when ActivityKit reports the content is past its stale date, so the
    /// card stops asserting an urgency nothing has confirmed recently.
    static let liveActivityMuted = Color(white: 0.66)
}

@main
struct WisconsinLiveActivitiesBundle: WidgetBundle {
    var body: some Widget {
        CheckoutReturnLiveActivityWidget()
    }
}

/// Resolves accent, symbol, and header copy for every glance surface in one
/// place so the lock screen, the Dynamic Island, and the Apple Watch tile can
/// never disagree about how urgent the same return is.
private struct ReturnPresentation {
    let urgency: CheckoutReturnActivityAttributes.ContentState.Urgency
    /// `endsAt` stays locally correct once the content goes stale, but nothing
    /// has confirmed the checkout is still open recently enough to keep
    /// escalating. A returned card is terminal, so it is never unconfirmed.
    let isUnconfirmed: Bool

    private let neutral: Color
    private let isDimmed: Bool

    init(
        state: CheckoutReturnActivityAttributes.ContentState,
        at date: Date,
        isStale: Bool,
        neutral: Color,
        isDimmed: Bool = false
    ) {
        let resolved = state.urgency(at: date)
        self.urgency = resolved
        self.isUnconfirmed = isStale && resolved != .returned
        self.neutral = neutral
        self.isDimmed = isDimmed
    }

    var accent: Color {
        if isUnconfirmed { return .liveActivityMuted }
        switch urgency {
        case .normal: return neutral
        case .warning: return isDimmed ? .liveActivityAmberDim : .liveActivityAmber
        case .critical, .overdue: return isDimmed ? .liveActivityRedDim : .liveActivityRed
        case .returned: return isDimmed ? .liveActivityGreenDim : .liveActivityGreen
        }
    }

    /// Sits next to words, so it says *what* the card is about and leaves the
    /// urgency to the countdown beside it.
    var headerIcon: String {
        if urgency == .returned { return "checkmark.circle.fill" }
        return isUnconfirmed ? "arrow.triangle.2.circlepath" : "shippingbox.fill"
    }

    /// Stands alone in the compact and minimal Dynamic Island presentations,
    /// where it is the only thing carrying urgency.
    var glyph: String {
        if isUnconfirmed { return "arrow.triangle.2.circlepath" }
        switch urgency {
        case .returned: return "checkmark.circle.fill"
        case .overdue: return "exclamationmark.circle.fill"
        case .critical: return "clock.badge.exclamationmark.fill"
        case .warning, .normal: return "clock.fill"
        }
    }

    var headline: String {
        if urgency == .returned { return "Returned" }
        return isUnconfirmed ? "Not updating" : "Gear return"
    }
}

private func returnAccessibilityLabel(
    context: ActivityViewContext<CheckoutReturnActivityAttributes>,
    presentation: ReturnPresentation,
    now: Date
) -> String {
    if presentation.urgency == .returned {
        return "\(context.attributes.bookingTitle), returned. Everything is checked in."
    }
    var parts = [
        context.attributes.bookingTitle,
        context.state.minuteLabel(at: now),
        "due at \(context.state.endsAt.formatted(date: .omitted, time: .shortened))",
    ]
    if let nextNeedAt = context.state.nextNeedAt {
        parts.append("needed again at \(nextNeedAt.formatted(date: .omitted, time: .shortened))")
    }
    if presentation.isUnconfirmed {
        parts.append("return status is not updating, open Wisconsin to confirm")
    }
    return parts.joined(separator: ", ")
}

struct CheckoutReturnLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: CheckoutReturnActivityAttributes.self) { context in
            CheckoutReturnActivityView(context: context)
                .activityBackgroundTint(.liveActivitySurface)
                .activitySystemActionForegroundColor(.white)
                .widgetURL(bookingDeepLink(for: context))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    TimelineView(.periodic(from: context.state.minuteBoundaryAnchor(at: .now), by: 60)) { timeline in
                        let resolved = presentation(for: context, at: timeline.date)
                        Label {
                            Text(context.attributes.bookingTitle)
                                .font(.caption.weight(.semibold))
                                .lineLimit(1)
                        } icon: {
                            Image(systemName: resolved.headerIcon)
                                .foregroundStyle(resolved.accent)
                        }
                        .accessibilityLabel(context.attributes.bookingTitle)
                    }
                }

                DynamicIslandExpandedRegion(.trailing) {
                    Text(context.state.endsAt, style: .time)
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                        .accessibilityLabel("Due at \(context.state.endsAt.formatted(date: .omitted, time: .shortened))")
                }

                DynamicIslandExpandedRegion(.bottom) {
                    TimelineView(.periodic(from: context.state.minuteBoundaryAnchor(at: .now), by: 60)) { timeline in
                        ExpandedReturnStatus(context: context, now: timeline.date)
                    }
                }
            } compactLeading: {
                TimelineView(.periodic(from: context.state.minuteBoundaryAnchor(at: .now), by: 60)) { timeline in
                    let resolved = presentation(for: context, at: timeline.date)
                    Image(systemName: resolved.glyph)
                        .foregroundStyle(resolved.accent)
                        .accessibilityHidden(true)
                }
            } compactTrailing: {
                TimelineView(.periodic(from: context.state.minuteBoundaryAnchor(at: .now), by: 60)) { timeline in
                    Text(compactLabel(for: context, at: timeline.date))
                        .font(.caption2.weight(.bold).monospacedDigit())
                        .foregroundStyle(presentation(for: context, at: timeline.date).accent)
                        .accessibilityLabel(glanceAccessibilityLabel(for: context, at: timeline.date))
                }
            } minimal: {
                TimelineView(.periodic(from: context.state.minuteBoundaryAnchor(at: .now), by: 60)) { timeline in
                    let resolved = presentation(for: context, at: timeline.date)
                    Image(systemName: resolved.glyph)
                        .foregroundStyle(resolved.accent)
                        .accessibilityLabel(glanceAccessibilityLabel(for: context, at: timeline.date))
                }
            }
            .widgetURL(bookingDeepLink(for: context))
        }
        // Paired Apple Watches surface checkout returns in the Smart Stack.
        // Without an explicit small family the system scales the lock-screen
        // layout down, which loses the countdown that is the entire point.
        .supplementalActivityFamilies([.small])
    }

    private func presentation(
        for context: ActivityViewContext<CheckoutReturnActivityAttributes>,
        at date: Date
    ) -> ReturnPresentation {
        ReturnPresentation(
            state: context.state,
            at: date,
            isStale: context.isStale,
            neutral: .primary
        )
    }

    private func bookingDeepLink(for context: ActivityViewContext<CheckoutReturnActivityAttributes>) -> URL? {
        var components = URLComponents()
        components.scheme = "wisconsin"
        components.host = "booking"
        components.path = "/\(context.attributes.bookingId)"
        return components.url
    }

    private func compactLabel(
        for context: ActivityViewContext<CheckoutReturnActivityAttributes>,
        at date: Date
    ) -> String {
        context.state.urgency(at: date) == .returned ? "Done" : context.state.minuteLabel(at: date)
    }

    /// Compact and minimal presentations carry no visible words, so VoiceOver
    /// would otherwise announce a bare symbol name or an unqualified number.
    private func glanceAccessibilityLabel(
        for context: ActivityViewContext<CheckoutReturnActivityAttributes>,
        at date: Date
    ) -> String {
        let resolved = presentation(for: context, at: date)
        if resolved.urgency == .returned {
            return "\(context.attributes.bookingTitle), returned"
        }
        let base = "\(context.attributes.bookingTitle), \(context.state.minuteLabel(at: date))"
        return resolved.isUnconfirmed ? "\(base), not updating" : base
    }
}

/// Chooses the layout for the surface ActivityKit is rendering: the iPhone
/// lock screen and CarPlay use `.medium`, the Apple Watch Smart Stack `.small`.
private struct CheckoutReturnActivityView: View {
    @Environment(\.activityFamily) private var activityFamily
    let context: ActivityViewContext<CheckoutReturnActivityAttributes>

    var body: some View {
        TimelineView(.periodic(from: context.state.minuteBoundaryAnchor(at: .now), by: 60)) { timeline in
            switch activityFamily {
            case .small:
                CheckoutReturnSmallView(context: context, now: timeline.date)
            default:
                CheckoutReturnLockScreen(context: context, now: timeline.date)
            }
        }
    }
}

private struct CheckoutReturnLockScreen: View {
    @Environment(\.isLuminanceReduced) private var isLuminanceReduced
    let context: ActivityViewContext<CheckoutReturnActivityAttributes>
    let now: Date

    private var presentation: ReturnPresentation {
        ReturnPresentation(
            state: context.state,
            at: now,
            isStale: context.isStale,
            neutral: .white,
            isDimmed: isLuminanceReduced
        )
    }

    var body: some View {
        let presentation = presentation

        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Label {
                    Text(presentation.headline)
                        .font(.caption.weight(.semibold))
                } icon: {
                    Image(systemName: presentation.headerIcon)
                }
                .foregroundStyle(presentation.accent)

                Spacer(minLength: 8)

                if presentation.urgency != .returned {
                    Text("Due \(context.state.endsAt, style: .time)")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
            }

            Text(context.attributes.bookingTitle)
                .font(.headline.weight(.semibold))
                .lineLimit(2)

            if presentation.urgency == .returned {
                Text("Everything is checked in.")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(presentation.accent)
            } else {
                HStack(alignment: .lastTextBaseline, spacing: 10) {
                    Text(context.state.minuteLabel(at: now))
                        .font(.system(.title, design: .rounded, weight: .bold).monospacedDigit())
                        .foregroundStyle(presentation.accent)
                        .contentTransition(.numericText())

                    Spacer(minLength: 8)

                    if presentation.isUnconfirmed {
                        Text("Open Wisconsin to confirm")
                            .font(.caption2.weight(.medium))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    } else if let nextNeedAt = context.state.nextNeedAt {
                        Label {
                            Text("Needed again \(nextNeedAt, style: .time)")
                        } icon: {
                            Image(systemName: "arrow.forward.circle.fill")
                        }
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                    }
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .foregroundStyle(.white)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(returnAccessibilityLabel(context: context, presentation: presentation, now: now))
    }
}

/// Apple Watch Smart Stack tile. Roughly one third of the lock-screen height,
/// so it keeps only what a wrist glance is for: what is out, and how long.
private struct CheckoutReturnSmallView: View {
    let context: ActivityViewContext<CheckoutReturnActivityAttributes>
    let now: Date

    private var presentation: ReturnPresentation {
        ReturnPresentation(
            state: context.state,
            at: now,
            isStale: context.isStale,
            neutral: .white
        )
    }

    var body: some View {
        let presentation = presentation

        VStack(alignment: .leading, spacing: 2) {
            Label {
                Text(context.attributes.bookingTitle)
                    .font(.caption2.weight(.semibold))
                    .lineLimit(1)
            } icon: {
                Image(systemName: presentation.headerIcon)
                    .foregroundStyle(presentation.accent)
            }

            if presentation.urgency == .returned {
                Text("Checked in")
                    .font(.headline.weight(.semibold))
                    .foregroundStyle(presentation.accent)
            } else {
                Text(context.state.minuteLabel(at: now))
                    .font(.system(.title3, design: .rounded, weight: .bold).monospacedDigit())
                    .foregroundStyle(presentation.accent)
                    .contentTransition(.numericText())

                Text(presentation.isUnconfirmed
                    ? "Not updating"
                    : "Due \(context.state.endsAt.formatted(date: .omitted, time: .shortened))")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(returnAccessibilityLabel(context: context, presentation: presentation, now: now))
    }
}

private struct ExpandedReturnStatus: View {
    let context: ActivityViewContext<CheckoutReturnActivityAttributes>
    let now: Date

    private var presentation: ReturnPresentation {
        ReturnPresentation(
            state: context.state,
            at: now,
            isStale: context.isStale,
            neutral: .primary
        )
    }

    var body: some View {
        let presentation = presentation

        HStack(alignment: .center, spacing: 10) {
            if presentation.urgency == .returned {
                Label("Everything checked in", systemImage: presentation.headerIcon)
                    .font(.headline.weight(.semibold))
                    .foregroundStyle(presentation.accent)
            } else {
                Text(context.state.minuteLabel(at: now))
                    .font(.title2.bold().monospacedDigit())
                    .foregroundStyle(presentation.accent)
                    .contentTransition(.numericText())

                Spacer(minLength: 8)

                if presentation.isUnconfirmed {
                    Text("Open Wisconsin to confirm")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                } else if let nextNeedAt = context.state.nextNeedAt {
                    Text("Needed again \(nextNeedAt, style: .time)")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                } else {
                    Text("Return by \(context.state.endsAt, style: .time)")
                        .font(.caption.weight(.medium).monospacedDigit())
                        .foregroundStyle(.secondary)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(returnAccessibilityLabel(context: context, presentation: presentation, now: now))
    }
}

// MARK: - Previews

private func previewAttributes() -> CheckoutReturnActivityAttributes {
    CheckoutReturnActivityAttributes(
        bookingId: "preview-booking",
        bookingTitle: "Sony FX6 Kit",
        requesterName: "Jordan Diaz",
        requesterInitials: "JD",
        requesterAvatarUrl: nil,
        returnTimeText: "Return 4:30 PM"
    )
}

private func previewState(
    urgency: CheckoutReturnActivityAttributes.ContentState.Urgency,
    endsAtOffset: TimeInterval,
    nextNeedAtOffset: TimeInterval? = nil
) -> CheckoutReturnActivityAttributes.ContentState {
    CheckoutReturnActivityAttributes.ContentState(
        endsAt: Date().addingTimeInterval(endsAtOffset),
        now: Date(),
        nextNeedAt: nextNeedAtOffset.map { Date().addingTimeInterval($0) },
        allowsExtend: urgency != .overdue && urgency != .returned,
        urgency: urgency
    )
}

#Preview("Normal", as: .content, using: CheckoutReturnActivityAttributes.preview) {
    CheckoutReturnLiveActivityWidget()
} contentStates: {
    previewState(urgency: .normal, endsAtOffset: 90 * 60)
}

#Preview("Warning", as: .content, using: CheckoutReturnActivityAttributes.preview) {
    CheckoutReturnLiveActivityWidget()
} contentStates: {
    previewState(urgency: .warning, endsAtOffset: 20 * 60, nextNeedAtOffset: 45 * 60)
}

#Preview("Critical", as: .content, using: CheckoutReturnActivityAttributes.preview) {
    CheckoutReturnLiveActivityWidget()
} contentStates: {
    previewState(urgency: .critical, endsAtOffset: 5 * 60)
}

#Preview("Overdue", as: .content, using: CheckoutReturnActivityAttributes.preview) {
    CheckoutReturnLiveActivityWidget()
} contentStates: {
    previewState(urgency: .overdue, endsAtOffset: -8 * 60)
}

#Preview("Returned", as: .content, using: CheckoutReturnActivityAttributes.preview) {
    CheckoutReturnLiveActivityWidget()
} contentStates: {
    previewState(urgency: .returned, endsAtOffset: -2 * 60)
}

extension CheckoutReturnActivityAttributes {
    fileprivate static var preview: CheckoutReturnActivityAttributes {
        previewAttributes()
    }
}
