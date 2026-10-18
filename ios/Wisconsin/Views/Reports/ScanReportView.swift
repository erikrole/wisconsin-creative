import Charts
import SwiftUI

enum ScanReportPhase: String, CaseIterable, Identifiable {
    case all
    case checkout = "CHECKOUT"
    case checkin = "CHECKIN"

    var id: String { rawValue }
    var label: String {
        switch self {
        case .all: "All"
        case .checkout: "Checkout"
        case .checkin: "Check-in"
        }
    }
    var query: String? { self == .all ? nil : rawValue }
}

private struct ScanChartPoint: Identifiable {
    let id: String
    let day: Date
    let result: String
    let count: Int
}

@MainActor
@Observable
final class ScanReportModel {
    static let pageSize = 40

    var report: ScanHistoryReport?
    var isLoading = false
    var isLoadingMore = false
    var error: String?
    private(set) var hasMore = false
    private var nextOffset = 0
    private var windowStart: String?
    private var windowEnd: String?
    private var pages = LatestRequestGeneration()
    var days: Int = 30 {
        didSet { queryChanged(from: oldValue, to: days) }
    }
    var phase: ScanReportPhase = .all {
        didSet { queryChanged(from: oldValue, to: phase) }
    }

    @ObservationIgnored private let session = ReportSession<ScanHistoryReport>()

    var key: String { "\(days)|\(phase.rawValue)" }

    func load(force: Bool = false) async {
        let query = key
        let window = days
        let phaseQuery = phase.query
        guard let token = session.begin(key: query, force: force) else { return }
        pages.invalidate()
        isLoadingMore = false
        let now = Date()
        let start = ReportFormatting.scanWindowStart(days: window, now: now)
        let end = now.ISO8601Format()
        sync()
        do {
            let fetched = try await APIClient.shared.scanReport(
                startDate: start,
                endDate: end,
                phase: phaseQuery,
                limit: Self.pageSize,
                offset: 0
            )
            if session.succeed(token, value: fetched, incomplete: false) {
                windowStart = start
                windowEnd = end
                nextOffset = fetched.rows.count
                hasMore = !fetched.rows.isEmpty && nextOffset < fetched.total
            }
        } catch {
            session.fail(token, message: error.localizedDescription)
        }
        sync()
    }

    func loadMore() async {
        guard let report, let revision = session.revision, hasMore, !isLoading, !isLoadingMore else { return }
        let query = key
        let token = pages.begin()
        let offset = nextOffset
        let phaseQuery = phase.query
        isLoadingMore = true
        defer { if pages.owns(token) { isLoadingMore = false } }
        do {
            let page = try await APIClient.shared.scanReport(
                startDate: windowStart,
                endDate: windowEnd,
                phase: phaseQuery,
                limit: Self.pageSize,
                offset: offset
            )
            guard pages.owns(token), query == key, !Task.isCancelled else { return }
            guard session.replace(report.appending(page), key: query, revision: revision) else { return }
            // Advance by server rows, including duplicates, not displayed rows.
            nextOffset = offset + page.rows.count
            hasMore = !page.rows.isEmpty && nextOffset < page.total
            sync()
        } catch {
            guard pages.owns(token), query == key, !Task.isCancelled else { return }
            session.note(error.localizedDescription)
            sync()
        }
    }

    private func queryChanged<T: Equatable>(from old: T, to new: T) {
        guard old != new else { return }
        pages.invalidate()
        isLoadingMore = false
        hasMore = false
        nextOffset = 0
        session.discard()
        sync()
    }

    private func sync() {
        report = session.value
        isLoading = session.isLoading
        error = session.error
    }
}

struct ScanReportView: View {
    @State private var model = ScanReportModel()

    var body: some View {
        ReportScreen(
            title: "Scans",
            isLoading: model.isLoading,
            error: model.error,
            hasData: model.report != nil,
            retry: { Task { await model.load(force: true) } }
        ) {
            List {
                Section {
                    ReportDayPicker(
                        days: [7, 30, 90, 0],
                        selection: Binding(get: { model.days }, set: { model.days = $0 })
                    )
                    Picker("Phase", selection: Binding(get: { model.phase }, set: { model.phase = $0 })) {
                        ForEach(ScanReportPhase.allCases) { phase in
                            Text(phase.label).tag(phase)
                        }
                    }
                    .pickerStyle(.segmented)
                }
                if let report = model.report {
                    if let error = model.error {
                        Section { ReportStaleNotice(message: error) }
                    }
                    Section {
                        ReportMetricGrid(metrics: metrics(report))
                    } header: {
                        Text(model.days == 0 ? "All scans" : "Last \(model.days) days")
                    }
                    chart(report)
                    rows(report)
                }
            }
            .listStyle(.insetGrouped)
        }
        .task(id: model.key) { await model.load() }
        .refreshable { await model.load(force: true) }
    }

    private func metrics(_ report: ScanHistoryReport) -> [ReportMetricModel] {
        let window = model.days == 0 ? "the previous range" : "\(model.days) days"
        return [
            ReportMetricModel(
                id: "total",
                value: ReportFormatting.count(report.total),
                label: "Scans",
                tone: .blue,
                delta: model.days == 0 ? nil : ReportFormatting.countDelta(
                    current: report.total,
                    previous: report.previousTotal,
                    window: window
                )
            ),
            ReportMetricModel(
                id: "rate",
                value: "\(report.successRate)%",
                label: "Succeeded",
                tone: report.successRate < 90 ? .orange : .green,
                caption: report.previousSuccessRate.map { "Was \($0)% before" }
            ),
        ]
    }

    @ViewBuilder
    private func chart(_ report: ScanHistoryReport) -> some View {
        let points = chartPoints(report.points)
        if points.count > 1, report.points.count <= 120 {
            Section {
                Chart(points) { point in
                    BarMark(
                        x: .value("Day", point.day, unit: .day),
                        y: .value("Scans", point.count)
                    )
                    .foregroundStyle(by: .value("Result", point.result))
                }
                .chartForegroundStyleScale(
                    domain: ["OK", "Failed"],
                    range: [Color.chartFill(.available), Color.chartFill(.problem)]
                )
                .chartLegend(.hidden)
                .frame(height: 160)
                .accessibilityLabel("Daily scans, successful and failed")
                HStack(spacing: 16) {
                    legendDot(.available, "Succeeded")
                    legendDot(.problem, "Failed")
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            } header: {
                Text("Volume")
            }
        }
    }

    private func legendDot(_ role: ChartRole, _ label: String) -> some View {
        HStack(spacing: 6) {
            Circle().fill(Color.chartFill(role)).frame(width: 8, height: 8)
            Text(label)
        }
        .accessibilityElement(children: .combine)
    }

    private func chartPoints(_ daily: [ScanDailyPoint]) -> [ScanChartPoint] {
        daily.flatMap { point -> [ScanChartPoint] in
            guard let day = ReportTrendPoint.parseDay(point.date) else { return [] }
            return [
                ScanChartPoint(id: "\(point.date)-ok", day: day, result: "OK", count: point.success),
                ScanChartPoint(id: "\(point.date)-fail", day: day, result: "Failed", count: point.fail),
            ].filter { $0.count > 0 }
        }
    }

    @ViewBuilder
    private func rows(_ report: ScanHistoryReport) -> some View {
        Section {
            if report.rows.isEmpty {
                Text("No scans in this period.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(report.rows) { row in
                    scanRow(row)
                }
                if model.hasMore {
                    Button {
                        Task { await model.loadMore() }
                    } label: {
                        if model.isLoadingMore {
                            ProgressView()
                        } else {
                            Text("Show more")
                        }
                    }
                    .disabled(model.isLoading || model.isLoadingMore)
                }
            }
        } header: {
            Text("Recent")
        } footer: {
            if report.total > 0 {
                Text("\(report.rows.count) of \(report.total)")
            }
        }
    }

    @ViewBuilder
    private func scanRow(_ row: ScanHistoryRow) -> some View {
        let body = VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(row.item)
                    .font(.subheadline.weight(.medium))
                Spacer(minLength: 8)
                StatusPill(
                    label: row.success ? "OK" : "Failed",
                    tone: row.success ? .green : .red
                )
            }
            Text(scanDetail(row))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)

        if let bookingId = row.bookingId, !bookingId.isEmpty {
            NavigationLink {
                BookingDetailView(bookingId: bookingId)
            } label: {
                body
            }
        } else {
            body
        }
    }

    private func scanDetail(_ row: ScanHistoryRow) -> String {
        var parts = [row.actor, ReportFormatting.scanPhase(row.phase)]
        if let title = row.bookingTitle, !title.isEmpty { parts.append(title) }
        parts.append(ReportFormatting.timestamp(row.createdAt))
        return parts.joined(separator: " · ")
    }
}
