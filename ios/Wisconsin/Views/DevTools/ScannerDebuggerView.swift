import SwiftUI

struct ScannerDebuggerView: View {
    @State private var isSearching = false
    @State private var results: SearchResults?
    @State private var resultError: String?
    @State private var showManualEntry = false
    @State private var navigationPath = NavigationPath()
    @State private var lastRawScan: String?
    @State private var lastHandledCode: String?
    @State private var lastHandledAt: Date = .distantPast
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack(path: $navigationPath) {
            List {
                Section {
                    statusCard
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                }

                Section("Last scan") {
                    LabeledContent("Raw value") {
                        Text(lastRawScan ?? "Waiting")
                            .font(.system(.body, design: .monospaced))
                            .foregroundStyle(lastRawScan == nil ? .secondary : .primary)
                            .textSelection(.enabled)
                    }
                    LabeledContent("Trimmed value") {
                        Text(lastHandledCode ?? "Waiting")
                            .font(.system(.body, design: .monospaced))
                            .foregroundStyle(lastHandledCode == nil ? .secondary : .primary)
                            .textSelection(.enabled)
                    }
                    LabeledContent("Lookup") {
                        if isSearching {
                            ProgressView()
                                .controlSize(.small)
                        } else if resultError != nil {
                            Text("Error")
                                .foregroundStyle(Color.statusText(.red))
                        } else if let results, !results.isEmpty {
                            Text("Matched")
                                .foregroundStyle(Color.statusText(.green))
                        } else if results != nil {
                            Text("No match")
                                .foregroundStyle(Color.statusText(.orange))
                        } else {
                            Text("Ready")
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                Section {
                    Button {
                        showManualEntry = true
                    } label: {
                        Label("Type code instead", systemImage: "keyboard")
                    }

                    if let code = lastHandledCode {
                        Button {
                            retry(code)
                        } label: {
                            Label("Run last scan again", systemImage: "arrow.clockwise")
                        }
                        .disabled(isSearching)
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Scanner Debugger")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .overlay(alignment: .bottom) {
                HIDScannerField { value in
                    handleScan(value)
                }
                .frame(width: 1, height: 1)
                .opacity(0)
            }
            .navigationDestination(for: Asset.self) { asset in
                ItemDetailView(assetId: asset.id)
            }
            .navigationDestination(for: Booking.self) { booking in
                BookingDetailView(bookingId: booking.id)
            }
            .navigationDestination(for: BookingRouteId.self) { route in
                BookingDetailView(bookingId: route.id)
            }
            .sheet(isPresented: Binding(
                get: { results != nil || resultError != nil },
                set: { presented in
                    if !presented {
                        results = nil
                        resultError = nil
                    }
                }
            )) {
                ScanResultSheet(
                    results: results ?? SearchResults(),
                    error: resultError,
                    navigationPath: $navigationPath,
                    onTypeCode: {
                        results = nil
                        resultError = nil
                        showManualEntry = true
                    },
                    onRetry: retryLastScan,
                    onRefresh: refreshLookup
                )
                .presentationDetents(resultSheetDetents)
                .presentationDragIndicator(.visible)
            }
            .sheet(isPresented: $showManualEntry) {
                ScanManualEntrySheet { code in
                    showManualEntry = false
                    handleScan(code)
                }
                .presentationDetents([.medium])
                .presentationDragIndicator(.visible)
            }
            .animation(reduceMotion ? nil : .spring(duration: 0.25), value: isSearching)
        }
    }

    private var statusCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 14) {
                ZStack {
                    Circle()
                        .fill(Color.statusBackground(isSearching ? .blue : .green))
                    Image(systemName: isSearching ? "magnifyingglass" : "barcode.viewfinder")
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(Color.statusText(isSearching ? .blue : .green))
                }
                .frame(width: 48, height: 48)

                VStack(alignment: .leading, spacing: 4) {
                    Text(isSearching ? "Looking up scan" : "Ready for scanner")
                        .font(.headline)
                    Text(statusSubtitle)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }

            Text("Keep this screen open, scan a real gear label with the hand scanner, and the normal scan hero card will open from the lookup result.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private var statusSubtitle: String {
        if let lastHandledCode {
            return "Last scan: \(lastHandledCode)"
        }
        return "Scanner must be in HID keyboard mode with Return after scan."
    }

    private var resultSheetDetents: Set<PresentationDetent> {
        guard resultError == nil, let results, !results.isEmpty else {
            return [.medium]
        }
        return [.medium, .large]
    }

    private func handleScan(_ value: String) {
        lastRawScan = value
        let code = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !code.isEmpty else { return }

        let now = Date()
        if code == lastHandledCode, now.timeIntervalSince(lastHandledAt) < 1.5 {
            return
        }
        lastHandledCode = code
        lastHandledAt = now

        isSearching = true
        resultError = nil
        results = nil

        Task {
            defer { isSearching = false }
            do {
                let outcome = try await SearchService.shared.search(query: code, rawScan: code)
                results = outcome
                if outcome.isEmpty {
                    Haptics.warning()
                } else {
                    Haptics.success()
                }
            } catch {
                resultError = (error as? APIError)?.errorDescription
                    ?? "Couldn't reach the server. Try again in a moment."
                Haptics.error()
            }
        }
    }

    private func retry(_ code: String) {
        lastHandledCode = nil
        lastHandledAt = .distantPast
        handleScan(code)
    }

    private func retryLastScan() {
        guard let code = lastHandledCode else { return }
        retry(code)
    }

    private func refreshLookup() async {
        guard let code = lastHandledCode else { return }
        if let fresh = try? await SearchService.shared.search(query: code, rawScan: code),
           !fresh.isEmpty {
            results = fresh
        }
    }
}

// MARK: - Result sheet

/// Scan lookup result presentation shared by the Scanner Debugger tool. The
/// main app's Search tab uses its own inline results list instead of this
/// sheet (see `GlobalSearchSheet`), so this stays scoped to the debugger.
struct ScanResultSheet: View {
    let results: SearchResults
    let error: String?
    @Binding var navigationPath: NavigationPath
    var onTypeCode: () -> Void
    var onRetry: () -> Void
    var onRefresh: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(ReservationDraftStore.self) private var drafts

    var body: some View {
        Group {
            if let error {
                errorState(message: error)
            } else if results.isEmpty {
                emptyState
            } else if let asset = results.singleAssetMatch {
                // One unambiguous serialized asset → rich hero card with
                // tap-through to Item Detail.
                ScrollView {
                    ScanAssetHeroCard(
                        asset: asset,
                        onViewItem: {
                            navigationPath.append(asset)
                            dismiss()
                        },
                        onReserve: { startReservation(for: asset) },
                        onOpenBooking: openBooking
                    )
                }
                .refreshable { await onRefresh() }
            } else if let family = results.singleFamilyMatch {
                // One bulk-unit match → rich hero card. No detail screen
                // exists for bulk SKUs on iOS; the card is the destination.
                ScrollView {
                    ScanFamilyHeroCard(
                        family: family,
                        onReserve: { startReservation(forFamily: family) },
                        onOpenBooking: openBooking
                    )
                }
                .refreshable { await onRefresh() }
            } else {
                ScrollView { resultRows }
                    .refreshable { await onRefresh() }
            }
        }
        .presentationCornerRadius(24)
    }

    /// This result list is itself a sheet, so it has to be off screen before
    /// the app-level composer presents; otherwise the two presentations race.
    private func startReservation(for asset: Asset) {
        startAfterDismiss {
            let composer = CreateBookingViewModel()
            composer.prefillReservation(for: asset)
            return composer
        }
    }

    private func startReservation(forFamily family: AssetFamilySearchResult) {
        startAfterDismiss {
            let composer = CreateBookingViewModel()
            composer.prefillReservation(forFamily: family)
            return composer
        }
    }

    private func startAfterDismiss(_ makeComposer: @escaping () -> CreateBookingViewModel) {
        dismiss()
        Task {
            try? await Task.sleep(for: .milliseconds(350))
            drafts.start(makeComposer())
        }
    }

    /// Lands on the freshly created booking: dismisses the result sheet and
    /// pushes detail on the scan tab's navigation stack.
    private func openBooking(_ id: String) {
        navigationPath.append(BookingRouteId(id: id))
        dismiss()
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label("Nothing found", systemImage: "qrcode.viewfinder")
        } description: {
            Text("This code isn't linked to any item yet.")
        } actions: {
            Button {
                onTypeCode()
            } label: {
                Label("Type code instead", systemImage: "keyboard")
            }
            .buttonStyle(.bordered)
        }
    }

    private func errorState(message: String) -> some View {
        ContentUnavailableView {
            Label("Couldn't look that up", systemImage: "wifi.exclamationmark")
        } description: {
            Text(message)
        } actions: {
            Button {
                onRetry()
            } label: {
                Label("Retry", systemImage: "arrow.clockwise")
            }
            .buttonStyle(.borderedProminent)

            Button {
                onTypeCode()
            } label: {
                Label("Type code instead", systemImage: "keyboard")
            }
            .buttonStyle(.bordered)
        }
    }

    private var resultRows: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(results.items.enumerated()), id: \.element.id) { index, asset in
                Button {
                    navigationPath.append(asset)
                    dismiss()
                } label: {
                    HStack {
                        AssetResultRow(asset: asset)
                        Image(systemName: "chevron.right")
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                            .padding(.trailing, 4)
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 6)
                }
                .buttonStyle(.plain)
                if index < results.items.count - 1 || !results.itemFamilies.isEmpty || !results.reservations.isEmpty || !results.checkouts.isEmpty || !results.users.isEmpty {
                    Divider().padding(.leading, 72)
                }
            }

            ForEach(Array(results.itemFamilies.enumerated()), id: \.element.id) { index, family in
                ItemFamilyResultRow(family: family)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 6)
                if index < results.itemFamilies.count - 1 || !results.reservations.isEmpty || !results.checkouts.isEmpty || !results.users.isEmpty {
                    Divider().padding(.leading, 72)
                }
            }

            let bookings = results.reservations + results.checkouts
            ForEach(Array(bookings.enumerated()), id: \.element.id) { index, booking in
                Button {
                    navigationPath.append(booking)
                    dismiss()
                } label: {
                    BookingResultRow(booking: booking)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 6)
                }
                .buttonStyle(.plain)
                if index < bookings.count - 1 || !results.users.isEmpty {
                    Divider().padding(.leading, 68)
                }
            }

            ForEach(Array(results.users.enumerated()), id: \.element.id) { index, user in
                UserResultRow(user: user)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 6)
                if index < results.users.count - 1 {
                    Divider().padding(.leading, 68)
                }
            }
        }
        .padding(.top, 8)
    }
}
