import SwiftUI

struct EventSelectionCard: View {
    let events: [ScheduleEvent]
    let selectedEvents: [ScheduleEvent]
    let isLoading: Bool
    let error: String?
    let onRetry: () -> Void
    let onToggle: (ScheduleEvent) -> Void
    let onRemove: (ScheduleEvent) -> Void

    var body: some View {
        FormCard {
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

    private func matchesScope(_ event: ScheduleEvent) -> Bool {
        let isGame = event.opponent?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
        return switch scope {
        case .all: true
        case .home: isGame && event.isHome == true
        case .away: isGame && event.isHome == false
        case .neutral: isGame && event.isHome == nil
        case .nonGame: !isGame
        }
    }

    var body: some View {
        List {
            Section {
                ViewThatFits(in: .horizontal) {
                    eventFilterRow
                    ScrollView(.horizontal, showsIndicators: false) {
                        eventFilterRow
                    }
                }
                .listRowInsets(EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12))
            }

            ForEach(filtered) { event in
                EventPickRow(
                    event: event,
                    isSelected: selectedEvents.contains(where: { $0.id == event.id }),
                    isDisabled: selectedEvents.count >= BookingEventLimits.maxLinkedEvents && !selectedEvents.contains(where: { $0.id == event.id })
                ) {
                    onToggle(event)
                }
            }
            if filtered.isEmpty {
                if !search.isEmpty {
                    ContentUnavailableView.search(text: search)
                        .listRowBackground(Color.clear)
                } else {
                    ContentUnavailableView(
                        "No \(scope.rawValue.lowercased()) events",
                        systemImage: "calendar",
                        description: Text("Try another event filter.")
                    )
                    .listRowBackground(Color.clear)
                }
            }
        }
        .searchable(text: $search, prompt: "Search events")
        .navigationTitle("Events")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "checkmark")
                }
                .fontWeight(.semibold)
                .tint(Color.statusText(.purple))
                .disabled(selectedEvents.isEmpty)
                .accessibilityLabel("Confirm event selection")
            }
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
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(scope == filter ? Color.statusText(.purple) : Color.secondary)
                        .padding(.horizontal, 9)
                        .frame(minHeight: 32)
                        .background(
                            scope == filter ? Color.statusBackground(.purple) : Color(.secondarySystemGroupedBackground),
                            in: Capsule()
                        )
                        .overlay(
                            Capsule().strokeBorder(scope == filter ? Color.statusText(.purple).opacity(0.35) : Color.hairline)
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
            HStack(spacing: 10) {
                StatusRail(color: event.bookingEventRailColor)

                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundStyle(isSelected ? Color.statusText(.purple) : Color(.systemGray3))
                    .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 8) {
                        Text(event.shortBookingEventTitle)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.primary)
                            .lineLimit(1)
                        Spacer(minLength: 8)
                        Text(event.bookingEventScopeLabel)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(event.bookingEventRailColor)
                            .lineLimit(1)
                    }
                    Text(event.bookingEventPickerDate)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                    if let venue = event.bookingEventPickerVenue {
                        Text(venue)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(minHeight: 68)
            .contentShape(Rectangle())
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
