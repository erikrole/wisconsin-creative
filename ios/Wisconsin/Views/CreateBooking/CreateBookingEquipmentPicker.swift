import SwiftUI

/// Step 2 of Create Reservation: a search-first equipment picker.
///
/// Serialized results use "search, grab, search again." Counted items keep
/// explicit quantity controls in both results and the selected-gear drawer.
/// Selected gear lives in the system bottom toolbar and a cart sheet.
struct CreateBookingEquipmentPicker: View {
    @Bindable var vm: CreateBookingViewModel
    let onReview: () -> Void

    @State private var showCart = false
    @State private var viewingAsset: AssetRouteId?
    @State private var acknowledgedRecommendationIDs: Set<String> = []
    @State private var listResetID = UUID()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let displayedAssetGroups = vm.displayedAssetGroups
        let displayedBulkSkus = vm.displayedBulkSkus
        let displayedCategoryResults = vm.displayedCategoryResults
        let activeRecommendations = vm.batterySuggestions.filter {
            !acknowledgedRecommendationIDs.contains($0.reminderKey)
        }
        let hasNoResults = displayedAssetGroups.isEmpty
            && displayedBulkSkus.isEmpty
            && (displayedCategoryResults?.isEmpty ?? true)
            && !vm.isLoadingAssets
            && vm.error == nil

        List {
            if let submissionConflict = vm.submissionConflict {
                submissionConflictSection(submissionConflict)
            }

            if let availabilityCheckError = vm.availabilityCheckError {
                availabilityCheckSection(availabilityCheckError)
            }

            statusSection(hasNoResults: hasNoResults)

            if !displayedBulkSkus.isEmpty {
                Section("Supplies") {
                    ForEach(displayedBulkSkus) { sku in
                        BulkResultRow(
                            sku: sku,
                            quantity: vm.quantity(for: sku),
                            locationName: vm.locationName(for: sku),
                            isAtPickupLocation: vm.isAtPickupLocation(sku),
                            turnaroundMessage: vm.bulkTurnaroundMessage(for: sku.id),
                            turnaroundIsCritical: vm.bulkTurnaroundIsCritical(for: sku.id),
                            onDecrement: { handleBulkDecrement(sku) },
                            onIncrement: { handleBulkIncrement(sku) }
                        )
                    }
                }
            }

            if let categoryResults = displayedCategoryResults, !categoryResults.isEmpty {
                Section(vm.browseCategoryFilter ?? "Gear") {
                    ForEach(categoryResults) { result in
                        switch result {
                        case .asset(let asset):
                            assetResultRow(asset)
                        case .bulk(let sku):
                            BulkResultRow(
                                sku: sku,
                                quantity: vm.quantity(for: sku),
                                locationName: vm.locationName(for: sku),
                                isAtPickupLocation: vm.isAtPickupLocation(sku),
                                turnaroundMessage: vm.bulkTurnaroundMessage(for: sku.id),
                                turnaroundIsCritical: vm.bulkTurnaroundIsCritical(for: sku.id),
                                onDecrement: { handleBulkDecrement(sku) },
                                onIncrement: { handleBulkIncrement(sku) }
                            )
                        }
                    }
                }
            }

            ForEach(displayedAssetGroups) { group in
                Section(group.title) {
                    ForEach(group.assets) { asset in
                        assetResultRow(asset)
                    }
                }
            }

            if vm.hasMoreAssets && !vm.isLoadingAssets {
                Section {
                    Label("More equipment exists. Search to narrow results.", systemImage: "line.3.horizontal.decrease.circle")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .id(listResetID)
        .listStyle(.insetGrouped)
        .listSectionSpacing(12)
        .searchable(
            text: $vm.assetSearch,
            placement: .navigationBarDrawer(displayMode: .always),
            prompt: "Search all equipment"
        )
        .onChange(of: vm.assetSearch) { vm.onSearchChange() }
        .scrollDismissesKeyboard(.immediately)
        .refreshable { await vm.loadAvailableAssets(reset: true) }
        .nativeScrollBarMinimization()
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if !activeRecommendations.isEmpty {
                VStack(spacing: 6) {
                    ForEach(activeRecommendations) { recommendation in
                        BatteryRecommendationCard(
                            recommendation: recommendation,
                            quantity: vm.quantity(for: recommendation.sku),
                            onDecrement: {
                                vm.decrementBulk(recommendation.sku)
                                Haptics.selection()
                            },
                            onIncrement: {
                                vm.incrementBulk(recommendation.sku)
                                Haptics.selection()
                            },
                            onDismiss: {
                                acknowledge(recommendation)
                            }
                        )
                        .transition(reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity))
                    }
                }
                .padding(.horizontal, 12)
                .padding(.top, 6)
                .padding(.bottom, 4)
                .animation(reduceMotion ? nil : .snappy(duration: 0.25), value: activeRecommendations.map(\.reminderKey))
            }
        }
        .toolbar { gearBottomToolbar }
        .sheet(isPresented: $showCart) {
            EquipmentCartSheet(vm: vm)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
                .presentationContentInteraction(.scrolls)
        }
        .sheet(item: $viewingAsset) { route in
            NavigationStack {
                ItemDetailView(assetId: route.id)
            }
        }
    }

    // MARK: - Rows

    @ViewBuilder
    private func assetResultRow(_ asset: Asset) -> some View {
        let isSelected = vm.selectedAssetIds.contains(asset.id)
        let isConflicted = vm.conflictedAssetIds.contains(asset.id)
        let atPickup = vm.isAtPickupLocation(asset)
        let canAdd = !isSelected && atPickup && !isConflicted
        let caption = vm.availabilityCaption(for: asset.id)

        Button {
            handleAssetTap(asset)
        } label: {
            AssetPickerRow(
                asset: asset,
                isSelected: isSelected,
                isConflicted: isConflicted,
                conflictMessage: caption?.text,
                conflictDetail: isConflicted ? caption?.text : nil,
                conflictTone: caption?.tone ?? .red,
                isAtPickupLocation: atPickup,
                upcomingCommitmentLabel: isConflicted ? nil : caption?.text,
                upcomingTone: caption?.tone ?? .purple,
                turnaroundMessage: vm.turnaroundMessage(for: asset.id),
                turnaroundIsCritical: vm.turnaroundIsCritical(for: asset.id)
            )
        }
        .buttonStyle(.plain)
        .disabled((isConflicted && !isSelected) || (!atPickup && !isSelected))
        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
            if canAdd {
                Button {
                    handleAssetTap(asset)
                } label: {
                    Label("Add", systemImage: "plus")
                }
                .tint(Color.statusText(.purple))
            }
        }
        .swipeActions(edge: .leading, allowsFullSwipe: true) {
            if isSelected {
                Button("Remove", role: .destructive) {
                    vm.toggleAsset(asset)
                    Haptics.selection()
                }
            }
        }
        .contextMenu {
            if isSelected {
                Button("Remove", role: .destructive) {
                    vm.toggleAsset(asset)
                    Haptics.selection()
                }
            } else if canAdd {
                Button("Add", systemImage: "plus") {
                    handleAssetTap(asset)
                }
            }
            Button("View item", systemImage: "info.circle") {
                viewingAsset = AssetRouteId(id: asset.id)
            }
        }
    }

    private func submissionConflictSection(_ message: String) -> some View {
        Section {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "arrow.clockwise.circle.fill")
                    .font(.title3)
                    .foregroundStyle(Color.statusText(.orange))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    Text("Gear changed since review")
                        .font(.subheadline.weight(.semibold))
                    Text(message)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
        }
    }

    private func availabilityCheckSection(_ message: String) -> some View {
        Section {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "wifi.exclamationmark")
                    .font(.title3)
                    .foregroundStyle(Color.statusText(.orange))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    Text("Availability check unavailable")
                        .font(.subheadline.weight(.semibold))
                    Text(message)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                Button("Retry") { vm.scheduleConflictCheck() }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
            }
        }
    }

    @ViewBuilder
    private func statusSection(hasNoResults: Bool) -> some View {
        if vm.isLoadingAssets || vm.error != nil || hasNoResults {
            Section {
                if vm.isLoadingAssets {
                    HStack {
                        Spacer()
                        ProgressView()
                        Spacer()
                    }
                    .listRowBackground(Color.clear)
                } else if let err = vm.error {
                    HStack(spacing: 12) {
                        Image(systemName: "wifi.exclamationmark")
                            .foregroundStyle(Color.statusText(.red))
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Couldn't load equipment")
                                .font(.subheadline.weight(.medium))
                            Text(err)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(2)
                        }
                        Spacer()
                        Button("Retry") {
                            Task { await vm.loadAvailableAssets(reset: true) }
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                    }
                } else if vm.assetSearch.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Text("No available equipment found.")
                        .foregroundStyle(.secondary)
                        .font(.subheadline)
                } else {
                    ContentUnavailableView.search(text: vm.assetSearch)
                        .listRowBackground(Color.clear)
                }
            }
        }
    }

    // MARK: - Toolbar

    @ToolbarContentBuilder
    private var gearBottomToolbar: some ToolbarContent {
        if vm.selectedEquipmentCount > 0 {
            ToolbarItem(placement: .bottomBar) {
                Button {
                    showCart = true
                } label: {
                    Label("Selected", systemImage: "shippingbox.fill")
                        .symbolRenderingMode(.monochrome)
                        .foregroundStyle(Color.statusText(.purple))
                }
                .tint(Color.statusText(.purple))
                .badge(vm.selectedEquipmentCount)
                .accessibilityLabel("\(vm.selectedEquipmentCount) items selected, view selected equipment")
            }
            ToolbarSpacer(.flexible, placement: .bottomBar)
            ToolbarItem(placement: .bottomBar) {
                Button {
                    attemptReview()
                } label: {
                    Text(
                        vm.selectedLocationMismatchCount > 0
                            ? "Fix Location"
                            : (vm.selectedConflictCount == 0 ? "Review" : "Resolve Conflicts")
                    )
                    .fontWeight(.semibold)
                }
                .buttonStyle(.borderedProminent)
                .tint(Color.statusText(.purple))
                .disabled(!vm.canReviewEquipment)
                .accessibilityHint(reviewBlockedHint)
            }
        }
    }

    private var reviewBlockedHint: String {
        if vm.selectedEquipmentCount == 0 {
            return "Add equipment first"
        }
        if vm.selectedLocationMismatchCount > 0 {
            return "Every selected item has to match this pickup"
        }
        if vm.selectedConflictCount > 0 {
            return "Remove conflicting items first"
        }
        if vm.isCheckingAvailability {
            return "Availability is still checking"
        }
        if vm.availabilityCheckError != nil {
            return "Retry the availability check"
        }
        return "Reviews the reservation"
    }

    // MARK: - Tap handling

    private func handleAssetTap(_ asset: Asset) {
        if vm.selectedAssetIds.contains(asset.id) {
            vm.toggleAsset(asset)
            Haptics.selection()
        } else {
            guard vm.isAtPickupLocation(asset) else {
                Haptics.warning()
                return
            }
            vm.addAsset(asset)
            noteAdded()
        }
    }

    private func handleBulkIncrement(_ sku: FormBulkSku) {
        guard vm.isAtPickupLocation(sku) else {
            Haptics.warning()
            return
        }
        guard vm.quantity(for: sku) < sku.availableQuantity else {
            Haptics.warning()
            return
        }
        vm.incrementBulk(sku)
        Haptics.selection()
    }

    private func handleBulkDecrement(_ sku: FormBulkSku) {
        guard vm.quantity(for: sku) > 0 else { return }
        vm.decrementBulk(sku)
        Haptics.selection()
    }

    private func attemptReview() {
        guard !vm.hasSelectedPower, let recommendation = vm.batteryRecommendations.first else {
            onReview()
            return
        }
        vm.assetSearch = ""
        vm.browseCategoryFilter = "Batteries"
        acknowledgedRecommendationIDs.remove(recommendation.reminderKey)
        listResetID = UUID()
        Haptics.warning()
    }

    private func acknowledge(_ recommendation: BatteryRecommendation) {
        acknowledgedRecommendationIDs.insert(recommendation.reminderKey)
    }

    /// Clear the query so browse returns after a search-add, without
    /// stealing focus back into the search field.
    private func noteAdded() {
        Haptics.selection()
        if !vm.assetSearch.isEmpty {
            vm.assetSearch = ""
        }
    }
}

// MARK: - Bulk result row

/// A bulk SKU in the results list with an explicit inline quantity stepper.
struct BulkResultRow: View {
    let sku: FormBulkSku
    let quantity: Int
    let locationName: String
    let isAtPickupLocation: Bool
    var turnaroundMessage: String?
    var turnaroundIsCritical = false
    let onDecrement: () -> Void
    let onIncrement: () -> Void

    private var subtitle: String {
        "\(sku.availableQuantity)/\(sku.currentQuantity) available"
    }

    var body: some View {
        HStack(spacing: 12) {
            BookingBulkThumbnail(imageUrl: sku.imageUrl)

            VStack(alignment: .leading, spacing: 3) {
                Text(sku.name)
                    .font(.gothamBold(size: 16))
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                if !isAtPickupLocation {
                    Text("Choose \(locationName) pickup to add")
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(Color.statusText(.orange))
                }
                if let turnaroundMessage {
                    Label(turnaroundMessage, systemImage: "exclamationmark.triangle.fill")
                        .font(.caption2)
                        .foregroundStyle(Color.statusText(turnaroundIsCritical ? .red : .orange))
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            Spacer(minLength: 6)

            ReservationQuantityStepper(
                value: quantity,
                range: isAtPickupLocation ? 0...sku.availableQuantity : 0...quantity,
                label: "\(sku.name) quantity",
                onIncrement: onIncrement,
                onDecrement: onDecrement
            )
        }
        .opacity(!isAtPickupLocation && quantity == 0 ? 0.48 : 1)
    }
}

private struct BatteryRecommendationCard: View {
    let recommendation: BatteryRecommendation
    let quantity: Int
    let onDecrement: () -> Void
    let onIncrement: () -> Void
    let onDismiss: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            BookingBulkThumbnail(imageUrl: recommendation.sku.imageUrl, size: 36, cornerRadius: 8)
            Text(recommendation.sku.name)
                .font(.subheadline.weight(.semibold))
                .lineLimit(1)
            Spacer(minLength: 4)
            ReservationQuantityStepper(
                value: quantity,
                range: 0...recommendation.sku.availableQuantity,
                label: "\(recommendation.sku.name) quantity",
                onIncrement: onIncrement,
                onDecrement: onDecrement
            )
            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .font(.caption.weight(.bold))
                    .frame(width: 28, height: 28)
            }
            .buttonStyle(.plain)
            .frame(width: 44, height: 44)
            .contentShape(Rectangle())
            .foregroundStyle(.secondary)
            .accessibilityLabel("Dismiss battery suggestion")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .background(Color.cardSurfaceRaised, in: RoundedRectangle(cornerRadius: Brand.Radius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Brand.Radius.md, style: .continuous)
                .strokeBorder(Color.statusText(.purple).opacity(0.28))
        )
        .shadow(color: .black.opacity(0.1), radius: 8, y: 3)
        .simultaneousGesture(
            DragGesture(minimumDistance: 18).onEnded { value in
                if value.translation.height > 36 {
                    onDismiss()
                }
            }
        )
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Cart drawer

/// The cart: everything picked so far, with removal and bulk quantity
/// steppers. Presented as a medium/large detent sheet from the cart bar.
struct EquipmentCartSheet: View {
    @Bindable var vm: CreateBookingViewModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let selectedAssets = vm.selectedAssets
        let selectedBulkSkus = vm.selectedBulkSkus
        let mismatchCount = vm.selectedLocationMismatchCount
        NavigationStack {
            Group {
                        if vm.selectedEquipmentCount == 0 {
                    ContentUnavailableView(
                        "No equipment selected",
                        systemImage: "shippingbox",
                        description: Text("Search or scan to add gear to this reservation.")
                    )
                } else {
                    List {
                        if vm.selectedConflictCount > 0 {
                            let count = vm.selectedConflictCount
                            Section {
                                Label(
                                    "\(count) scheduling conflict\(count == 1 ? "" : "s") — remove conflicted gear or change the dates before review.",
                                    systemImage: "exclamationmark.triangle.fill"
                                )
                                .font(.footnote)
                                .foregroundStyle(Color.statusText(.orange))
                            }
                        }

                        if vm.selectedTimingAdvisoryCount > 0 {
                            let count = vm.selectedTimingAdvisoryCount
                            Section {
                                Label(
                                    "\(count) timing notice\(count == 1 ? "" : "s") — review the item details before reserving.",
                                    systemImage: "clock.arrow.circlepath"
                                )
                                .font(.footnote)
                                .foregroundStyle(Color.statusText(.blue))
                            }
                        }

                        if mismatchCount > 0 {
                            Section {
                                Label(
                                    "\(mismatchCount) item\(mismatchCount == 1 ? " is" : "s are") at another pickup location. Remove the item or change pickup before review.",
                                    systemImage: "mappin.and.ellipse"
                                )
                                .font(.footnote)
                                .foregroundStyle(Color.statusText(.orange))
                            }
                        }

                        if !selectedAssets.isEmpty || !selectedBulkSkus.isEmpty {
                            Section {
                                ForEach(selectedAssets) { asset in
                                    SelectedEquipmentRow(
                                        asset: asset,
                                        isConflicted: vm.conflictedAssetIds.contains(asset.id),
                                        conflictMessage: vm.conflictMessage(for: asset.id),
                                        availabilityTone: vm.availabilityCaption(for: asset.id)?.tone ?? .red,
                                        isAtPickupLocation: vm.isAtPickupLocation(asset),
                                        upcomingCommitmentLabel: vm.upcomingCommitmentLabel(for: asset.id),
                                        upcomingTone: vm.availabilityCaption(for: asset.id)?.tone ?? .purple,
                                        turnaroundMessage: vm.turnaroundMessage(for: asset.id),
                                        turnaroundIsCritical: vm.turnaroundIsCritical(for: asset.id)
                                    ) {
                                        vm.removeSelectedAsset(asset)
                                        Haptics.selection()
                                    }
                                }
                                ForEach(selectedBulkSkus) { sku in
                                    BulkQuantityRow(
                                        sku: sku,
                                        quantity: vm.quantity(for: sku),
                                        locationName: vm.locationName(for: sku),
                                        isAtPickupLocation: vm.isAtPickupLocation(sku),
                                        turnaroundMessage: vm.bulkTurnaroundMessage(for: sku.id),
                                        turnaroundIsCritical: vm.bulkTurnaroundIsCritical(for: sku.id),
                                        onDecrement: {
                                            vm.decrementBulk(sku)
                                            Haptics.selection()
                                        },
                                        onIncrement: {
                                            vm.incrementBulk(sku)
                                            Haptics.selection()
                                        }
                                    )
                                }
                            }
                        }
                    }
                    .listStyle(.insetGrouped)
                }
            }
            .navigationTitle("Selected Gear")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .fontWeight(.semibold)
                        .tint(Color.statusText(.purple))
                }
            }
        }
    }
}
