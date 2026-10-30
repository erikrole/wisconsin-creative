import SwiftUI

/// Pushes a traveler's profile without colliding with booking-id navigation.
struct EventTravelPersonRoute: Hashable {
    var id: String
}

/// Read-only away-game travel roster. Adding and removing people stays on the website.
@MainActor
@Observable
final class EventTravelModel {
    var members: [EventTravelMember]?
    var isLoading = false
    var error: String?

    @ObservationIgnored private var loads = LatestRequestGeneration()

    func load(event: ScheduleEvent, role: String?, force: Bool) async {
        if !EventTravelAccess.canRead(role: role, event: event) {
            members = nil
            error = nil
            isLoading = false
            loads.invalidate()
            return
        }
        if !force, members != nil, error == nil {
            return
        }
        let token = loads.begin()
        if members == nil {
            isLoading = true
        }
        error = nil
        defer {
            if loads.owns(token) {
                isLoading = false
            }
        }
        do {
            let next = try await APIClient.shared.eventTravelMembers(eventId: event.id)
            guard loads.owns(token), !Task.isCancelled else { return }
            members = next
            error = nil
        } catch is CancellationError {
            return
        } catch APIError.unauthorized {
            guard loads.owns(token), !Task.isCancelled else { return }
            if members == nil {
                error = "Couldn't load travelers."
            }
            return
        } catch {
            guard loads.owns(token), !Task.isCancelled else { return }
            if members == nil {
                self.error = "Couldn't load travelers."
            } else {
                self.error = "Couldn't refresh. The list is unchanged."
            }
        }
    }
}

struct EventTravelSection: View {
    var event: ScheduleEvent
    var role: String?
    var model: EventTravelModel

    var body: some View {
        VStack(alignment: .leading, spacing: Brand.Space.sm) {
            BrandSectionHeader(
                "Travel",
                subtitle: "Who is going to this away game.",
                systemImage: "airplane"
            )
            travelBody
        }
        .navigationDestination(for: EventTravelPersonRoute.self) { route in
            UserDetailView(userId: route.id)
        }
    }

    @ViewBuilder
    private var travelBody: some View {
        if model.isLoading && model.members == nil {
            loadingCard
        } else {
            if let message = model.error, model.members == nil {
                failureCard(message)
            } else {
                rosterCard
            }
        }
    }

    private var loadingCard: some View {
        HStack {
            ProgressView()
            Text("Loading travelers")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .brandCard()
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Loading travelers")
    }

    private func failureCard(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: Brand.Space.sm) {
            Text(message)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Button("Retry") {
                Task { await model.load(event: event, role: role, force: true) }
            }
            .buttonStyle(.bordered)
        }
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .brandCard()
    }

    @ViewBuilder
    private var rosterCard: some View {
        let members = model.members ?? []
        VStack(alignment: .leading, spacing: 0) {
            if members.isEmpty {
                emptyCopy
            } else {
                rosterRows(members)
            }
            if let message = model.error, model.members != nil {
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .padding(.top, Brand.Space.sm)
            } else {
                EmptyView()
            }
        }
        .brandCard()
    }

    private var emptyCopy: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("No travelers yet")
                .font(.body)
            Text("Travelers appear once the crew is assigned.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func rosterRows(_ members: [EventTravelMember]) -> some View {
        ForEach(Array(members.enumerated()), id: \.element.id) { index, member in
            travelerLink(member)
            if index < members.count - 1 {
                Divider()
            }
        }
    }

    private func travelerLink(_ member: EventTravelMember) -> some View {
        NavigationLink(value: EventTravelPersonRoute(id: member.user.id)) {
            travelerLabel(member)
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private func travelerLabel(_ member: EventTravelMember) -> some View {
        HStack(alignment: .center, spacing: Brand.Space.sm) {
            UserAvatarView(
                name: member.user.name,
                avatarUrl: member.user.avatarUrl,
                size: 36,
                fallbackBackground: Color(.secondarySystemFill),
                fallbackForeground: .secondary,
                showsBorder: false
            )
            VStack(alignment: .leading, spacing: 2) {
                Text(member.user.name)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(.primary)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                if let area = areaLabel(member) {
                    Text(area)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                if let notes = noteLabel(member) {
                    Text(notes)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                }
            }
            Spacer(minLength: Brand.Space.sm)
            Image(systemName: "chevron.right")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.tertiary)
                .accessibilityHidden(true)
        }
        .frame(minHeight: 44)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel(member))
        .accessibilityHint("Opens their profile")
    }

    private func areaLabel(_ member: EventTravelMember) -> String? {
        guard let area = member.user.primaryArea?.trimmingCharacters(in: .whitespacesAndNewlines), !area.isEmpty else {
            return nil
        }
        return area.shiftAreaLabel
    }

    private func noteLabel(_ member: EventTravelMember) -> String? {
        guard let notes = member.notes?.trimmingCharacters(in: .whitespacesAndNewlines), !notes.isEmpty else {
            return nil
        }
        return notes
    }

    private func accessibilityLabel(_ member: EventTravelMember) -> String {
        var parts = [member.user.name]
        if let area = areaLabel(member) {
            parts.append(area)
        }
        parts.append(spokenRole(member.user.role))
        if let notes = noteLabel(member) {
            parts.append(notes)
        }
        return parts.joined(separator: ", ")
    }

    private func spokenRole(_ role: String) -> String {
        switch role {
        case "ADMIN": "Admin"
        case "STAFF": "Staff"
        case "STUDENT": "Student"
        case "COLLABORATOR": "Collaborator"
        default: role.capitalized
        }
    }
}
