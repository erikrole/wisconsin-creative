import Charts
import SwiftUI

@MainActor
@Observable
final class UtilizationReportModel {
    var report: UtilizationDetailReport?
    var isLoading = false
    var error: String?
    var days: Int = 30 {
        didSet {
            guard days != oldValue else { return }
            session.discard()
            sync()
        }
    }

    @ObservationIgnored private let session = ReportSession<UtilizationDetailReport>()

    func load(force: Bool = false) async {
        let window = days
        guard let token = session.begin(key: "\(window)", force: force) else { return }
        sync()
        do {
            let fetched = try await APIClient.shared.utilizationDetailReport(days: window)
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

struct UtilizationReportView: View {
    @State private var model = UtilizationReportModel()
    @State private var showAllIdle = false

    var body: some View {
        ReportScreen(
            title: "Utilization",
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
                    if report.isIncomplete, let sections = report.partialFailures {
                        Section { ReportIncompleteNotice(sections: sections) }
                    }
                    summary(report)
                    status(report)
                    mostUsed(report)
                    breakdown("By location", rows: (report.byLocation ?? []).map {
                        RankedCount(id: $0.id, name: $0.location, count: $0.count)
                    })
                    breakdown("By type", rows: (report.byType ?? []).map {
                        RankedCount(id: $0.id, name: ReportFormatting.phrase($0.type), count: $0.count)
                    })
                    breakdown("By category", rows: (report.byCategory ?? []).map {
                        RankedCount(id: $0.id, name: $0.category, count: $0.count)
                    })
                    breakdown("By department", rows: (report.byDepartment ?? []).map {
                        RankedCount(id: $0.id, name: $0.department, count: $0.count)
                    })
                    idle(report)
                }
            }
            .listStyle(.insetGrouped)
        }
        .task(id: model.days) { await model.load() }
        .refreshable { await model.load(force: true) }
    }

    @ViewBuilder
    private func summary(_ report: UtilizationDetailReport) -> some View {
        Section {
            ReportMetricGrid(metrics: [
                ReportMetricModel(
                    id: "rate",
                    value: report.custody.map { ReportFormatting.percent($0.utilizationRate) } ?? "—",
                    label: "Utilization",
                    tone: .blue
                ),
                ReportMetricModel(
                    id: "days",
                    value: report.custody.map { ReportFormatting.days($0.custodyDays) } ?? "—",
                    label: "Custody days",
                    tone: .green
                ),
                ReportMetricModel(
                    id: "used",
                    value: report.custody.map { ReportFormatting.count($0.assetsUsed) } ?? "—",
                    label: "Assets used",
                    tone: .blue,
                    caption: report.activeAssets.map { "of \(ReportFormatting.count($0)) active" }
                ),
                ReportMetricModel(
                    id: "checkouts",
                    value: report.custody.map { ReportFormatting.count($0.checkoutCount) } ?? "—",
                    label: "Checkouts",
                    tone: .green
                ),
            ])
        } header: {
            Text(report.days.map { "Last \($0) days" } ?? "This period")
        }
    }

    @ViewBuilder
    private func status(_ report: UtilizationDetailReport) -> some View {
        let slices = ReportStatusSlice.build(from: report.statusCounts)
        if !slices.isEmpty {
            Section("Where gear is right now") {
                Chart(slices) { slice in
                    SectorMark(
                        angle: .value("Assets", slice.count),
                        innerRadius: .ratio(0.62),
                        angularInset: 1.5
                    )
                    .cornerRadius(3)
                    .foregroundStyle(Color.chartFill(slice.role))
                }
                .chartLegend(.hidden)
                .frame(height: 160)
                .accessibilityLabel("Asset status")
                ForEach(slices) { slice in
                    HStack(spacing: 10) {
                        Circle()
                            .fill(Color.chartFill(slice.role))
                            .frame(width: 9, height: 9)
                            .accessibilityHidden(true)
                        Text(slice.label)
                            .font(.subheadline)
                        Spacer(minLength: 8)
                        Text(ReportFormatting.count(slice.count))
                            .font(.subheadline.weight(.medium))
                            .monospacedDigit()
                            .foregroundStyle(.secondary)
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("\(slice.label): \(slice.count)")
                }
            }
        }
    }

    @ViewBuilder
    private func mostUsed(_ report: UtilizationDetailReport) -> some View {
        let ranked = report.custody?.ranked ?? []
        if !ranked.isEmpty {
            Section {
                Chart(ranked) { asset in
                    BarMark(
                        x: .value("Days out", asset.custodyDays),
                        y: .value("Asset", asset.assetTag),
                        height: .ratio(0.62)
                    )
                    .foregroundStyle(Color.chartFill(.active).gradient)
                    .cornerRadius(3)
                }
                .chartXAxis { AxisMarks(values: .automatic(desiredCount: 4)) }
                .chartYAxis { AxisMarks(preset: .extended, position: .leading) }
                .frame(height: CGFloat(max(140, ranked.count * 28)))
                .accessibilityLabel("Most used gear by days in custody")
            } header: {
                Text("Most used")
            } footer: {
                Text("Days in someone's custody, so a long shoot outranks a dozen same-day grabs.")
            }
        }
    }

    @ViewBuilder
    private func breakdown(_ title: String, rows: [RankedCount]) -> some View {
        let visible = rows.filter { $0.count > 0 }.sorted { $0.count > $1.count }
        if !visible.isEmpty {
            Section(title) {
                ForEach(visible) { row in
                    ReportRankRow(
                        title: row.name,
                        detail: nil,
                        value: ReportFormatting.count(row.count),
                        fraction: reportShare(row.count, of: visible.map(\.count))
                    )
                }
            }
        }
    }

    @ViewBuilder
    private func idle(_ report: UtilizationDetailReport) -> some View {
        if let custody = report.custody {
            Section("Sitting on the shelf") {
                shelf(custody.idleCount, "Idle this period", "No custody in this window", custody.idleCount > 0 ? .orange : .green)
                shelf(custody.neverCheckedOutCount, "Never checked out", "No checkout history", custody.neverCheckedOutCount > 0 ? .red : .green)
            }
            let idleAssets = custody.idle
            if !idleAssets.isEmpty {
                let shown = showAllIdle ? idleAssets : Array(idleAssets.prefix(8))
                Section {
                    ForEach(shown) { asset in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(asset.name.isEmpty ? asset.assetTag : asset.name)
                                .font(.subheadline)
                            Text(idleDetail(asset))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .accessibilityElement(children: .combine)
                    }
                    if idleAssets.count > 8 {
                        Button(showAllIdle ? "Show less" : "Show \(idleAssets.count - 8) more") {
                            showAllIdle.toggle()
                        }
                    }
                } header: {
                    Text("Idle gear")
                }
            }
        }
    }

    private func shelf(_ value: Int, _ title: String, _ detail: String, _ tone: StatusTone) -> some View {
        HStack(spacing: 12) {
            Text(ReportFormatting.count(value))
                .font(.title3.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(Color.statusText(tone))
                .frame(minWidth: 36, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.subheadline.weight(.medium))
                Text(detail).font(.caption).foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(value) \(title). \(detail)")
    }

    private struct RankedCount: Identifiable {
        let id: String
        let name: String
        let count: Int
    }

    private func idleDetail(_ asset: UtilizationIdleAsset) -> String {
        var parts = [asset.assetTag]
        if let category = asset.category, !category.isEmpty { parts.append(category) }
        if let last = asset.lastCheckedOutAt {
            parts.append("Last out \(ReportFormatting.timestamp(last))")
        } else {
            parts.append("Never checked out")
        }
        return parts.joined(separator: " · ")
    }
}
