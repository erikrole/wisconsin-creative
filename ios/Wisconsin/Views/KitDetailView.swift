import SwiftUI

@MainActor
@Observable
final class KitDetailModel {
    var kit: KitReadDetail?
    var isLoading = true
    var error: String?
    private var loads = LatestRequestGeneration()

    private let kitId: String

    init(kitId: String) {
        self.kitId = kitId
    }

    func load() async {
        let token = loads.begin()
        defer { if loads.owns(token) { isLoading = false } }
        if kit == nil { isLoading = true }
        error = nil
        do {
            let fetched = try await APIClient.shared.kitReadDetail(id: kitId)
            guard loads.owns(token), !Task.isCancelled else { return }
            kit = fetched
        } catch {
            guard loads.owns(token), !Task.isCancelled else { return }
            self.error = error.localizedDescription
        }
    }
}

struct KitDetailView: View {
    let kitId: String

    @State private var model: KitDetailModel
    @Environment(SessionStore.self) private var session
    @Environment(ReservationDraftStore.self) private var drafts

    init(kitId: String) {
        self.kitId = kitId
        _model = State(initialValue: KitDetailModel(kitId: kitId))
    }

    private var canReserve: Bool {
        InventoryReadAccess.canReserve(
            role: session.currentUser?.role ?? "",
            capabilities: session.currentUser?.capabilities
        )
    }

    var body: some View {
        Group {
            if model.isLoading && model.kit == nil {
                ProgressView("Loading kit")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let error = model.error, model.kit == nil {
                ContentUnavailableView {
                    Label("Couldn't load kit", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(error)
                } actions: {
                    Button("Retry") { Task { await model.load() } }
                        .buttonStyle(.borderedProminent)
                }
            } else if let kit = model.kit {
                kitList(kit)
            }
        }
        .navigationTitle(model.kit?.name ?? "Kit")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await model.load() }
        .task { await model.load() }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if let kit = model.kit, kit.canCall, canReserve {
                Button {
                    reserve(kit)
                } label: {
                    Text("Reserve for an event")
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

    private func kitList(_ kit: KitReadDetail) -> some View {
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
                if let description = kit.description?.trimmingCharacters(in: .whitespacesAndNewlines), !description.isEmpty {
                    Text(description)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                LabeledContent("Pickup", value: kit.location.name)
                if let sport = sportDisplayName(kit.sportCode) {
                    LabeledContent("Sport", value: sport)
                }
                if let job = footballGamedayKitLabel(kit.gamedayRole) {
                    LabeledContent("Job", value: job)
                }
                LabeledContent("Contents", value: kit.contentCount == 1 ? "1 item" : "\(kit.contentCount) items")
                HStack {
                    Text("Status")
                    Spacer()
                    StatusPill(label: kit.shelf.label, tone: kit.shelf.tone)
                }
            } footer: {
                if !kit.active {
                    Text("This kit is archived. Restoring it stays on the web.")
                } else if kit.contentCount == 0 {
                    Text("This kit has no gear yet. Add it on the web before reserving.")
                }
            }

            Section("Gear") {
                if kit.members.isEmpty {
                    Text("No cameras or lenses in this kit.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(kit.members) { member in
                        NavigationLink {
                            ItemDetailView(assetId: member.asset.id)
                        } label: {
                            KitGearRow(member: member)
                        }
                    }
                }
            }

            Section("Item families") {
                if kit.bulkMembers.isEmpty {
                    Text("No item families in this kit.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(kit.bulkMembers) { member in
                        NavigationLink {
                            BulkInventoryDetailView(skuId: member.bulkSku.id)
                        } label: {
                            KitFamilyRow(member: member)
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    private func reserve(_ kit: KitReadDetail) {
        drafts.start({
            let composer = CreateBookingViewModel()
            composer.prefillCalledKit(id: kit.id, locationId: kit.location.id)
            return composer
        }())
    }
}

private struct KitGearRow: View {
    @Environment(\.today) private var today
    let member: KitMemberRead

    private var presentation: (label: String, tone: StatusTone) {
        inventoryStatusPresentation(member.asset.statusCode)
    }

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            AssetThumbnail(imageUrl: member.asset.imageUrl, size: 44)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(member.asset.primaryTitle)
                    .font(.body.weight(.semibold))
                    .lineLimit(1)
                if let secondary = member.asset.secondaryTitle {
                    Text(secondary)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                if let holder = holderLine {
                    Text(holder)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            }
            Spacer(minLength: 8)
            StatusPill(label: presentation.label, tone: presentation.tone)
        }
        .accessibilityElement(children: .combine)
    }

    private var holderLine: String? {
        guard let holder = member.asset.currentHolder, !holder.holderName.isEmpty else { return nil }
        var parts = ["With \(holder.holderName)"]
        if let due = InventoryReadFormatting.date(from: holder.endsAt) {
            parts.append(due.operationalDateTimeLabel(now: today, capitalizesRelativeDay: false))
        }
        return parts.joined(separator: " · ")
    }
}

private struct KitFamilyRow: View {
    let member: KitBulkMemberRead

    var body: some View {
        HStack(spacing: 12) {
            SearchBulkThumbnail(imageUrl: member.bulkSku.imageUrl, size: 44)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(member.bulkSku.name)
                    .font(.body.weight(.semibold))
                    .lineLimit(1)
                Text(member.quantityLabel)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(member.bulkSku.name), \(member.quantityLabel)")
    }
}
