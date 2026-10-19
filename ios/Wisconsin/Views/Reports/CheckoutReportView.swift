import Charts
import SwiftUI

@MainActor
@Observable
final class CheckoutReportModel {
    var report: CheckoutDetailReport?
    var isLoading = false
    var error: String?
    var days: Int = 30 {
        didSet {
            guard days != oldValue else { return }
            session.discard()
            sync()
        }
    }

    @ObservationIgnored private let session = ReportSession<CheckoutDetailReport>()

    func load(force: Bool = false) async {
        let window = days
        guard let token = session.begin(key: "\(window)", force: force) else { return }
        sync()
        do {
            let fetched = try await APIClient.shared.checkoutDetailReport(days: window)
            session.succeed(token, value: fetched, incomplete: fetched.isIncomplete)
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

struct CheckoutReportView: View {
    @State private var model = CheckoutReportModel()
    @State private var selectedDay: Date?

    var body: some View {
        ReportScreen(
            title: "Checkouts",
            isLoading: model.isLoading,
            error: model.error,
            hasData: model.report != nil,
            retry: { Task { await model.load(force: true) } }
        ) {
            List {
                Section {
                    ReportDayPicker(
                        days: [7, 30, 90],
                        selection: Binding(get: { model.days }, set: { model.days = $0 })
                    )
                }
                if let report = model.report {
                    if let error = model.error {
                        Section { ReportStaleNotice(message: error) }
                    }
                    if report.isIncomplete, let sections = report.partialFailures {
                        Section { ReportIncompleteNotice(sections: sections) }
                    }
                    Section {
                        ReportMetricGrid(metrics: metrics(report))
                    } header: {
                        Text("Last \(report.days) days")
                    } footer: {
                        Text("Open and completed checkouts only.")
                    }
                    trendSection(report)
                    requesterSection(report)
                    recentSection(report)
                    if report.overdueCheckouts > 0 {
                        Section {
                            NavigationLink {
                                OverdueReportView()
                            } label: {
                                Label("Who has overdue gear", systemImage: "clock.badge.exclamationmark")
                            }
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
        }
        .task(id: model.days) { await model.load() }
        .refreshable { await model.load(force: true) }
    }

    private func metrics(_ report: CheckoutDetailReport) -> [ReportMetricModel] {
        [
            ReportMetricModel(
                id: "total",
                value: ReportFormatting.count(report.totalCheckouts),
                label: "Checkouts",
                tone: .green,
                delta: ReportFormatting.countDelta(
                    current: report.totalCheckouts,
                    previous: report.previousTotalCheckouts,
                    window: "\(report.days) days"
                )
            ),
            ReportMetricModel(
                id: "overdue",
                value: ReportFormatting.count(report.overdueCheckouts),
                label: "Overdue now",
                tone: report.overdueCheckouts > 0 ? .red : .gray
            ),
        ]
    }

    @ViewBuilder
    private func trendSection(_ report: CheckoutDetailReport) -> some View {
        let points = ReportTrendPoint.build(from: report.dailyTrend ?? [])
        if points.count > 1, points.count <= 120 {
            Section("Activity") {
                Chart {
                    ForEach(points) { point in
                        LineMark(
                            x: .value("Day", point.day),
                            y: .value("Checkouts", point.count)
                        )
                        .foregroundStyle(Color.chartFill(.active))
                        .interpolationMethod(.monotone)
                        .lineStyle(StrokeStyle(lineWidth: 2))
                    }
                    if let selectedDay, let match = ReportTrendPoint.nearest(to: selectedDay, in: points) {
                        RuleMark(x: .value("Day", match.day))
                            .foregroundStyle(Color.chartFill(.neutral).opacity(0.45))
                        PointMark(
                            x: .value("Day", match.day),
                            y: .value("Checkouts", match.count)
                        )
                        .foregroundStyle(Color.chartFill(.active))
                    }
                }
                .chartXSelection(value: $selectedDay)
                .chartYAxis { AxisMarks(position: .leading, values: .automatic(desiredCount: 3)) }
                .chartXAxis {
                    AxisMarks(values: .automatic(desiredCount: 4)) { _ in
                        AxisGridLine()
                        AxisValueLabel(format: .dateTime.month(.abbreviated).day())
                    }
                }
                .frame(height: 160)
                .accessibilityLabel("Daily checkouts over the last \(report.days) days")
                if let selectedDay, let match = ReportTrendPoint.nearest(to: selectedDay, in: points) {
                    Text("\(match.day.formatted(.dateTime.month(.abbreviated).day())) · \(match.count)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                }
            }
        }
    }

    @ViewBuilder
    private func requesterSection(_ report: CheckoutDetailReport) -> some View {
        let ranks = report.ranks
        if !ranks.isEmpty {
            Section("Who checked gear out") {
                if ranks.count > 1 {
                    Chart(Array(ranks.enumerated()), id: \.offset) { _, rank in
                        BarMark(
                            x: .value("Checkouts", rank.count),
                            y: .value("Person", rank.name)
                        )
                        .foregroundStyle(Color.chartFill(.active).gradient)
                        .cornerRadius(3)
                    }
                    .chartXAxis { AxisMarks(values: .automatic(desiredCount: 3)) }
                    .chartYAxis { AxisMarks(preset: .extended, position: .leading) }
                    .frame(height: CGFloat(max(120, ranks.count * 28)))
                    .accessibilityLabel("People with the most checkouts")
                }
                ForEach(Array(ranks.enumerated()), id: \.offset) { _, rank in
                    ReportRankRow(
                        title: rank.name,
                        detail: nil,
                        value: ReportFormatting.count(rank.count),
                        fraction: reportShare(rank.count, of: ranks.map(\.count))
                    )
                }
            }
        }
    }

    @ViewBuilder
    private func recentSection(_ report: CheckoutDetailReport) -> some View {
        if report.rows.isEmpty {
            Section("Recent") {
                Text("No checkouts in this period.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        } else {
            Section("Recent") {
                ForEach(report.rows) { row in
                    NavigationLink {
                        BookingDetailView(bookingId: row.id)
                    } label: {
                        checkoutRow(row)
                    }
                }
            }
        }
    }

    private func checkoutRow(_ row: CheckoutReportRow) -> some View {
        let status = ReportFormatting.bookingStatus(status: row.status, isOverdue: row.isOverdue)
        return VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(row.title)
                    .font(.subheadline.weight(.medium))
                Spacer(minLength: 8)
                StatusPill(label: status.label, tone: status.tone)
            }
            Text(rowDetail(row))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }

    private func rowDetail(_ row: CheckoutReportRow) -> String {
        var parts = [row.requester]
        if let location = row.location, !location.isEmpty { parts.append(location) }
        let items = "\(row.itemCount) item\(row.itemCount == 1 ? "" : "s")"
        parts.append(items)
        if let endsAt = row.endsAt {
            parts.append("Due \(ReportFormatting.timestamp(endsAt))")
        }
        return parts.joined(separator: " · ")
    }
}
