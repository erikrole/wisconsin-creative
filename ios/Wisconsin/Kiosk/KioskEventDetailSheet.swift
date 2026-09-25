import SwiftUI

// MARK: - Idle event surfaces
//
// The Today/Tomorrow event sections, event rows, and the read-only event
// detail sheet. Extracted verbatim from KioskIdleView.swift (2026-07-02
// rework Slice 5a).

struct KioskEventSection: View {
    let title: String
    let events: [KioskEvent]
    let hasWorkerDetails: Bool
    let onSelect: (KioskEvent) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.callout.weight(.bold))
                .tracking(1.2)
                .foregroundStyle(KioskText.secondary)

            if events.isEmpty {
                Text("No events")
                    .font(KioskType.rowDetail)
                    .foregroundStyle(KioskText.muted)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 2)
            } else {
                ForEach(events) { event in
                    KioskEventRow(event: event, hasWorkerDetails: hasWorkerDetails) {
                        onSelect(event)
                    }
                }
            }
        }
    }
}

private struct KioskEventRow: View {
    let event: KioskEvent
    let hasWorkerDetails: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 12) {
                Text(timeLabel)
                    .font(.subheadline.weight(.semibold).monospacedDigit())
                    .foregroundStyle(Color.kioskRed)
                    .frame(minWidth: 88, alignment: .leading)
                    .fixedSize()
                Text(event.title)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(KioskText.primary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)
                Spacer()
                if !event.assignedUsers.isEmpty {
                    KioskEventAvatarStack(users: event.assignedUsers, totalCount: event.assignedUserCount)
                } else if event.shiftCount > 0, !hasWorkerDetails {
                    Text("Details pending")
                        .font(KioskType.chip)
                        .foregroundStyle(KioskText.tertiary)
                } else if event.shiftCount > 0 {
                    KioskEventShiftBadge(count: event.shiftCount)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .kioskCard(KioskSurface.cardRaised, radius: KioskRadius.md, stroke: KioskStroke.standard)
        }
        .buttonStyle(KioskPressStyle())
        .accessibilityElement(children: .combine)
        .accessibilityHint("Opens event details")
    }

    private var timeLabel: String {
        if event.displayAllDay {
            return "All day"
        }
        if Calendar.current.isDateInToday(event.startsAt) {
            return event.startsAt.formatted(.dateTime.hour().minute())
        }
        return event.startsAt.formatted(.dateTime.weekday(.abbreviated).hour().minute())
    }
}

private struct KioskEventAvatarStack: View {
    let users: [KioskEvent.AssignedUser]
    let totalCount: Int

    var body: some View {
        HStack(spacing: -8) {
            ForEach(users.prefix(4)) { user in
                eventAvatar(for: user)
            }
            if totalCount > 4 {
                Text("+\(totalCount - 4)")
                    .font(KioskType.micro)
                    .foregroundStyle(KioskText.primary)
                    .frame(width: 30, height: 30)
                    .background(KioskSurface.placeholder, in: Circle())
                    .overlay(Circle().stroke(Color.black.opacity(0.8), lineWidth: 1.5))
            }
        }
        .accessibilityLabel("\(totalCount) assigned")
    }

    @ViewBuilder
    private func eventAvatar(for user: KioskEvent.AssignedUser) -> some View {
        if let urlString = user.avatarUrl, let url = URL(string: urlString) {
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().scaledToFill()
                default:
                    eventInitials(for: user)
                }
            }
            .frame(width: 30, height: 30)
            .clipShape(Circle())
            .overlay(Circle().stroke(Color.black.opacity(0.8), lineWidth: 1.5))
        } else {
            eventInitials(for: user)
        }
    }

    private func eventInitials(for user: KioskEvent.AssignedUser) -> some View {
        Text(user.initials)
            .font(KioskType.micro)
            .foregroundStyle(KioskText.primary)
            .frame(width: 30, height: 30)
            .background(KioskSurface.placeholder, in: Circle())
            .overlay(Circle().stroke(Color.black.opacity(0.8), lineWidth: 1.5))
    }
}

struct KioskEventDetailSheet: View {
    @Environment(\.dismiss) private var dismiss
    let event: KioskEvent
    let capabilities: KioskDashboard.Capabilities
    var onStartCheckout: (() -> Void)? = nil
    var onScan: ((String) -> Void)? = nil

    var body: some View {
        ZStack {
            KioskSurface.base.ignoresSafeArea()
            VStack(alignment: .leading, spacing: 18) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(spacing: 10) {
                            Text(eventDayLabel)
                                .font(KioskType.overline)
                                .tracking(1.4)
                                .foregroundStyle(KioskText.tertiary)
                            // "0 shifts" beside "No assigned workers" said nothing twice.
                            if event.shiftCount > 0 {
                                KioskEventShiftBadge(count: event.shiftCount)
                            }
                        }
                        Text(event.title)
                            .font(.title.weight(.heavy))
                            .foregroundStyle(KioskText.primary)
                            .lineLimit(2)
                            .minimumScaleFactor(0.74)
                    }
                    Spacer()
                    Button("Done") { dismiss() }
                        .font(KioskType.sectionTitle)
                        .foregroundStyle(KioskText.primary)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(KioskSurface.cardSelected, in: Capsule())
                }

                VStack(spacing: 10) {
                    KioskEventTimeRow(label: "Event", value: eventTimeLabel)
                    // Only rows with an answer: "Call · Not set" was a field
                    // label a student cannot act on.
                    if !event.displayAllDay, let callTimeLabel {
                        KioskEventTimeRow(label: "Call", value: callTimeLabel)
                    }
                }

                if let onStartCheckout {
                    Button {
                        dismiss(); onStartCheckout()
                    } label: {
                        Label("Start Checkout for This Event", systemImage: "barcode.viewfinder")
                            .font(KioskType.sectionTitle).frame(maxWidth: .infinity, minHeight: 54)
                    }
                    .kioskButtonRole(.primary)
                }

                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 8) {
                        Text("Working")
                            .font(KioskType.actionTitle)
                            .foregroundStyle(KioskText.primary)
                        if !event.assignedUsers.isEmpty {
                            Text("\(event.assignedUserCount)")
                                .font(.caption.weight(.bold).monospacedDigit())
                                .foregroundStyle(KioskText.tertiary)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(KioskSurface.cardRaised, in: Capsule())
                        }
                    }

                    if event.assignedUsers.isEmpty {
                        Text(workerEmptyMessage)
                            .font(.body.weight(.medium))
                            .foregroundStyle(KioskText.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(16)
                            .background(KioskSurface.card, in: RoundedRectangle(cornerRadius: KioskRadius.lg))
                    } else {
                        ScrollView {
                            LazyVStack(spacing: 8) {
                                ForEach(event.assignedUsers) { user in
                                    KioskEventWorkerRow(user: user, eventAllDay: event.displayAllDay)
                                }
                            }
                        }
                        .scrollIndicators(.hidden)
                    }
                }

                Spacer(minLength: 0)
            }
            .padding(28)

            if let onScan {
                HIDScannerField(onScan: onScan).frame(width: 1, height: 1).opacity(0)
            }
        }
    }

    private var eventDayLabel: String {
        let displayDay = event.kioskDisplayStartDay
        if Calendar.current.isDateInToday(displayDay) {
            return "Today"
        }
        if Calendar.current.isDateInTomorrow(displayDay) {
            return "Tomorrow"
        }
        return displayDay.formatted(.dateTime.weekday(.wide).month().day())
    }

    private var eventTimeLabel: String {
        if event.displayAllDay {
            return allDayDateLabel
        }
        return formatRange(start: event.startsAt, end: event.endsAt)
    }

    private var callTimeLabel: String? {
        guard capabilities.eventCallTimes, let callStartsAt = event.callStartsAt else { return nil }
        return formatRange(start: callStartsAt, end: event.callEndsAt)
    }

    private var workerEmptyMessage: String {
        if !capabilities.eventWorkerDetails, event.shiftCount > 0 {
            return "Worker details are not available from this API version yet."
        }
        return "No assigned workers listed yet."
    }

    private var allDayDateLabel: String {
        let start = event.kioskDisplayStartDay
        let end = event.kioskDisplayEndDay
        if Calendar.current.isDate(start, inSameDayAs: end) {
            return start.formatted(.dateTime.month(.abbreviated).day())
        }
        return "\(start.formatted(.dateTime.month(.abbreviated).day())) - \(end.formatted(.dateTime.month(.abbreviated).day()))"
    }

    private func formatRange(start: Date, end: Date?) -> String {
        let startLabel = start.formatted(.dateTime.hour().minute())
        guard let end else { return startLabel }
        return "\(startLabel) - \(end.formatted(.dateTime.hour().minute()))"
    }
}

private struct KioskEventTimeRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 14) {
            Text(label.uppercased())
                .font(KioskType.micro)
                .tracking(1)
                .foregroundStyle(KioskText.tertiary)
                .frame(width: 48, alignment: .leading)
            Text(value)
                .font(.title2.weight(.bold).monospacedDigit())
                .foregroundStyle(KioskText.primary)
                .lineLimit(1)
                .minimumScaleFactor(0.72)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 14)
        .padding(.vertical, 13)
        .background(KioskSurface.cardRaised, in: RoundedRectangle(cornerRadius: KioskRadius.lg))
        .overlay(
            RoundedRectangle(cornerRadius: KioskRadius.lg)
                .stroke(KioskStroke.standard, lineWidth: 1)
        )
    }
}

private struct KioskEventShiftBadge: View {
    let count: Int

    var body: some View {
        Text("\(count) shift\(count == 1 ? "" : "s")")
            .font(KioskType.chip)
            .foregroundStyle(KioskText.secondary)
            .lineLimit(1)
            .padding(.horizontal, 9)
            .padding(.vertical, 5)
            .background(KioskSurface.cardRaised, in: Capsule())
    }
}

private struct KioskEventWorkerRow: View {
    let user: KioskEvent.AssignedUser
    let eventAllDay: Bool

    var body: some View {
        HStack(spacing: 10) {
            avatar
            VStack(alignment: .leading, spacing: 2) {
                Text(user.name)
                    .font(KioskType.rowTitle)
                    .foregroundStyle(KioskText.primary)
                    .lineLimit(1)
                if let detail = workerDetail {
                    Text(detail)
                        .font(KioskType.chip)
                        .foregroundStyle(KioskText.secondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.82)
                }
            }
            Spacer()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(KioskSurface.cardRaised, in: RoundedRectangle(cornerRadius: KioskRadius.md))
        .overlay(
            RoundedRectangle(cornerRadius: KioskRadius.md)
                .stroke(KioskStroke.standard, lineWidth: 1)
        )
    }

    private var avatar: some View {
        KioskAvatar(url: user.avatarUrl, initials: user.initials, size: 38)
    }

    private var workerDetail: String? {
        let area = user.area?.capitalized
        if eventAllDay {
            return area
        }
        guard let callStartsAt = user.callStartsAt else { return area }
        let callLabel = formatRange(start: callStartsAt, end: user.callEndsAt)
        if let area {
            return "\(area) · \(callLabel)"
        }
        return callLabel
    }

    private func formatRange(start: Date, end: Date?) -> String {
        let startLabel = start.formatted(.dateTime.hour().minute())
        guard let end else { return startLabel }
        return "\(startLabel) - \(end.formatted(.dateTime.hour().minute()))"
    }
}
