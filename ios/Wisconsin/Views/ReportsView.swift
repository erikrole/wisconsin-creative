import Charts
import SwiftUI

// MARK: - View model

private enum ReportLoadOutcome<Value: Sendable>: Sendable {
    case success(Value)
    case failure(String)
    case cancelled
}

@MainActor
@Observable
final class ReportsViewModel {
    typealias UtilizationLoader = @MainActor (Int) async throws -> UtilizationReport
    typealias CheckoutLoader = @MainActor (Int) async throws -> CheckoutActivityReport

    var utilization: UtilizationReport?
    var checkouts: CheckoutActivityReport?
    var isLoading = false
    var error: String?
    var lastLoadedAt: Date?
    var days: Int = ReportPeriod.default.days {
        didSet {
            guard days != oldValue else { return }
            // A window change invalidates freshness: the numbers mean something
            // different now.
            lastLoadedAt = nil
            utilization = nil
            checkouts = nil
            error = nil
        }
    }

    private static let freshnessWindow: TimeInterval = 60
    private let utilizationLoader: UtilizationLoader
    private let checkoutLoader: CheckoutLoader
    @ObservationIgnored private var activeLoadID: UUID?
    @ObservationIgnored private var activeWindow: Int?

    var hasAnyData: Bool { utilization != nil || checkouts != nil }

    init(
        utilizationLoader: @escaping UtilizationLoader = { days in
            try await APIClient.shared.utilizationReport(days: days)
        },
        checkoutLoader: @escaping CheckoutLoader = { days in
            try await APIClient.shared.checkoutActivityReport(days: days)
        }
    ) {
        self.utilizationLoader = utilizationLoader
        self.checkoutLoader = checkoutLoader
    }

    func load(forceRefresh: Bool = false) async {
        if !forceRefresh,
           let last = lastLoadedAt,
           Date().timeIntervalSince(last) < Self.freshnessWindow,
           hasAnyData {
            return
        }

        let window = days
        // A duplicate request for the same window can share the active work.
        // A new period must become the owner immediately, even while the old
        // request is still unwinding after SwiftUI cancels its task.
        guard !isLoading || activeWindow != window else { return }

        let loadID = UUID()
        activeLoadID = loadID
        activeWindow = window
        isLoading = true
        if forceRefresh { error = nil }

        async let utilizationTask = loadUtilization(days: window)
        async let checkoutTask = loadCheckouts(days: window)
        let (utilizationOutcome, checkoutOutcome) = await (utilizationTask, checkoutTask)

        // Only the newest request may publish or clear loading state.
        guard activeLoadID == loadID, window == days else { return }
        if Task.isCancelled {
            activeLoadID = nil
            activeWindow = nil
            isLoading = false
            return
        }

        var messages: [String] = []
        var utilizationComplete = false
        var checkoutsComplete = false

        switch utilizationOutcome {
        case .success(let result):
            utilization = result
            if let failures = result.partialFailures, !failures.isEmpty {
                messages.append("Utilization is incomplete: \(failures.joined(separator: ", ")).")
            } else {
                utilizationComplete = true
            }
        case .failure(let message):
            messages.append("Utilization could not refresh: \(message)")
        case .cancelled:
            break
        }

        switch checkoutOutcome {
        case .success(let result):
            checkouts = result
            if let failures = result.partialFailures, !failures.isEmpty {
                messages.append("Checkout activity is incomplete: \(failures.joined(separator: ", ")).")
            } else {
                checkoutsComplete = true
            }
        case .failure(let message):
            messages.append("Checkout activity could not refresh: \(message)")
        case .cancelled:
            break
        }

        error = messages.isEmpty ? nil : messages.joined(separator: " ")
        lastLoadedAt = utilizationComplete && checkoutsComplete ? Date() : nil
        activeLoadID = nil
        activeWindow = nil
        isLoading = false
    }

    private func loadUtilization(days: Int) async -> ReportLoadOutcome<UtilizationReport> {
        do {
            return .success(try await utilizationLoader(days))
        } catch {
            if Task.isCancelled {
                return .cancelled
            }
            return .failure(error.localizedDescription)
        }
    }

    private func loadCheckouts(days: Int) async -> ReportLoadOutcome<CheckoutActivityReport> {
        do {
            return .success(try await checkoutLoader(days))
        } catch {
            if Task.isCancelled {
                return .cancelled
            }
            return .failure(error.localizedDescription)
        }
    }
}

// MARK: - Period

/// Windows both report endpoints accept. Checkouts allows 7/30/90 and
/// utilization allows 30/90/365, so the shared picker uses the overlap.
enum ReportPeriod: Int, CaseIterable, Identifiable {
    case thirty = 30
    case ninety = 90

    static let `default`: ReportPeriod = .thirty

    var id: Int { rawValue }
    var days: Int { rawValue }
    var label: String { "\(rawValue)d" }
}

// MARK: - View

struct ReportsView: View {
    @State private var vm = ReportsViewModel()
    @State private var selectedDay: Date?

    var body: some View {
        Group {
            if !vm.hasAnyData && vm.isLoading {
                ProgressView("Loading reports")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let error = vm.error, !vm.hasAnyData {
                ContentUnavailableView {
                    Label("Couldn't load reports", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(error)
                } actions: {
                    Button("Retry") { Task { await vm.load(forceRefresh: true) } }
                        .buttonStyle(.borderedProminent)
                }
            } else {
                content
            }
        }
        .navigationTitle("Reports")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: vm.days) { await vm.load() }
        .refreshable { await vm.load(forceRefresh: true) }
    }

    private var content: some View {
        List {
            Section {
                Picker("Period", selection: $vm.days) {
                    ForEach(ReportPeriod.allCases) { period in
                        Text(period.label).tag(period.days)
                    }
                }
                .pickerStyle(.segmented)
                .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
            }

            if let stale = vm.error, vm.hasAnyData {
                Section {
                    Label(stale, systemImage: "wifi.exclamationmark")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            summarySection
            activitySection
            statusSection
            mostUsedSection
            shelfSection
        }
        .listStyle(.insetGrouped)
    }

    // MARK: Summary

    @ViewBuilder
    private var summarySection: some View {
        Section {
            HStack(alignment: .top, spacing: 16) {
                if let custody = vm.utilization?.custody {
                    metric(
                        value: percentLabel(custody.utilizationRate),
                        label: "Utilization",
                        tone: .blue
                    )
                    Divider().frame(height: 34)
                }
                if let checkouts = vm.checkouts {
                    metric(
                        value: "\(checkouts.totalCheckouts)",
                        label: "Checkouts",
                        tone: .green,
                        delta: deltaLabel(
                            current: checkouts.totalCheckouts,
                            previous: checkouts.previousTotalCheckouts
                        )
                    )
                    Divider().frame(height: 34)
                    metric(
                        value: "\(checkouts.overdueCheckouts)",
                        label: "Overdue",
                        tone: checkouts.overdueCheckouts > 0 ? .red : .gray
                    )
                }
                Spacer(minLength: 0)
            }
            .padding(.vertical, 4)

            if let overdue = vm.checkouts?.overdueCheckouts, overdue > 0 {
                NavigationLink {
                    OverdueReportView()
                } label: {
                    Label("Who has overdue gear", systemImage: "clock.badge.exclamationmark")
                        .font(.subheadline)
                }
            }
        } header: {
            Text("Last \(vm.days) days")
        } footer: {
            if let custody = vm.utilization?.custody, let active = vm.utilization?.activeAssets {
                Text("\(custody.assetsUsed) of \(active) active assets went out at least once.")
            }
        }
    }

    private func metric(value: String, label: String, tone: StatusTone, delta: DeltaLabel? = nil) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value)
                .font(.title3.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(Color.statusText(tone))
            Text(label.uppercased())
                .font(.caption2.weight(.semibold))
                .tracking(0.5)
                .foregroundStyle(.secondary)
            if let delta {
                Label(delta.text, systemImage: delta.systemImage)
                    .labelStyle(.titleAndIcon)
                    .font(.caption2.weight(.medium))
                    .monospacedDigit()
                    .foregroundStyle(Color.statusText(delta.tone))
                    .padding(.top, 1)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            delta.map { "\(label): \(value), \($0.accessibilityText)" } ?? "\(label): \(value)"
        )
    }

    // MARK: Activity

    @ViewBuilder
    private var activitySection: some View {
        if let trend = vm.checkouts?.dailyTrend, trend.count > 1 {
            let points = ReportTrendPoint.build(from: trend)
            Section("Checkout activity") {
                VStack(alignment: .leading, spacing: 6) {
                    calloutHeader(points: points)

                    Chart {
                        ForEach(points) { point in
                            AreaMark(
                                x: .value("Day", point.day),
                                y: .value("Checkouts", point.count)
                            )
                            // Mirrors web's --report-chart-active-soft.
                            .foregroundStyle(
                                .linearGradient(
                                    colors: [
                                        Color.chartFill(.active).opacity(0.20),
                                        Color.chartFill(.active).opacity(0.02),
                                    ],
                                    startPoint: .top,
                                    endPoint: .bottom
                                )
                            )
                            .interpolationMethod(.monotone)

                            LineMark(
                                x: .value("Day", point.day),
                                y: .value("Checkouts", point.count)
                            )
                            .foregroundStyle(Color.chartFill(.active))
                            .lineStyle(StrokeStyle(lineWidth: 2))
                            .interpolationMethod(.monotone)
                        }

                        if let selectedDay, let match = ReportTrendPoint.nearest(to: selectedDay, in: points) {
                            RuleMark(x: .value("Day", match.day))
                                .foregroundStyle(Color.chartFill(.neutral).opacity(0.4))
                                .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 3]))

                            PointMark(
                                x: .value("Day", match.day),
                                y: .value("Checkouts", match.count)
                            )
                            .foregroundStyle(Color.chartFill(.active))
                            .symbolSize(90)
                        }
                    }
                    .chartXSelection(value: $selectedDay)
                    .chartYAxis {
                        AxisMarks(position: .leading, values: .automatic(desiredCount: 3))
                    }
                    .chartXAxis {
                        AxisMarks(values: .automatic(desiredCount: 4)) { value in
                            AxisGridLine()
                            AxisValueLabel(format: .dateTime.month(.abbreviated).day())
                        }
                    }
                    .frame(height: 170)
                    .accessibilityLabel("Daily checkout activity over the last \(vm.days) days")
                }
                .padding(.vertical, 4)
            }
        }
    }

    @ViewBuilder
    private func calloutHeader(points: [ReportTrendPoint]) -> some View {
        // The chart is small, so the selected value is spelled out above it
        // rather than crammed into a floating annotation.
        if let day = selectedDay, let match = ReportTrendPoint.nearest(to: day, in: points) {
            HStack(spacing: 6) {
                Text(match.day, format: .dateTime.weekday(.abbreviated).month(.abbreviated).day())
                    .font(.caption.weight(.semibold))
                Text("\(match.count) checkout\(match.count == 1 ? "" : "s")")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                Button("Clear") { selectedDay = nil }
                    .font(.caption)
                    .buttonStyle(.plain)
                    .foregroundStyle(Color.statusText(.blue))
            }
            .monospacedDigit()
        } else {
            Text("Touch and hold the chart to inspect a day.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    // MARK: Status donut

    @ViewBuilder
    private var statusSection: some View {
        if let utilization = vm.utilization {
            let slices = ReportStatusSlice.build(from: utilization.statusCounts)
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
                    .frame(height: 172)
                    .padding(.vertical, 4)
                    .accessibilityLabel("Asset status distribution")

                    ForEach(slices) { slice in
                        HStack(spacing: 10) {
                            Circle()
                                .fill(Color.chartFill(slice.role))
                                .frame(width: 9, height: 9)
                            Text(slice.label)
                                .font(.subheadline)
                            Spacer(minLength: 8)
                            Text("\(slice.count)")
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
    }

    // MARK: Most used

    @ViewBuilder
    private var mostUsedSection: some View {
        if let topUsed = vm.utilization?.custody?.topUsed, !topUsed.isEmpty {
            Section {
                Chart(topUsed) { asset in
                    BarMark(
                        x: .value("Days out", asset.custodyDays),
                        y: .value("Asset", asset.assetTag),
                        // Without an explicit height the bars render as
                        // hairlines against a ten-band category axis.
                        height: .ratio(0.62)
                    )
                    .foregroundStyle(Color.chartFill(.active).gradient)
                    .cornerRadius(3)
                }
                .chartXAxis {
                    AxisMarks(values: .automatic(desiredCount: 4))
                }
                // The default category axis reserves a leading gutter sized to
                // the longest asset tag. A custom AxisMarks builder does not,
                // which printed the labels on top of the bars.
                .chartYAxis {
                    AxisMarks(preset: .extended, position: .leading)
                }
                .frame(height: CGFloat(max(160, topUsed.count * 30)))
                .padding(.vertical, 4)
                .accessibilityLabel("Most used gear by days in custody")
            } header: {
                Text("Most used gear")
            } footer: {
                Text("Days spent in someone's custody, so one long shoot outranks a dozen same-day grabs.")
            }
        }
    }

    // MARK: Idle shelf

    @ViewBuilder
    private var shelfSection: some View {
        if let custody = vm.utilization?.custody {
            Section {
                shelfRow(
                    value: custody.idleCount,
                    title: "Idle this period",
                    detail: "No custody in the last \(vm.days) days",
                    tone: custody.idleCount > 0 ? .orange : .green
                )
                shelfRow(
                    value: custody.neverCheckedOutCount,
                    title: "Never checked out",
                    detail: "No checkout history at all",
                    tone: custody.neverCheckedOutCount > 0 ? .red : .green
                )
            } header: {
                Text("Sitting on the shelf")
            }
        }
    }

    private func shelfRow(value: Int, title: String, detail: String, tone: StatusTone) -> some View {
        HStack(spacing: 12) {
            Text("\(value)")
                .font(.title3.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(Color.statusText(tone))
                .frame(minWidth: 44, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.subheadline.weight(.medium))
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(value) \(title). \(detail)")
    }

    // MARK: Formatting

    private func percentLabel(_ rate: Double) -> String {
        let pct = rate * 100
        return pct < 10 ? String(format: "%.1f%%", pct) : "\(Int(pct.rounded()))%"
    }

    private func deltaLabel(current: Int, previous: Int?) -> DeltaLabel? {
        guard let previous else { return nil }
        let difference = current - previous
        if difference == 0 {
            return DeltaLabel(text: "No change", systemImage: "minus", tone: .gray, accessibilityText: "no change from the previous period")
        }
        let rising = difference > 0
        // A percentage against an empty prior window is infinite, so the raw
        // difference is the only honest thing to show.
        let text: String
        if previous == 0 {
            text = "\(rising ? "+" : "")\(difference)"
        } else {
            let pct = (Double(difference) / Double(previous)) * 100
            let magnitude = abs(pct) < 10 ? String(format: "%.1f", pct) : "\(Int(pct.rounded()))"
            text = "\(rising ? "+" : "")\(magnitude)%"
        }
        return DeltaLabel(
            text: text,
            systemImage: rising ? "arrow.up.right" : "arrow.down.right",
            tone: rising ? .green : .red,
            accessibilityText: "\(text) versus the previous \(vm.days) days"
        )
    }
}

// MARK: - Supporting types

struct DeltaLabel {
    let text: String
    let systemImage: String
    let tone: StatusTone
    let accessibilityText: String
}

/// A trend point with its day parsed once, so the chart can use a real date
/// axis instead of sorting `YYYY-MM-DD` strings.
struct ReportTrendPoint: Identifiable {
    let day: Date
    let count: Int

    var id: Date { day }

    /// The server already buckets these per UTC day as `YYYY-MM-DD`, so the
    /// components are read directly. A shared `ISO8601DateFormatter` would not
    /// be `Sendable`, and building one per point would cost more than this.
    static func parseDay(_ value: String) -> Date? {
        let parts = value.split(separator: "-")
        guard parts.count == 3,
              let year = Int(parts[0]),
              let month = Int(parts[1]),
              let day = Int(parts[2])
        else { return nil }

        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        return calendar.date(from: DateComponents(year: year, month: month, day: day))
    }

    static func build(from trend: [CheckoutTrendPoint]) -> [ReportTrendPoint] {
        trend.compactMap { point in
            guard let day = parseDay(point.date) else { return nil }
            return ReportTrendPoint(day: day, count: point.count)
        }
    }

    /// `chartXSelection` reports a position on a continuous axis, not one of our
    /// plotted days, so the closest sample wins.
    static func nearest(to date: Date, in points: [ReportTrendPoint]) -> ReportTrendPoint? {
        points.min {
            abs($0.day.timeIntervalSince(date)) < abs($1.day.timeIntervalSince(date))
        }
    }
}

/// One wedge of the status donut, already ordered and tone-mapped.
struct ReportStatusSlice: Identifiable {
    let status: String
    let label: String
    let count: Int
    /// A chart role, not a status text tone — this colour fills a wedge and its
    /// legend dot. See docs/COLOR_SYSTEM.md.
    let role: ChartRole

    var id: String { status }

    /// Mirrors the web report's status vocabulary and ordering so the two
    /// surfaces tell the same story in the same colours.
    private static let order = [
        "AVAILABLE",
        "CHECKED_OUT",
        "PENDING_PICKUP",
        "RESERVED",
        "MAINTENANCE",
        "RETIRED",
    ]

    /// Same status-to-role mapping the web utilization donut uses.
    static func role(for status: String) -> ChartRole {
        switch status {
        case "AVAILABLE": return .available
        case "CHECKED_OUT": return .active
        case "PENDING_PICKUP": return .waiting
        case "RESERVED": return .reserved
        case "MAINTENANCE": return .waiting
        case "RETIRED": return .neutral
        default: return .neutral
        }
    }

    static func label(for status: String) -> String {
        switch status {
        case "AVAILABLE": return "Available"
        case "CHECKED_OUT": return "Checked out"
        case "PENDING_PICKUP": return "Awaiting pickup"
        case "RESERVED": return "Reserved"
        case "MAINTENANCE": return "Maintenance"
        case "RETIRED": return "Retired"
        default: return status.capitalized
        }
    }

    static func build(from counts: [String: Int]) -> [ReportStatusSlice] {
        let known = order.compactMap { status -> ReportStatusSlice? in
            guard let count = counts[status], count > 0 else { return nil }
            return ReportStatusSlice(status: status, label: label(for: status), count: count, role: role(for: status))
        }
        // Anything the server adds later still shows up rather than vanishing.
        let extras = counts
            .filter { !order.contains($0.key) && $0.value > 0 }
            .sorted { $0.key < $1.key }
            .map { ReportStatusSlice(status: $0.key, label: label(for: $0.key), count: $0.value, role: role(for: $0.key)) }
        return known + extras
    }
}
