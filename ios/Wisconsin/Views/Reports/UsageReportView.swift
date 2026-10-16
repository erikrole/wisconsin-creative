import Charts
import SwiftUI

@MainActor
@Observable
final class UsageReportModel {
    var report: UsageReport?
    var isLoading = false
    var error: String?
    var forbidden = false
    var days: Int = 30 {
        didSet {
            guard days != oldValue else { return }
            session.discard()
            forbidden = false
            sync()
        }
    }

    @ObservationIgnored private let session = ReportSession<UsageReport>()

    func load(force: Bool = false) async {
        let window = days
        guard let token = session.begin(key: "\(window)", force: force) else { return }
        sync()
        do {
            let fetched = try await APIClient.shared.usageReport(days: window)
            forbidden = false
            session.succeed(token, value: fetched, incomplete: false)
        } catch {
            forbidden = Self.isForbidden(error)
            let message = forbidden
                ? "Usage counts are limited to the owner."
                : error.localizedDescription
            session.fail(token, message: message)
        }
        sync()
    }

    private static func isForbidden(_ error: Error) -> Bool {
        if case APIError.httpError(let status, _) = error, status == 403 { return true }
        return false
    }

    private func sync() {
        report = session.value
        isLoading = session.isLoading
        error = session.error
    }
}

struct UsageReportView: View {
    @State private var model = UsageReportModel()

    var body: some View {
        Group {
            if model.forbidden && model.report == nil {
                ContentUnavailableView(
                    "Owner only",
                    systemImage: "lock",
                    description: Text("Usage counts are limited to the owner.")
                )
                .navigationTitle("Usage")
                .navigationBarTitleDisplayMode(.inline)
            } else {
                ReportScreen(
                    title: "Usage",
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
                            Section {
                                ReportMetricGrid(metrics: [
                                    ReportMetricModel(
                                        id: "events",
                                        value: ReportFormatting.count(report.totalEvents),
                                        label: "Counted events",
                                        tone: .blue
                                    ),
                                    ReportMetricModel(
                                        id: "people",
                                        value: ReportFormatting.count(report.activeUsers),
                                        label: "Active people",
                                        tone: .green,
                                        caption: "Pseudonymous yearly identifiers"
                                    ),
                                ])
                            } footer: {
                                Text("Counts only. Names, URLs, and scanned values are not in this report.")
                            }
                            countChart("Surfaces", rows: report.surfaces ?? [])
                            countList("Platforms", rows: report.platforms ?? [])
                            countList("Events", rows: report.events ?? [])
                            versions(report)
                            countList("Notification delivery", rows: report.notifications?.deliveries ?? [])
                            countList("Push readiness", rows: report.notifications?.pushReadiness ?? [])
                            countList("Preference changes", rows: report.notifications?.preferenceChanges ?? [])
                            countList("Responses", rows: report.notifications?.responses ?? [])
                            countList("Time to respond", rows: report.notifications?.timeToAct ?? [])
                            countList("Background jobs", rows: report.health?.jobs ?? [])
                            countList("Crashes and hangs", rows: report.health?.diagnostics ?? [])
                        }
                    }
                    .listStyle(.insetGrouped)
                }
            }
        }
        .task(id: model.days) { await model.load() }
        .refreshable { await model.load(force: true) }
    }

    @ViewBuilder
    private func countChart(_ title: String, rows: [UsageCount]) -> some View {
        let ranked = rows.sorted { $0.count > $1.count }
        if ranked.count > 1, ranked.count <= 8 {
            Section(title) {
                Chart(ranked) { row in
                    BarMark(
                        x: .value("Count", row.count),
                        y: .value("Name", ReportFormatting.phrase(row.name))
                    )
                    .foregroundStyle(Color.chartFill(.active).gradient)
                    .cornerRadius(3)
                }
                .chartXAxis { AxisMarks(values: .automatic(desiredCount: 3)) }
                .chartYAxis { AxisMarks(preset: .extended, position: .leading) }
                .frame(height: CGFloat(max(120, ranked.count * 28)))
                .accessibilityLabel(title)
            }
        } else {
            countList(title, rows: ranked)
        }
    }

    @ViewBuilder
    private func countList(_ title: String, rows: [UsageCount]) -> some View {
        if !rows.isEmpty {
            Section(title) {
                ForEach(rows) { row in
                    ReportRankRow(
                        title: ReportFormatting.phrase(row.name),
                        detail: nil,
                        value: ReportFormatting.count(row.count),
                        fraction: reportShare(row.count, of: rows.map(\.count))
                    )
                }
            }
        }
    }

    @ViewBuilder
    private func versions(_ report: UsageReport) -> some View {
        let rows = report.versions ?? []
        if !rows.isEmpty {
            Section("App versions") {
                ForEach(rows) { row in
                    ReportRankRow(
                        title: versionTitle(row),
                        detail: nil,
                        value: ReportFormatting.count(row.count),
                        fraction: reportShare(row.count, of: rows.map(\.count))
                    )
                }
            }
        }
    }

    private func versionTitle(_ row: UsageVersion) -> String {
        let platform = ReportFormatting.phrase(row.platform)
        if let version = row.version, !version.isEmpty {
            return "\(platform) \(version)"
        }
        return platform
    }
}
