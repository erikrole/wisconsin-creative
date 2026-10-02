import SwiftUI

struct EventSelectionCard: View {
    let events: [ScheduleEvent]
    let selectedEvents: [ScheduleEvent]
    let isLoading: Bool
    let error: String?
    var usesFormCard = true
    let onRetry: () -> Void
    let onToggle: (ScheduleEvent) -> Void
    let onRemove: (ScheduleEvent) -> Void

    var body: some View {
        Group {
            if usesFormCard {
                FormCard { eventPickerBody }
            } else {
                eventPickerBody
            }
        }
    }

    private var eventPickerBody: some View {
        VStack(alignment: .leading, spacing: Brand.Space.sm) {
                if !selectedEvents.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(selectedEvents) { event in
                                EventChip(event: event) { onRemove(event) }
                            }
                        }
                        .padding(.vertical, 1)
                    }
                    .accessibilityLabel("Selected linked events")
                }

                if isLoading {
                    HStack(spacing: 10) {
                        ProgressView()
                        Text("Loading upcoming events…")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                } else if let error {
                    HStack(spacing: 12) {
                        Image(systemName: "wifi.exclamationmark")
                            .foregroundStyle(Color.statusText(.orange))
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 3) {
                            Text("Couldn't load events")
                                .font(.subheadline.weight(.medium))
                            Text(error)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(2)
                        }
                        Spacer()
                        Button("Retry", action: onRetry)
                            .buttonStyle(.bordered)
                            .controlSize(.small)
                    }
                } else if events.isEmpty {
                    Text("No upcoming events. You can still create an ad hoc reservation.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                } else {
                    NavigationLink {
                        AllEventsPickerView(
                            events: events,
                            selectedEvents: selectedEvents,
                            onToggle: onToggle
                        )
                    } label: {
                        HStack(spacing: Brand.Space.sm) {
                            Image(systemName: selectedEvents.isEmpty ? "calendar.badge.plus" : "calendar.badge.checkmark")
                                .foregroundStyle(Color.statusText(.purple))
                                .frame(width: 30, height: 30)
                                .background(Color.statusBackground(.purple), in: Circle())
                            Text(selectedEvents.isEmpty ? "Choose Event" : "Edit Linked Events")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(.primary)
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.tertiary)
                        }
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(selectedEvents.isEmpty ? "Choose from \(events.count) upcoming events" : "Edit \(selectedEvents.count) linked events")
                }
        }
    }
}

private enum EventScopeFilter: String, CaseIterable, Identifiable {
    case all = "All"
    case home = "Home"
    case away = "Away"
    case neutral = "Neutral"
    case nonGame = "Non-game"

    var id: String { rawValue }
}

/// Full upcoming-events list behind the "All events" row: searchable, same
/// toggle semantics and five-event cap as the inline card.
struct AllEventsPickerView: View {
    let events: [ScheduleEvent]
    let selectedEvents: [ScheduleEvent]
    let onToggle: (ScheduleEvent) -> Void

    @State private var search = ""
    @State private var scope: EventScopeFilter = .all
    @Environment(\.dismiss) private var dismiss

    private var filtered: [ScheduleEvent] {
        let scoped = events.filter(matchesScope)
        let query = search.trimmingCharacters(in: .whitespaces)
        guard !query.isEmpty else { return scoped }
        return scoped.filter { event in
            event.shortBookingEventTitle.localizedCaseInsensitiveContains(query)
                || event.bookingEventSubtitle.localizedCaseInsensitiveContains(query)
        }
    }

    /// Upcoming events first, grouped the way people talk about them; anything
    /// already past sinks to "Earlier" so it never leads the list.
    private var sections: [(title: String, events: [ScheduleEvent])] {
        let calendar = Calendar.current
        let startOfToday = calendar.startOfDay(for: Date())
        let startOfTomorrow = calendar.date(byAdding: .day, value: 1, to: startOfToday) ?? startOfToday
        let startOfDayAfter = calendar.date(byAdding: .day, value: 2, to: startOfToday) ?? startOfTomorrow
        let endOfWeek = calendar.date(byAdding: .day, value: 7, to: startOfToday) ?? startOfDayAfter
        let sorted = filtered.sorted { $0.startsAt < $1.startsAt }
        func bucket(_ event: ScheduleEvent) -> Int {
            if event.startsAt < startOfToday { return 4 }
            if event.startsAt < startOfTomorrow { return 0 }
            if event.startsAt < startOfDayAfter { return 1 }
            if event.startsAt < endOfWeek { return 2 }
            return 3
        }
        let titles = ["Today", "Tomorrow", "This week", "Later", "Earlier"]
        return titles.indices.compactMap { index in
            let items = sorted.filter { bucket($0) == index }
            let ordered = index == 4 ? items.reversed() : items
            return items.isEmpty ? nil : (titles[index], Array(ordered))
        }
    }

    /// Filters on the same resolved venue the row's rail and scope label draw,
    /// so picking "Neutral" cannot hide a row this list is labelling Neutral.
    /// Reading `isHome` directly filed every explicitly neutral game that sits
    /// on a home-mapped venue under Home instead.
    private func matchesScope(_ event: ScheduleEvent) -> Bool {
        switch scope {
        case .all: return true
        case .home: return event.venue == .home
        case .away: return event.venue == .away
        case .neutral: return event.venue == .neutral
        case .nonGame: return event.venue == .nonGame
        }
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 10) {
                ScrollView(.horizontal, showsIndicators: false) {
                    eventFilterRow
                        .padding(.horizontal, 16)
                }
                .padding(.horizontal, -16)

                ForEach(sections, id: \.title) { section in
                    Text(section.title.uppercased())
                        .font(.caption2.weight(.bold))
                        .tracking(0.8)
                        .foregroundStyle(.secondary)
                        .padding(.top, 8)
                    ForEach(section.events) { event in
                        let isSelected = selectedEvents.contains(where: { $0.id == event.id })
                        EventPickRow(
                            event: event,
                            isSelected: isSelected,
                            isDisabled: selectedEvents.count >= BookingEventLimits.maxLinkedEvents && !isSelected
                        ) {
                            onToggle(event)
                        }
                    }
                }

                if filtered.isEmpty {
                    if !search.isEmpty {
                        ContentUnavailableView.search(text: search)
                    } else {
                        ContentUnavailableView(
                            "No \(scope.rawValue.lowercased()) events",
                            systemImage: "calendar",
                            description: Text("Try another event filter.")
                        )
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 16)
        }
        .background(Color(.systemGroupedBackground))
        .searchable(text: $search, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search events")
        .navigationTitle("Events")
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            Button {
                dismiss()
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "checkmark")
                    Text(selectedEvents.isEmpty
                         ? "Pick an event"
                         : "Use \(selectedEvents.count) event\(selectedEvents.count == 1 ? "" : "s")")
                }
                .font(.headline)
                .frame(maxWidth: .infinity, minHeight: 52)
            }
            .buttonStyle(.plain)
            .foregroundStyle(selectedEvents.isEmpty ? Color.secondary : Color.white)
            .background(
                selectedEvents.isEmpty ? Color(.tertiarySystemFill) : Color.statusText(.purple),
                in: RoundedRectangle(cornerRadius: 16)
            )
            .disabled(selectedEvents.isEmpty)
            .accessibilityLabel("Confirm event selection")
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(.bar)
        }
    }

    private var eventFilterRow: some View {
        HStack(spacing: 6) {
            ForEach(EventScopeFilter.allCases) { filter in
                Button {
                    scope = filter
                    Haptics.selection()
                } label: {
                    Text(filter.rawValue)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(scope == filter ? Color.white : Color.primary)
                        .padding(.horizontal, 14)
                        .frame(minHeight: 40)
                        .background(
                            scope == filter ? Color.statusText(.purple) : Color(.secondarySystemGroupedBackground),
                            in: Capsule()
                        )
                        .fixedSize(horizontal: true, vertical: false)
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(scope == filter ? .isSelected : [])
            }
        }
    }
}

struct EventPickRow: View {
    let event: ScheduleEvent
    let isSelected: Bool
    let isDisabled: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 12) {
                StatusRail(color: event.bookingEventRailColor)

                VStack(alignment: .leading, spacing: 4) {
                    Text(event.shortBookingEventTitle)
                        .font(.headline)
                        .foregroundStyle(isSelected ? Color.white : Color.primary)
                        .lineLimit(1)
                    Text(event.bookingEventPickerDate)
                        .font(.subheadline)
                        .foregroundStyle(isSelected ? Color.white.opacity(0.85) : Color.secondary)
                        .lineLimit(1)
                    if let venue = event.bookingEventPickerVenue {
                        Text(venue)
                            .font(.subheadline)
                            .foregroundStyle(isSelected ? Color.white.opacity(0.85) : Color.secondary)
                            .lineLimit(1)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                VStack(alignment: .trailing, spacing: 6) {
                    Text(event.bookingEventScopeLabel)
                        .font(.caption.weight(.bold))
                        .foregroundStyle(isSelected ? Color.white : event.bookingEventRailColor)
                        .lineLimit(1)
                    if isSelected {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.title3)
                            .foregroundStyle(.white)
                            .accessibilityHidden(true)
                    }
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, minHeight: 84, alignment: .leading)
            .background(
                isSelected ? Color.statusText(.purple) : Color(.secondarySystemGroupedBackground),
                in: RoundedRectangle(cornerRadius: 16)
            )
            .contentShape(RoundedRectangle(cornerRadius: 16))
            .opacity(isDisabled ? 0.45 : 1)
        }
        .buttonStyle(.plain)
        .disabled(isDisabled)
        .accessibilityLabel(accessibilityLabel)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private var accessibilityLabel: String {
        let selected = isSelected ? "Selected" : "Not selected"
        return "\(event.shortBookingEventTitle), \(event.bookingEventScopeLabel), \(event.bookingEventPickerDetail), \(selected)"
    }
}

struct EventChip: View {
    let event: ScheduleEvent
    let onRemove: () -> Void

    var body: some View {
        HStack(spacing: 6) {
            Text(event.shortBookingEventTitle)
                .font(.caption.weight(.semibold))
                .lineLimit(1)
            Button(action: onRemove) {
                Image(systemName: "xmark.circle.fill")
                    .font(.caption)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Remove \(event.shortBookingEventTitle)")
        }
        .foregroundStyle(Color.statusText(.purple))
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .background(Color.statusBackground(.purple), in: Capsule())
    }
}
