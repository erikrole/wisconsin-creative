import SwiftUI

struct AccountabilityPersonView: View {
    let userId: String
    var model: AccountabilityListModel

    private var person: AccountabilityPerson? {
        model.visibleReport?.person(userId) ?? model.report?.person(userId)
    }

    var body: some View {
        Group {
            if let person {
                detail(person)
            } else {
                ContentUnavailableView {
                    Label("Not on this list", systemImage: "person.slash")
                } description: {
                    Text("This person is not in the list that is open.")
                }
            }
        }
        .navigationTitle(person?.name ?? "Accountability")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func detail(_ person: AccountabilityPerson) -> some View {
        List {
            Section {
                HStack(spacing: 12) {
                    UserAvatarView(name: person.name, avatarUrl: person.avatarUrl, size: 44)
                    VStack(alignment: .leading, spacing: 2) {
                        if let area = person.areaLabel {
                            Text(area)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                        if !person.active {
                            StatusPill(label: "Inactive", tone: .gray)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }

            Section {
                LabeledContent("Late returns", value: "\(person.lateEventCount)")
                LabeledContent("Still out") {
                    Text(person.stillOutLabel ?? "None")
                        .foregroundStyle(person.activeOverdueCount > 0 ? Color.statusText(.red) : Color.secondary)
                }
                LabeledContent("On time", value: person.onTimeLabel)
                LabeledContent("Total late time", value: accountabilityLateDuration(person.totalLateHours))
                LabeledContent("Longest", value: accountabilityLateDuration(person.worstLateHours))
            }

            Section {
                if person.incidents.isEmpty {
                    Text("No late returns in this list.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(person.incidents) { incident in
                        NavigationLink(value: BookingRouteId(id: incident.bookingId)) {
                            AccountabilityIncidentRow(incident: incident)
                        }
                    }
                }
            } header: {
                Text("Checkouts")
            } footer: {
                Text("Open a checkout to see the gear. Changing it stays on the checkout screen.")
            }
        }
        .listStyle(.insetGrouped)
    }
}

private struct AccountabilityIncidentRow: View {
    let incident: AccountabilityIncident

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(incident.title)
                    .font(.body.weight(.semibold))
                    .frame(maxWidth: .infinity, alignment: .leading)
                StatusPill(label: incident.style.label, tone: incident.style.tone)
            }
            if !incident.itemSummary.isEmpty {
                Text(incident.itemSummary)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Text(incident.detailLine)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }
}
