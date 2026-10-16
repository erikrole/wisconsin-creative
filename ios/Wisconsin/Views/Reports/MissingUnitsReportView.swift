import Charts
import SwiftUI

@MainActor
@Observable
final class MissingUnitsReportModel {
    var report: MissingUnitsReport?
    var isLoading = false
    var error: String?
    var categoryId: String? {
        didSet { filterChanged(from: oldValue, to: categoryId) }
    }
    var locationId: String? {
        didSet { filterChanged(from: oldValue, to: locationId) }
    }

    @ObservationIgnored private let session = ReportSession<MissingUnitsReport>()

    var key: String { "\(categoryId ?? "")|\(locationId ?? "")" }

    func load(force: Bool = false) async {
        let query = key
        let category = categoryId
        let location = locationId
        guard let token = session.begin(key: query, force: force) else { return }
        sync()
        do {
            let fetched = try await APIClient.shared.missingUnitsReport(
                categoryId: category,
                locationId: location
            )
            session.succeed(token, value: fetched, incomplete: false)
        } catch {
            session.fail(token, message: error.localizedDescription)
        }
        sync()
    }

    private func filterChanged<T: Equatable>(from old: T, to new: T) {
        guard old != new else { return }
        session.discard()
        sync()
    }

    private func sync() {
        report = session.value
        isLoading = session.isLoading
        error = session.error
    }
}

struct MissingUnitsReportView: View {
    @State private var model = MissingUnitsReportModel()
    @State private var showAllUnits = false
    @State private var showHistory = false

    var body: some View {
        ReportScreen(
            title: "Missing Units",
            isLoading: model.isLoading,
            error: model.error,
            hasData: model.report != nil,
            retry: { Task { await model.load(force: true) } }
        ) {
            List {
                if let report = model.report {
                    filters(report)
                    if let error = model.error {
                        Section { ReportStaleNotice(message: error) }
                    }
                    Section {
                        ReportMetricGrid(metrics: [
                            ReportMetricModel(
                                id: "missing",
                                value: ReportFormatting.count(report.totalLost),
                                label: "Missing units",
                                tone: report.totalLost > 0 ? .red : .green
                            ),
                            ReportMetricModel(
                                id: "families",
                                value: ReportFormatting.count(report.families.count),
                                label: "Families",
                                tone: .blue
                            ),
                        ])
                    } footer: {
                        Text("Numbered units that are still missing. This is not a date range.")
                    }
                    families(report)
                    people(report)
                    events(report)
                    batteries(report)
                }
            }
            .listStyle(.insetGrouped)
        }
        .task(id: model.key) { await model.load() }
        .refreshable { await model.load(force: true) }
    }

    @ViewBuilder
    private func filters(_ report: MissingUnitsReport) -> some View {
        let categories = report.filterOptions?.categories ?? []
        let locations = report.filterOptions?.locations ?? []
        if !categories.isEmpty || !locations.isEmpty {
            Section {
                if !locations.isEmpty {
                    Picker("Location", selection: Binding(get: { model.locationId }, set: { model.locationId = $0 })) {
                        Text("All locations").tag(nil as String?)
                        ForEach(locations) { location in
                            Text(location.name).tag(Optional(location.id))
                        }
                    }
                }
                if !categories.isEmpty {
                    Picker("Category", selection: Binding(get: { model.categoryId }, set: { model.categoryId = $0 })) {
                        Text("All categories").tag(nil as String?)
                        ForEach(categories) { category in
                            Text(category.name).tag(Optional(category.id))
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func families(_ report: MissingUnitsReport) -> some View {
        let rows = report.families
        if rows.isEmpty {
            Section("By family") {
                Text("Nothing is missing.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        } else {
            Section("By family") {
                if rows.count > 1, rows.count <= 8 {
                    Chart(rows) { row in
                        BarMark(
                            x: .value("Missing", row.count),
                            y: .value("Family", row.skuName)
                        )
                        .foregroundStyle(Color.chartFill(.problem).gradient)
                        .cornerRadius(3)
                    }
                    .chartXAxis { AxisMarks(values: .automatic(desiredCount: 3)) }
                    .chartYAxis { AxisMarks(preset: .extended, position: .leading) }
                    .frame(height: CGFloat(max(120, rows.count * 28)))
                    .accessibilityLabel("Missing units by family")
                }
                ForEach(rows) { row in
                    ReportRankRow(
                        title: row.skuName,
                        detail: nil,
                        value: ReportFormatting.count(row.count),
                        fraction: reportShare(row.count, of: rows.map(\.count))
                    )
                }
            }
        }
    }

    @ViewBuilder
    private func people(_ report: MissingUnitsReport) -> some View {
        let rows = report.people
        if !rows.isEmpty {
            Section {
                ForEach(Array(rows.enumerated()), id: \.offset) { _, person in
                    ReportRankRow(
                        title: person.name,
                        detail: "Last person on the unit",
                        value: ReportFormatting.count(person.count),
                        fraction: reportShare(person.count, of: rows.map(\.count))
                    )
                }
            } header: {
                Text("By person")
            }
        }
    }

    @ViewBuilder
    private func events(_ report: MissingUnitsReport) -> some View {
        if !report.events.isEmpty {
            Section("Recent check-ins") {
                ForEach(report.events) { event in
                    let label = VStack(alignment: .leading, spacing: 2) {
                        Text(event.actor?.name ?? "System")
                            .font(.subheadline)
                        Text("Check-in finished with missing units · \(ReportFormatting.timestamp(event.createdAt))")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .accessibilityElement(children: .combine)
                    if let bookingId = event.bookingId, !bookingId.isEmpty {
                        NavigationLink {
                            BookingDetailView(bookingId: bookingId)
                        } label: {
                            label
                        }
                    } else {
                        label
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func batteries(_ report: MissingUnitsReport) -> some View {
        if let audit = report.batteryAudit {
            batterySections(audit)
        }
    }

    @ViewBuilder
    private func batterySections(_ audit: BatteryMissingAudit) -> some View {
        if let totals = audit.totals, totals.totalUnits > 0 {
            Section {
                ReportMetricGrid(metrics: [
                    ReportMetricModel(id: "lost", value: ReportFormatting.count(totals.lost), label: "Missing", tone: totals.lost > 0 ? .red : .green),
                    ReportMetricModel(id: "rate", value: ReportFormatting.percent(totals.lossRate), label: "Missing rate", tone: .orange),
                    ReportMetricModel(id: "out", value: ReportFormatting.count(totals.checkedOut), label: "Checked out", tone: .blue),
                    ReportMetricModel(id: "ready", value: ReportFormatting.count(totals.available), label: "Available", tone: .green),
                ])
            } header: {
                Text("Batteries")
            } footer: {
                Text("\(totals.skuCount) families · \(totals.totalUnits) units")
            }
        }
        if !audit.families.isEmpty {
            Section("Battery families") {
                ForEach(audit.families) { family in
                    VStack(alignment: .leading, spacing: 2) {
                        HStack {
                            Text(family.skuName).font(.subheadline)
                            Spacer(minLength: 8)
                            Text(ReportFormatting.count(family.lost))
                                .font(.subheadline.weight(.medium))
                                .monospacedDigit()
                                .foregroundStyle(.secondary)
                        }
                        Text(batteryFamilyDetail(family))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        }
        if !audit.units.isEmpty {
            let shown = showAllUnits ? audit.units : Array(audit.units.prefix(8))
            Section("Missing battery units") {
                ForEach(shown) { unit in
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(unit.skuName) #\(unit.unitNumber)")
                            .font(.subheadline)
                        Text(batteryUnitDetail(unit))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .accessibilityElement(children: .combine)
                }
                if audit.units.count > 8 {
                    Button(showAllUnits ? "Show less" : "Show \(audit.units.count - 8) more") {
                        showAllUnits.toggle()
                    }
                }
            }
        }
        if !audit.patterns.isEmpty {
            Section("Repeated") {
                ForEach(Array(audit.patterns.enumerated()), id: \.offset) { _, pattern in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(pattern.label).font(.subheadline)
                        Text(patternDetail(pattern))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        }
        if !audit.history.isEmpty {
            Section {
                let shown = showHistory ? audit.history : Array(audit.history.prefix(6))
                ForEach(shown) { row in
                    VStack(alignment: .leading, spacing: 2) {
                        HStack {
                            Text("\(row.skuName) #\(row.unitNumber)")
                                .font(.subheadline)
                            Spacer(minLength: 8)
                            let status = ReportFormatting.unitStatus(row.status)
                            StatusPill(label: status.label, tone: status.tone)
                        }
                        Text(historyDetail(row))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .accessibilityElement(children: .combine)
                }
                if audit.history.count > 6 {
                    Button(showHistory ? "Show less" : "Show \(audit.history.count - 6) more") {
                        showHistory.toggle()
                    }
                }
            } header: {
                Text("Recent battery checkouts")
            }
        }
    }

    private func batteryFamilyDetail(_ family: BatteryFamilySummary) -> String {
        var parts: [String] = []
        if let location = family.location, !location.isEmpty { parts.append(location) }
        if !family.missingNumbers.isEmpty {
            parts.append(family.missingNumbers.map { "#\($0)" }.joined(separator: ", "))
        }
        parts.append("\(family.available) available")
        return parts.joined(separator: " · ")
    }

    private func batteryUnitDetail(_ unit: BatteryMissingUnit) -> String {
        var parts: [String] = []
        if let name = unit.lastRequesterName, !name.isEmpty { parts.append(name) }
        if let ref = unit.lastBookingRef ?? unit.lastBookingTitle, !ref.isEmpty { parts.append(ref) }
        if let when = unit.markedMissingAt { parts.append(ReportFormatting.timestamp(when)) }
        if let notes = unit.notes, !notes.isEmpty { parts.append(notes) }
        return parts.isEmpty ? "Missing" : parts.joined(separator: " · ")
    }

    private func patternDetail(_ pattern: BatteryRepeatPattern) -> String {
        let kind = pattern.type == "requester" ? "Person" : "Family"
        let detail = pattern.detail ?? ""
        return [kind, "\(pattern.count) missing", detail].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    private func historyDetail(_ row: BatteryCheckoutHistoryRow) -> String {
        var parts = [row.requesterName, ReportFormatting.timestamp(row.checkedOutAt)]
        if let title = row.bookingRef ?? row.bookingTitle, !title.isEmpty { parts.append(title) }
        if let returned = row.checkedInAt {
            parts.append("Returned \(ReportFormatting.timestamp(returned))")
        } else {
            parts.append("Still out")
        }
        return parts.joined(separator: " · ")
    }
}
