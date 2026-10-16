import Charts
import SwiftUI

@MainActor
@Observable
final class BadgeReportModel {
    var report: BadgeReport?
    var isLoading = false
    var error: String?
    var days: Int = 30 {
        didSet {
            guard days != oldValue else { return }
            session.discard()
            sync()
        }
    }

    @ObservationIgnored private let session = ReportSession<BadgeReport>()

    func load(force: Bool = false) async {
        let window = days
        guard let token = session.begin(key: "\(window)", force: force) else { return }
        sync()
        do {
            let fetched = try await APIClient.shared.badgeReport(days: window)
            session.succeed(token, value: fetched, incomplete: false)
        } catch {
            session.fail(token, message: error.localizedDescription)
        }
        sync()
    }

    private func sync() {
        report = session.value
        isLoading = session.isLoading
        error = session.error
    }
}

struct BadgeReportView: View {
    @State private var model = BadgeReportModel()

    var body: some View {
        ReportScreen(
            title: "Badges",
            isLoading: model.isLoading,
            error: model.error,
            hasData: model.report != nil,
            retry: { Task { await model.load(force: true) } }
        ) {
            List {
                Section {
                    ReportDayPicker(
                        days: [30, 90, 365],
                        selection: Binding(get: { model.days }, set: { model.days = $0 })
                    )
                }
                if let report = model.report {
                    if let error = model.error {
                        Section { ReportStaleNotice(message: error) }
                    }
                    Section {
                        ReportMetricGrid(metrics: metrics(report))
                    }
                    leaders(report)
                    spread(report)
                    underused(report)
                    recent(report)
                }
            }
            .listStyle(.insetGrouped)
        }
        .task(id: model.days) { await model.load() }
        .refreshable { await model.load(force: true) }
    }

    private func metrics(_ report: BadgeReport) -> [ReportMetricModel] {
        [
            ReportMetricModel(
                id: "total",
                value: ReportFormatting.count(report.totalAwards),
                label: "Total awards",
                tone: .blue
            ),
            ReportMetricModel(
                id: "recent",
                value: ReportFormatting.count(report.recentAwardCount),
                label: "Awards in \(report.days ?? model.days)d",
                tone: .green,
                delta: ReportFormatting.countDelta(
                    current: report.recentAwardCount,
                    previous: report.previousRecentAwardCount,
                    window: "\(report.days ?? model.days) days"
                )
            ),
            ReportMetricModel(
                id: "definitions",
                value: ReportFormatting.count(report.activeDefinitionCount),
                label: "Active badges",
                tone: .purple
            ),
            ReportMetricModel(
                id: "manual",
                value: ReportFormatting.count(report.manualAwards),
                label: "Manual awards",
                tone: .orange,
                caption: "\(ReportFormatting.percent(report.manualAwardRate)) of all awards"
            ),
        ]
    }

    @ViewBuilder
    private func leaders(_ report: BadgeReport) -> some View {
        Section("Leaderboard") {
            if report.leaders.isEmpty {
                Text("No badge leaders yet.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(Array(report.leaders.enumerated()), id: \.element.id) { index, leader in
                    ReportRankRow(
                        title: leader.name,
                        detail: "\(index + 1)",
                        value: ReportFormatting.count(leader.count),
                        fraction: reportShare(leader.count, of: report.leaders.map(\.count))
                    )
                }
            }
        }
    }

    @ViewBuilder
    private func spread(_ report: BadgeReport) -> some View {
        let rows = report.spread
        if !rows.isEmpty {
            Section("Which badges") {
                if rows.count > 1 {
                    Chart(rows) { row in
                        BarMark(
                            x: .value("Awards", row.count),
                            y: .value("Badge", row.name)
                        )
                        .foregroundStyle(Color.chartFill(.reserved).gradient)
                        .cornerRadius(3)
                    }
                    .chartXAxis { AxisMarks(values: .automatic(desiredCount: 3)) }
                    .chartYAxis { AxisMarks(preset: .extended, position: .leading) }
                    .frame(height: CGFloat(max(140, rows.count * 28)))
                    .accessibilityLabel("Awards by badge")
                }
                ForEach(rows) { row in
                    ReportRankRow(
                        title: row.name,
                        detail: row.category.map(ReportFormatting.phrase),
                        value: ReportFormatting.count(row.count),
                        fraction: reportShare(row.count, of: rows.map(\.count))
                    )
                }
            }
        }
    }

    @ViewBuilder
    private func underused(_ report: BadgeReport) -> some View {
        let rows = report.underused
        if !rows.isEmpty {
            Section {
                ForEach(rows) { row in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(row.name).font(.subheadline)
                            if let category = row.category {
                                Text(ReportFormatting.phrase(category))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        Spacer(minLength: 8)
                        Text(ReportFormatting.count(row.count))
                            .font(.subheadline.weight(.medium))
                            .monospacedDigit()
                            .foregroundStyle(.secondary)
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("\(row.name), \(row.count) awards")
                }
            } header: {
                Text("Rarely awarded")
            }
        }
    }

    @ViewBuilder
    private func recent(_ report: BadgeReport) -> some View {
        if !report.awards.isEmpty {
            Section("Recent awards") {
                ForEach(report.awards) { award in
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(alignment: .firstTextBaseline) {
                            Text(award.definition.name)
                                .font(.subheadline.weight(.medium))
                            Spacer(minLength: 8)
                            StatusPill(
                                label: ReportFormatting.phrase(award.source),
                                tone: award.source == "MANUAL" ? .orange : .gray
                            )
                        }
                        Text(awardDetail(award))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        if let note = award.note, !note.isEmpty {
                            Text(note)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 2)
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }

    private func awardDetail(_ award: BadgeAwardRow) -> String {
        var parts = [award.user.name, ReportFormatting.timestamp(award.awardedAt)]
        if let giver = award.awardedBy?.name, !giver.isEmpty {
            parts.append("From \(giver)")
        }
        return parts.joined(separator: " · ")
    }
}
