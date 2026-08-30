import SwiftUI

@MainActor
@Observable
final class OverdueReportViewModel {
    var report: OverdueReport?
    var isLoading = false
    var error: String?
    var lastLoadedAt: Date?

    private static let freshnessWindow: TimeInterval = 60
    private var loadRequests = LatestRequestGeneration()

    func load(forceRefresh: Bool = false) async {
        if !forceRefresh, let last = lastLoadedAt, Date().timeIntervalSince(last) < Self.freshnessWindow, report != nil {
            return
        }
        if !forceRefresh, isLoading { return }
        let requestToken = loadRequests.begin()
        isLoading = true
        if forceRefresh { error = nil }
        defer {
            if loadRequests.owns(requestToken) {
                isLoading = false
            }
        }
        do {
            let fetchedReport = try await APIClient.shared.overdueReport()
            guard loadRequests.owns(requestToken), !Task.isCancelled else { return }
            report = fetchedReport
            error = nil
            lastLoadedAt = Date()
        } catch {
            guard loadRequests.owns(requestToken), !Task.isCancelled else { return }
            // Keep stale data visible if a refresh fails.
            self.error = error.localizedDescription
        }
    }
}

struct OverdueReportView: View {
    @State private var vm = OverdueReportViewModel()
    @State private var expanded: Set<String> = []

    var body: some View {
        Group {
            if vm.report == nil && vm.isLoading {
                ProgressView("Loading overdue report")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let error = vm.error, vm.report == nil {
                ContentUnavailableView {
                    Label("Couldn't load report", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(error)
                } actions: {
                    Button("Retry") { Task { await vm.load(forceRefresh: true) } }
                        .buttonStyle(.borderedProminent)
                }
            } else if let report = vm.report {
                if report.leaderboard.isEmpty {
                    ContentUnavailableView(
                        "No overdue checkouts",
                        systemImage: "checkmark.seal",
                        description: Text("Everything is back on time.")
                    )
                } else {
                    list(report)
                }
            }
        }
        .navigationTitle("Overdue")
        .navigationBarTitleDisplayMode(.inline)
        .task { await vm.load() }
        .refreshable { await vm.load(forceRefresh: true) }
        .navigationDestination(for: String.self) { bookingId in
            BookingDetailView(bookingId: bookingId)
        }
    }

    @ViewBuilder
    private func list(_ report: OverdueReport) -> some View {
        List {
            Section {
                summaryRow(report)
                    .listRowBackground(Color.statusBackground(.red))
            }
            if let stale = vm.error, vm.report != nil {
                Section {
                    Label(stale, systemImage: "wifi.exclamationmark")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Section("Sorted by total overdue time") {
                ForEach(Array(report.leaderboard.enumerated()), id: \.element.id) { index, entry in
                    leaderboardRow(entry: entry, rank: index + 1)
                    if expanded.contains(entry.userId), let bookings = entry.bookings {
                        ForEach(bookings) { booking in
                            NavigationLink(value: booking.id) {
                                bookingRow(booking)
                            }
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    private func summaryRow(_ report: OverdueReport) -> some View {
        HStack(spacing: 16) {
            metric(value: "\(report.totalOverdueBookings)", label: "Overdue")
            Divider().frame(height: 28)
            metric(value: "\(report.leaderboard.count)", label: report.leaderboard.count == 1 ? "Person" : "People")
            Spacer()
            Image(systemName: "exclamationmark.circle.fill")
                .foregroundStyle(Color.statusText(.red))
                .font(.title2)
                .accessibilityHidden(true)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(summaryAccessibilityLabel(report))
    }

    private func summaryAccessibilityLabel(_ report: OverdueReport) -> String {
        let bookingsLabel = "\(report.totalOverdueBookings) overdue checkout\(report.totalOverdueBookings == 1 ? "" : "s")"
        let peopleLabel = "\(report.leaderboard.count) \(report.leaderboard.count == 1 ? "person" : "people")"
        return "\(bookingsLabel) across \(peopleLabel)"
    }

    private func metric(value: String, label: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value)
                .font(.title3.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(Color.statusText(.red))
            Text(label.uppercased())
                .font(.caption2.weight(.semibold))
                .tracking(0.5)
                .foregroundStyle(.secondary)
        }
    }

    private func leaderboardRow(entry: OverdueLeaderboardEntry, rank: Int) -> some View {
        Button {
            toggleExpand(entry.userId)
        } label: {
            HStack(spacing: 12) {
                Text("#\(rank)")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .frame(width: 28, alignment: .leading)
                VStack(alignment: .leading, spacing: 2) {
                    Text(entry.name)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.primary)
                    Text(formatOverdue(entry.totalOverdueHours) + " total")
                        .font(.caption)
                        .foregroundStyle(Color.statusText(.red))
                }
                Spacer(minLength: 8)
                StatusPill(label: "\(entry.overdueCount)", tone: .red)
                Image(systemName: expanded.contains(entry.userId) ? "chevron.up" : "chevron.down")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(entry.name), \(entry.overdueCount) overdue, \(formatOverdue(entry.totalOverdueHours)) total")
        .accessibilityHint(expanded.contains(entry.userId) ? "Collapses bookings list" : "Expands bookings list")
    }

    private func bookingRow(_ booking: OverdueBookingSummary) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(booking.title)
                    .font(.subheadline.weight(.medium))
                    .lineLimit(1)
                Spacer()
                Text(formatOverdue(booking.overdueHours))
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color.statusText(.red))
                    .monospacedDigit()
            }
            Text(secondaryLine(for: booking))
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(2)
        }
        .padding(.leading, 28)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Overdue \(formatOverdue(booking.overdueHours)): \(booking.title), \(secondaryLine(for: booking))")
    }

    private func secondaryLine(for booking: OverdueBookingSummary) -> String {
        var parts: [String] = []
        if !booking.location.isEmpty { parts.append(booking.location) }
        let countLabel = "\(booking.itemCount) item" + (booking.itemCount == 1 ? "" : "s")
        parts.append(countLabel)
        if !booking.items.isEmpty {
            parts.append(booking.items.joined(separator: ", "))
        }
        return parts.joined(separator: " · ")
    }

    private func toggleExpand(_ userId: String) {
        if expanded.contains(userId) {
            expanded.remove(userId)
        } else {
            expanded.insert(userId)
        }
        Haptics.selection()
    }

    private func formatOverdue(_ hours: Int) -> String {
        if hours < 1 { return "<1h" }
        if hours < 24 { return "\(hours)h" }
        let days = hours / 24
        let rem = hours % 24
        return rem > 0 ? "\(days)d \(rem)h" : "\(days)d"
    }
}
