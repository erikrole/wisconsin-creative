import SwiftUI

/// Step 2 of Create Reservation: a search-first equipment picker.
///
/// Serialized results use "search, grab, search again." Counted items keep
/// explicit quantity controls in both results and the selected-gear drawer.
/// Selected gear lives in a cart drawer pinned to the bottom edge.
struct CreateBookingEquipmentPicker: View {
    @Bindable var vm: CreateBookingViewModel
    let onReview: () -> Void

    @State private var showCart = false
    @State private var justAdded: String?
    @State private var justAddedClearTask: Task<Void, Never>?
    @State private var acknowledgedRecommendationIDs: Set<String> = []
    @State private var listResetID = UUID()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var isBrowsing: Bool {
        vm.assetSearch.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

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
            if vm.selectedEquipmentCount > 0 {
                selectedSummary
            }

            if let submissionConflict = vm.submissionConflict {
                submissionConflictSection(submissionConflict)
            }

            if let availabilityCheckError = vm.availabilityCheckError {
                availabilityCheckSection(availabilityCheckError)
            }

            if isBrowsing && vm.browseCategories.count > 1 {
                categoryChips
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
                            AssetPickerRow(
                                asset: asset,
                                isSelected: vm.selectedAssetIds.contains(asset.id),
                                isConflicted: vm.conflictedAssetIds.contains(asset.id),
                                conflictMessage: vm.conflictMessage(for: asset.id),
                                isAtPickupLocation: vm.isAtPickupLocation(asset),
                                upcomingCommitmentLabel: vm.upcomingCommitmentLabel(for: asset.id),
                                turnaroundMessage: vm.turnaroundMessage(for: asset.id),
                                turnaroundIsCritical: vm.turnaroundIsCritical(for: asset.id)
                            ) {
                                handleAssetTap(asset)
                            }
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
                        AssetPickerRow(
                            asset: asset,
                            isSelected: vm.selectedAssetIds.contains(asset.id),
                            isConflicted: vm.conflictedAssetIds.contains(asset.id),
                            conflictMessage: vm.conflictMessage(for: asset.id),
                            isAtPickupLocation: vm.isAtPickupLocation(asset),
                            upcomingCommitmentLabel: vm.upcomingCommitmentLabel(for: asset.id),
                            turnaroundMessage: vm.turnaroundMessage(for: asset.id),
                            turnaroundIsCritical: vm.turnaroundIsCritical(for: asset.id)
                        ) {
                            handleAssetTap(asset)
                        }
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
            prompt: Text("Search all equipment")
        )
        .onChange(of: vm.assetSearch) { vm.onSearchChange() }
        .scrollDismissesKeyboard(.immediately)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            VStack(spacing: 0) {
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
                    .background(.bar)
                }
                cartBar
            }
            .animation(reduceMotion ? nil : .snappy(duration: 0.25), value: activeRecommendations.map(\.reminderKey))
        }
        .sheet(isPresented: $showCart) {
            EquipmentCartSheet(vm: vm)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
    }

    // MARK: - Sections

    private var selectedSummary: some View {
        Section {
            Button {
                showCart = true
                Haptics.tap()
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: selectedSummaryHasWarning ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(
                            selectedSummaryHasWarning
                                ? Color.statusText(.orange)
                                : Color.statusText(.green)
                        )
                        .frame(width: 38, height: 38)
                        .background(
                            selectedSummaryHasWarning
                                ? Color.statusBackground(.orange)
                                : Color.statusBackground(.green),
                            in: Circle()
                        )

                    VStack(alignment: .leading, spacing: 2) {
                        Text("Selected Gear")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.primary)
                        Text(selectionSummaryText)
                            .font(.caption)
                            .foregroundStyle(
                                selectedSummaryHasWarning
                                    ? Color.statusText(.orange)
                                    : Color.secondary
                            )
                    }

                    Spacer()

                    Text("\(vm.selectedEquipmentCount)")
                        .font(.subheadline.weight(.semibold))
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                    Image(systemName: "chevron.right")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.tertiary)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Selected gear, \(selectionSummaryText)")
            .accessibilityHint("Shows selected equipment")
        }
    }

    private var selectedSummaryHasWarning: Bool {
        vm.selectedLocationMismatchCount > 0
            || vm.selectedConflictCount > 0
            || vm.hasSelectedTimingAdvisories
            || vm.availabilityCheckError != nil
            || vm.isCheckingAvailability
    }

    private var selectionSummaryText: String {
        let mismatchCount = vm.selectedLocationMismatchCount
        if mismatchCount > 0 {
            return "\(mismatchCount) item\(mismatchCount == 1 ? " is" : "s are") at another pickup location"
        }
        let count = vm.selectedConflictCount
        if count > 0 {
            return "\(count) conflict\(count == 1 ? "" : "s") to review"
        }
        if let availabilityCheckError = vm.availabilityCheckError {
            return availabilityCheckError
        }
        let timingCount = vm.selectedTimingAdvisoryCount
        if timingCount > 0 {
            return "\(timingCount) timing notice\(timingCount == 1 ? "" : "s") to review"
        }
        if vm.isCheckingAvailability {
            return "Checking availability…"
        }
        return "Ready to review"
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

    private var categoryChips: some View {
        Section {
            ViewThatFits(in: .horizontal) {
                categoryChipRow
                ScrollView(.horizontal, showsIndicators: false) {
                    categoryChipRow
                        .padding(.horizontal, 12)
                }
            }
            .padding(.vertical, 2)
            .listRowInsets(EdgeInsets(top: 6, leading: 12, bottom: 6, trailing: 12))
            .listRowBackground(Color.clear)
            .accessibilityLabel("Filter by category")
        }
    }

    private var categoryChipRow: some View {
        HStack(spacing: 5) {
            ReservationCategoryChip(label: "All", isOn: vm.browseCategoryFilter == nil) {
                vm.browseCategoryFilter = nil
                Haptics.selection()
            }
            ForEach(vm.browseCategories, id: \.self) { category in
                ReservationCategoryChip(label: category, isOn: vm.browseCategoryFilter == category) {
                    vm.browseCategoryFilter = vm.browseCategoryFilter == category ? nil : category
                    Haptics.selection()
                }
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
                    // Surface a load error with retry so server failures do not
                    // look like an empty equipment room.
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
                } else if isBrowsing {
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

    // MARK: - Cart bar

    private var cartBar: some View {
        HStack(spacing: 12) {
            Button {
                showCart = true
                Haptics.tap()
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: "shippingbox.fill")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(vm.selectedEquipmentCount > 0 ? Color.statusText(.purple) : Color(.systemGray3))
                    Group {
                        if let justAdded {
                            Label(justAdded, systemImage: "checkmark.circle.fill")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(Color.statusText(.green))
                                .lineLimit(1)
                        } else if vm.selectedEquipmentCount == 0 {
                            Text("No equipment yet")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        } else {
                            HStack(spacing: 5) {
                                Text("\(vm.selectedEquipmentCount) item\(vm.selectedEquipmentCount == 1 ? "" : "s")")
                                    .font(.subheadline.weight(.semibold))
                                    .monospacedDigit()
                                    .contentTransition(.numericText())
                                Image(systemName: "chevron.up")
                                    .font(.caption2.weight(.bold))
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(vm.selectedEquipmentCount == 0)
            .accessibilityLabel("\(vm.selectedEquipmentCount) items selected, view selected equipment")
            .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: justAdded)
            .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: vm.selectedEquipmentCount)

            Spacer(minLength: 12)

            Button {
                attemptReview()
            } label: {
                Text(
                    vm.selectedLocationMismatchCount > 0
                        ? "Fix Location"
                        : (vm.selectedConflictCount == 0 ? "Review" : "Resolve Conflicts")
                )
                    .fontWeight(.semibold)
                    .padding(.horizontal, 6)
            }
            .buttonStyle(.borderedProminent)
            .tint(Color.statusText(.purple))
            .disabled(!vm.canReviewEquipment)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity)
        .background(.bar)
        .overlay(alignment: .top) { Divider() }
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
            noteAdded(asset.itemListPrimaryTitle)
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
        noteBulkChanged(sku.name)
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
        Haptics.tap()
    }

    private func noteBulkChanged(_ name: String) {
        Haptics.selection()
        justAddedClearTask?.cancel()
        justAdded = name
        justAddedClearTask = Task {
            try? await Task.sleep(for: .seconds(1.6))
            guard !Task.isCancelled else { return }
            justAdded = nil
        }
    }

    /// Post-add bookkeeping: haptic, clear the query so the next search
    /// starts clean (keyboard stays up), and flash the name on the cart bar.
    private func noteAdded(_ name: String) {
        Haptics.selection()
        if !vm.assetSearch.isEmpty {
            vm.assetSearch = ""
        }
        justAddedClearTask?.cancel()
        justAdded = name
        justAddedClearTask = Task {
            try? await Task.sleep(for: .seconds(1.6))
            guard !Task.isCancelled else { return }
            justAdded = nil
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

    private var atMax: Bool { quantity >= sku.availableQuantity }
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

            HStack(spacing: 4) {
                Button(action: onDecrement) {
                    Image(systemName: "minus")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(Color.statusText(.purple))
                        .frame(width: 30, height: 30)
                        .background(Color.statusBackground(.purple), in: Circle())
                }
                .buttonStyle(.plain)
                .disabled(quantity == 0)
                .accessibilityLabel("Remove one \(sku.name)")

                Text("\(quantity)")
                    .font(.subheadline.weight(.semibold).monospacedDigit())
                    .frame(minWidth: 20)
                    .contentTransition(.numericText())
                    .accessibilityLabel("\(quantity) selected")

                Button(action: onIncrement) {
                    Image(systemName: "plus")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(Color.statusText(.purple))
                        .frame(width: 30, height: 30)
                        .background(Color.statusBackground(.purple), in: Circle())
                }
                .buttonStyle(.plain)
                .disabled(atMax || !isAtPickupLocation)
                .accessibilityLabel("Add one \(sku.name)")
            }
        }
        .opacity(!isAtPickupLocation && quantity == 0 ? 0.48 : 1)
    }
}

private struct ReservationCategoryChip: View {
    let label: String
    let isOn: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(.caption.weight(.semibold))
                .foregroundStyle(isOn ? Color.statusText(.purple) : Color.secondary)
                .padding(.horizontal, 8)
                .frame(minHeight: 34)
                .background(isOn ? Color.statusBackground(.purple) : Color(.secondarySystemGroupedBackground), in: Capsule())
                .overlay(Capsule().strokeBorder(isOn ? Color.statusText(.purple).opacity(0.4) : Color.hairline))
                .fixedSize(horizontal: true, vertical: false)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }
}

private struct BatteryRecommendationCard: View {
    let recommendation: BatteryRecommendation
    let quantity: Int
    let onDecrement: () -> Void
    let onIncrement: () -> Void
    let onDismiss: () -> Void

    private var canIncrement: Bool { quantity < recommendation.sku.availableQuantity }

    var body: some View {
        HStack(spacing: 10) {
            BookingBulkThumbnail(imageUrl: recommendation.sku.imageUrl, size: 36, cornerRadius: 8)
            Text(recommendation.sku.name)
                .font(.subheadline.weight(.semibold))
                .lineLimit(1)
            Spacer(minLength: 4)
            HStack(spacing: 5) {
                Button(action: onDecrement) {
                    Image(systemName: "minus")
                        .font(.caption.weight(.bold))
                        .frame(width: 28, height: 28)
                        .background(Color(.tertiarySystemFill), in: Circle())
                }
                .buttonStyle(.plain)
                .disabled(quantity == 0)
                .accessibilityLabel("Remove one \(recommendation.sku.name)")
                Text("\(quantity)")
                    .font(.subheadline.weight(.semibold).monospacedDigit())
                    .frame(minWidth: 20)
                    .contentTransition(.numericText())
                Button(action: onIncrement) {
                    Image(systemName: "plus")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(.white)
                        .frame(width: 30, height: 30)
                        .background(Color.statusText(.purple), in: Circle())
                }
                .buttonStyle(.plain)
                .disabled(!canIncrement)
                .accessibilityLabel("Add one \(recommendation.sku.name)")
            }
            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .font(.caption.weight(.bold))
                    .frame(width: 28, height: 28)
            }
            .buttonStyle(.plain)
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
                                    systemImage: "mappin.slash.fill"
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
                                        isAtPickupLocation: vm.isAtPickupLocation(asset),
                                        upcomingCommitmentLabel: vm.upcomingCommitmentLabel(for: asset.id),
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
