import SwiftUI

@MainActor
@Observable
final class BulkInventoryDetailModel {
    var sku: BulkSkuReadDetail?
    var isLoading = false
    var error: String?
    private let skuId: String

    init(skuId: String) {
        self.skuId = skuId
    }

    func load() async {
        if sku == nil { isLoading = true }
        error = nil
        do {
            sku = try await APIClient.shared.bulkSkuReadDetail(id: skuId)
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }
}

enum BulkUnitFilter: String, CaseIterable, Identifiable {
    case all, available, checkedOut, missing, retired

    var id: String { rawValue }

    var label: String {
        switch self {
        case .all: "All"
        case .available: "Available"
        case .checkedOut: "Checked out"
        case .missing: "Missing"
        case .retired: "Retired"
        }
    }
}

struct BulkInventoryDetailView: View {
    let skuId: String

    @State private var model: BulkInventoryDetailModel
    @State private var unitFilter: BulkUnitFilter = .all
    @Environment(SessionStore.self) private var session
    @Environment(ReservationDraftStore.self) private var drafts

    init(skuId: String) {
        self.skuId = skuId
        _model = State(initialValue: BulkInventoryDetailModel(skuId: skuId))
    }

    private var role: String { session.currentUser?.role ?? "" }

    private var canReserve: Bool {
        InventoryReadAccess.canReserve(role: role, capabilities: session.currentUser?.capabilities)
    }

    var body: some View {
        Group {
            if model.isLoading && model.sku == nil {
                ProgressView("Loading inventory")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let error = model.error, model.sku == nil {
                ContentUnavailableView {
                    Label("Couldn't load inventory", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(error)
                } actions: {
                    Button("Retry") { Task { await model.load() } }
                        .buttonStyle(.borderedProminent)
                }
            } else if let sku = model.sku {
                detail(sku)
            }
        }
        .navigationTitle(model.sku?.name ?? "Inventory")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await model.load() }
        .task { await model.load() }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if let sku = model.sku, sku.active, canReserve {
                Button {
                    reserve(sku)
                } label: {
                    Text("Reserve")
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .tint(Color(.label))
                .padding(.horizontal, Brand.Space.md)
                .padding(.vertical, Brand.Space.sm)
                .background(.bar)
            }
        }
    }

    private func detail(_ sku: BulkSkuReadDetail) -> some View {
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
                HStack {
                    Text("Available")
                    Spacer()
                    Text("\(sku.availableQuantity)")
                        .font(.title2.weight(.semibold))
                        .monospacedDigit()
                    if sku.isLow {
                        StatusPill(label: "Low", tone: .orange)
                    }
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel(sku.isLow ? "\(sku.availableQuantity) available, low stock" : "\(sku.availableQuantity) available")
                LabeledContent(sku.trackByNumber ? "Active units" : "On hand", value: "\(sku.activeTotal)")
                if sku.trackByNumber {
                    countRow("Checked out", count: sku.checkedOutQuantity, tone: .blue)
                    countRow("Missing", count: sku.missingQuantity, tone: .red)
                    countRow("Retired records", count: sku.retiredQuantity, tone: .gray)
                }
            } footer: {
                if !sku.active {
                    Text("This family is archived.")
                } else if sku.trackByNumber && sku.retiredQuantity > 0 {
                    Text("Retired records keep their numbers and stay out of the available count.")
                }
            }

            Section("Identity") {
                if !sku.locationName.isEmpty {
                    LabeledContent("Location", value: sku.locationName)
                }
                if !sku.categoryName.isEmpty {
                    LabeledContent("Category", value: sku.categoryName)
                }
                LabeledContent("Tracking", value: sku.trackByNumber ? "Units" : "Quantity")
                if sku.minThreshold > 0 {
                    LabeledContent("Low at", value: "\(sku.minThreshold)")
                }
                if let code = sku.binQrCodeValue?.nonBlankText {
                    LabeledContent("Family QR") {
                        Text(code)
                            .font(.body.monospaced())
                            .textSelection(.enabled)
                    }
                }
                if InventoryReadAccess.canOpenBatteryOps(role: role), sku.isBattery {
                    NavigationLink {
                        BatteryOpsView(wrapsInNavigationStack: false)
                    } label: {
                        LabeledContent("Battery Ops", value: "All families")
                    }
                }
            }

            if !sku.products.isEmpty {
                Section("Products") {
                    ForEach(sku.products) { product in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(product.line)
                            if product.assignedUnitCount > 0 {
                                Text("\(product.assignedUnitCount) units")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .foregroundStyle(product.active ? Color.primary : Color.secondary)
                    }
                }
            }

            if sku.trackByNumber {
                Section {
                    let units = visibleUnits(in: sku)
                    if units.isEmpty {
                        Text(unitFilter == .all ? "No units yet." : "No units with that status.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(units) { unit in
                            BulkUnitRow(unit: unit)
                        }
                    }
                } header: {
                    HStack {
                        Text("Units")
                        Spacer()
                        Menu {
                            Picker("Status", selection: $unitFilter) {
                                ForEach(BulkUnitFilter.allCases) { filter in
                                    Text(filter.label).tag(filter)
                                }
                            }
                        } label: {
                            Label(unitFilter == .all ? "Status" : unitFilter.label, systemImage: "line.3.horizontal.decrease")
                                .font(.subheadline)
                        }
                        .listControlTint(isActive: unitFilter != .all)
                    }
                } footer: {
                    if sku.labelsNeeded > 0 || sku.labelsPrinted > 0 {
                        Text("\(sku.labelsPrinted) of \(sku.labelsPrinted + sku.labelsNeeded) labels printed. Printing stays on the web.")
                    }
                }
            }

            if let notes = sku.notes?.trimmingCharacters(in: .whitespacesAndNewlines), !notes.isEmpty {
                Section("Notes") {
                    Text(notes)
                        .font(.subheadline)
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    private func visibleUnits(in sku: BulkSkuReadDetail) -> [BulkUnitRead] {
        let units = sku.units.sorted { $0.unitNumber < $1.unitNumber }
        switch unitFilter {
        case .all: return units
        case .available: return units.filter { $0.status == "AVAILABLE" }
        case .checkedOut: return units.filter { $0.status == "CHECKED_OUT" }
        case .missing: return units.filter { $0.status == "LOST" }
        case .retired: return units.filter { $0.status == "RETIRED" }
        }
    }

    private func countRow(_ title: String, count: Int, tone: StatusTone) -> some View {
        LabeledContent(title) {
            Text("\(count)")
                .monospacedDigit()
                .foregroundStyle(count > 0 ? Color.statusText(tone) : Color.secondary)
        }
    }

    private func reserve(_ sku: BulkSkuReadDetail) {
        drafts.start({
            let composer = CreateBookingViewModel()
            composer.prefillReservation(bulkSkuId: sku.id, name: sku.name, locationId: sku.locationId)
            return composer
        }())
    }
}

private struct BulkUnitRow: View {
    let unit: BulkUnitRead

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text("#\(unit.unitNumber)")
                    .font(.body.weight(.semibold))
                    .monospacedDigit()
                if let detail = detailLine {
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            }
            Spacer(minLength: 8)
            StatusPill(label: unit.presentation.label, tone: unit.presentation.tone)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel)
    }

    private var detailLine: String? {
        var parts: [String] = []
        if let product = unit.productName { parts.append(product) }
        if unit.status == "CHECKED_OUT", let holder = unit.holderName.nonBlankText {
            parts.append("With \(holder)")
        }
        if let notes = unit.notes?.trimmingCharacters(in: .whitespacesAndNewlines), !notes.isEmpty {
            parts.append(notes)
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private var accessibilityLabel: String {
        var parts = ["Unit \(unit.unitNumber)", unit.presentation.label]
        if let detailLine { parts.append(detailLine) }
        return parts.joined(separator: ", ")
    }
}
