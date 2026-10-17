import SwiftUI

@MainActor
@Observable
final class BatteryOpsModel {
    var snapshot: BatteryOpsSnapshot?
    var isLoading = false
    var error: String?

    func load() async {
        if snapshot == nil { isLoading = true }
        error = nil
        do {
            snapshot = try await APIClient.shared.batteryOps()
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }
}

struct BatteryOpsView: View {
    var wrapsInNavigationStack = true

    @State private var model = BatteryOpsModel()
    @Environment(\.today) private var today

    var body: some View {
        if wrapsInNavigationStack {
            NavigationStack { configuredContent }
        } else {
            configuredContent
        }
    }

    private var configuredContent: some View {
        content
            .navigationTitle("Battery Ops")
            .navigationBarTitleDisplayMode(.large)
            .refreshable { await model.load() }
            .task { await model.load() }
    }

    @ViewBuilder
    private var content: some View {
        if model.isLoading && model.snapshot == nil {
            ProgressView("Loading batteries")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let error = model.error, model.snapshot == nil {
            ContentUnavailableView {
                Label("Couldn't load batteries", systemImage: "exclamationmark.triangle")
            } description: {
                Text(error)
            } actions: {
                Button("Retry") { Task { await model.load() } }
                    .buttonStyle(.borderedProminent)
            }
        } else if let snapshot = model.snapshot {
            batteryList(snapshot)
        }
    }

    private func batteryList(_ snapshot: BatteryOpsSnapshot) -> some View {
        List {
            if let error = model.error {
                Section {
                    Text(error)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Button("Retry") { Task { await model.load() } }
                }
            }
            Section {
                metric("Available", value: snapshot.totals.available, tone: .green)
                metric("Checked out", value: snapshot.totals.checkedOut, tone: .blue)
                metric("Missing", value: snapshot.totals.lost, tone: .red)
                metric("Retired", value: snapshot.totals.retired, tone: .gray)
                metric("Low families", value: snapshot.totals.lowSkus, tone: .orange)
            }

            if snapshot.staleCheckedOutCount > 0 {
                Section {
                    HStack(alignment: .top, spacing: 10) {
                        StatusPill(label: "Review", tone: .orange)
                        Text("\(snapshot.staleCheckedOutCount) \(snapshot.staleCheckedOutCount == 1 ? "battery is" : "batteries are") marked checked out without an open checkout. Repair stays on the web.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
            }

            if !snapshot.compatibility.isEmpty {
                Section("Cameras running low") {
                    ForEach(snapshot.compatibility) { row in
                        compatibilityRow(row)
                    }
                }
            }

            let checkedOut = snapshot.checkedOutUnits
            if !checkedOut.isEmpty {
                Section("Checked out") {
                    ForEach(checkedOut, id: \.unit.id) { item in
                        checkedOutRow(family: item.family, unit: item.unit)
                    }
                }
            }

            Section {
                if snapshot.families.isEmpty {
                    Text("No active battery families.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(snapshot.families) { family in
                        NavigationLink {
                            BulkInventoryDetailView(skuId: family.id)
                        } label: {
                            BatteryFamilyRow(family: family)
                        }
                    }
                }
            } header: {
                Text("Families")
            } footer: {
                Text("Receiving, labels, and repairs stay on the web.")
            }
        }
        .listStyle(.insetGrouped)
    }

    private func metric(_ title: String, value: Int, tone: StatusTone) -> some View {
        LabeledContent(title) {
            Text("\(value)")
                .monospacedDigit()
                .foregroundStyle(value > 0 ? Color.statusText(tone) : Color.secondary)
        }
    }

    @ViewBuilder
    private func compatibilityRow(_ row: BatteryCompatibilityRead) -> some View {
        let line = "\(row.availableQuantity) available · \(row.cameraCount) cameras"
        if row.batterySkuIds.count == 1, let skuId = row.batterySkuIds.first {
            NavigationLink {
                BulkInventoryDetailView(skuId: skuId)
            } label: {
                compatibilityLabel(row, line: line)
            }
        } else {
            compatibilityLabel(row, line: line)
        }
    }

    private func compatibilityLabel(_ row: BatteryCompatibilityRead, line: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(row.label)
            Text(line)
                .font(.caption)
                .foregroundStyle(Color.statusText(.orange))
            if !row.cameraModels.isEmpty {
                Text(row.cameraModels.prefix(3).joined(separator: ", "))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func checkedOutRow(family: BatteryOpsFamily, unit: BatteryOpsUnit) -> some View {
        let label = checkedOutLabel(family: family, unit: unit)
        if let bookingId = unit.booking?.id, !bookingId.isEmpty {
            NavigationLink {
                BookingDetailView(bookingId: bookingId)
            } label: {
                label
            }
        } else {
            label
        }
    }

    private func checkedOutLabel(family: BatteryOpsFamily, unit: BatteryOpsUnit) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text("#\(unit.unitNumber) \(family.name)")
                .font(.body.weight(.semibold))
                .monospacedDigit()
            Text(checkedOutDetail(unit))
                .font(.caption)
                .foregroundStyle((unit.checkedOutDays ?? 0) >= 7 ? Color.statusText(.orange) : Color.secondary)
                .lineLimit(2)
        }
        .accessibilityElement(children: .combine)
    }

    private func checkedOutDetail(_ unit: BatteryOpsUnit) -> String {
        var parts: [String] = []
        if let name = unit.booking?.requesterName.nonBlankText { parts.append(name) }
        if let title = unit.booking?.title.nonBlankText { parts.append(title) }
        if let due = InventoryReadFormatting.date(from: unit.booking?.endsAt) {
            parts.append("Due \(due.operationalDateTimeLabel(now: today, capitalizesRelativeDay: false))")
        }
        if let days = unit.checkedOutDays {
            parts.append(days == 1 ? "1 day out" : "\(days) days out")
        }
        return parts.joined(separator: " · ")
    }
}

private struct BatteryFamilyRow: View {
    let family: BatteryOpsFamily

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(family.name)
                    .font(.body.weight(.semibold))
                    .lineLimit(1)
                Text(family.availabilityLine)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                if family.trackByNumber, family.labelNeededCount > 0 {
                    Text("\(family.labelNeededCount) labels still to print")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 8)
            if family.isLow {
                StatusPill(label: "Low", tone: .orange)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(family.isLow ? "\(family.name), \(family.availabilityLine), low" : "\(family.name), \(family.availabilityLine)")
    }
}
