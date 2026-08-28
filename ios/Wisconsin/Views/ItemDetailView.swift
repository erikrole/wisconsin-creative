import SwiftUI

struct ItemDetailView: View {
    let assetId: String

    @State private var asset: AssetDetail?
    @State private var isLoading = true
    @State private var error: String?
    @State private var showEdit = AppRuntimeMode.CaptureSeed.itemEdit
    @State private var isFavorited = false
    @State private var favoriteToggleCount = 0  // user-action ticks; isolates haptic from initial load
    @State private var toast: Toast?
    @State private var isTogglingMaintenance = false
    @Environment(SessionStore.self) private var session
    @Environment(ReservationDraftStore.self) private var drafts

    private var canEditAsset: Bool {
        let role = session.currentUser?.role ?? ""
        return role == "STAFF" || role == "ADMIN"
    }

    private func hasMoreActions(for asset: AssetDetail) -> Bool {
        canEditAsset
            || asset.qrCodeValue?.isEmpty == false
            || asset.linkUrl.flatMap(URL.init(string:)) != nil
    }

    private func toggleFavorite() async {
        let previous = isFavorited
        isFavorited.toggle()
        favoriteToggleCount &+= 1  // Tick the haptic counter only on user action.
        do {
            isFavorited = try await APIClient.shared.toggleFavorite(assetId: assetId)
        } catch {
            isFavorited = previous
            toast = Toast(message: "Couldn't update favorite", icon: "exclamationmark.triangle.fill", role: .error)
        }
    }

    var body: some View {
        Group {
            if isLoading && asset == nil {
                ItemDetailSkeleton()
            } else if let error, asset == nil {
                ContentUnavailableView {
                    Label("Couldn't load item", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(error)
                } actions: {
                    Button("Retry") { Task { await loadAsset() } }
                        .buttonStyle(.borderedProminent)
                }
            } else if let asset {
                ScrollView {
                    VStack(spacing: Brand.Space.sm) {
                        if let parent = asset.parentAsset {
                            ParentLinkCard(parent: parent)
                        }
                        ItemHeroCard(asset: asset, onCopyQR: copyQR)
                        if let booking = asset.activeBooking {
                            ActiveBookingCard(booking: booking)
                        } else {
                            ItemAvailabilityCard(
                                status: asset.computedStatus,
                                nextReservation: asset.upcomingReservations.min(by: { $0.startsAt < $1.startsAt })
                            )
                        }
                        if asset.computedStatus != .retired {
                            ReserveButton(title: asset.computedStatus == .available ? "Reserve Equipment" : "Reserve for Later") {
                                startReservation(for: asset.asAsset)
                            }
                        }
                        UpcomingReservationsCard(reservations: asset.upcomingReservations)
                        ItemDetailsCard(asset: asset, canSeeProcurement: canEditAsset)
                        ItemBookingsLinkCard(history: asset.history)
                        if let notes = asset.notes, !notes.isEmpty {
                            NotesCard(notes: notes)
                        }
                    }
                    .padding(.horizontal, Brand.Space.md)
                    .padding(.top, Brand.Space.sm)
                    .padding(.bottom, 88)
                }
                .background(Color(.systemGroupedBackground))
            }
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if asset != nil {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await toggleFavorite() }
                    } label: {
                        Image(systemName: isFavorited ? "star.fill" : "star")
                            .foregroundStyle(isFavorited ? .yellow : .primary)
                            .frame(minWidth: 44, minHeight: 44)
                    }
                    .accessibilityLabel(isFavorited ? "Unfavorite" : "Favorite")
                    .sensoryFeedback(.selection, trigger: favoriteToggleCount)
                }
                if let asset, hasMoreActions(for: asset) {
                    ToolbarItem(placement: .topBarTrailing) {
                        Menu {
                            if canEditAsset {
                                Button { showEdit = true } label: {
                                    Label("Edit Item", systemImage: "pencil")
                                }
                                // The one lifecycle action that belongs on a
                                // phone: gear breaks at a venue, and the person
                                // holding it is the one who knows. Duplicate,
                                // Retire, and Delete stay web-only — they are
                                // catalog administration, not field work
                                // (`docs/AREA_MOBILE.md`).
                                Button {
                                    Task { await toggleMaintenance(for: asset) }
                                } label: {
                                    Label(
                                        asset.computedStatus == .maintenance ? "Clear Maintenance" : "Needs Maintenance",
                                        systemImage: asset.computedStatus == .maintenance
                                            ? "wrench.and.screwdriver.fill"
                                            : "wrench.and.screwdriver"
                                    )
                                }
                                .disabled(isTogglingMaintenance)
                            }
                            if let qr = asset.qrCodeValue, !qr.isEmpty {
                                Button { copyQR(qr) } label: {
                                    Label("Copy QR Code", systemImage: "qrcode")
                                }
                            }
                            if let rawLink = asset.linkUrl, let link = URL(string: rawLink) {
                                Link(destination: link) {
                                    Label("Open Product Link", systemImage: "arrow.up.right.square")
                                }
                            }
                        } label: {
                            Image(systemName: "ellipsis")
                                .frame(minWidth: 44, minHeight: 44)
                        }
                        .accessibilityLabel("More item actions")
                    }
                }
            }
        }
        .toast($toast)
        .task { await loadAsset() }
        .refreshable { await loadAsset() }
        .sheet(isPresented: $showEdit) {
            if let asset {
                EditAssetSheet(asset: asset) { updated in
                    self.asset = asset.applying(updated)
                }
            }
        }
    }

    /// Reserving hands the item to the app-level composer. The user stays on
    /// this screen, and the reservation can be minimized to keep reading specs.
    private func startReservation(for asset: Asset) {
        drafts.start({
            let composer = CreateBookingViewModel()
            composer.prefillReservation(for: asset)
            return composer
        }())
    }

    private func loadAsset() async {
        isLoading = true
        error = nil
        do {
            asset = try await APIClient.shared.asset(id: assetId)
            isFavorited = asset?.isFavorited ?? false
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    /// Flags or clears maintenance, then refetches so every derived field on
    /// screen — status pill, availability, reserve affordance — comes from the
    /// server rather than from a locally guessed status. Deliberately not
    /// optimistic: this changes what other people can reserve.
    private func toggleMaintenance(for asset: AssetDetail) async {
        guard !isTogglingMaintenance else { return }
        isTogglingMaintenance = true
        defer { isTogglingMaintenance = false }
        do {
            let nowInMaintenance = try await APIClient.shared.toggleAssetMaintenance(assetId: asset.id)
            await loadAsset()
            Haptics.success()
            toast = Toast(
                message: nowInMaintenance ? "Flagged for maintenance" : "Maintenance cleared",
                icon: nowInMaintenance ? "wrench.and.screwdriver.fill" : "checkmark.circle.fill",
                role: .success
            )
        } catch {
            Haptics.error()
            toast = Toast(
                message: (error as? APIError)?.errorDescription ?? "Couldn't update maintenance",
                icon: "exclamationmark.triangle.fill",
                role: .error
            )
        }
    }

    /// Copy the QR sticker code to the clipboard with a confirming toast +
    /// haptic. Replaces the silent-copy behavior the hero card had inline.
    private func copyQR(_ value: String) {
        UIPasteboard.general.string = value
        Haptics.tap()
        toast = Toast(
            message: "Copied \(value)",
            icon: "checkmark.circle.fill",
            role: .success
        )
    }
}

// MARK: - Reserve button

private struct ReserveButton: View {
    let title: String
    let action: () -> Void

    var body: some View {
        // Matches the scan hero sheet's primary action: solid black
        // prominent button, so "reserve" reads the same everywhere.
        Button(action: action) {
            Label(title, systemImage: "calendar.badge.plus")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color(.systemBackground))
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)
        .controlSize(.large)
        .tint(Color.statusText(.purple))
        .accessibilityLabel(title)
    }
}

// MARK: - Edit Sheet

struct EditAssetSheet: View {
    let asset: AssetDetail
    let onSaved: (AssetUpdateConfirmation) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var serialNumber: String
    @State private var notes: String
    @State private var isSaving = false
    @State private var error: String?
    @State private var showDiscardConfirm = false

    init(asset: AssetDetail, onSaved: @escaping (AssetUpdateConfirmation) -> Void) {
        self.asset = asset
        self.onSaved = onSaved
        _name = State(wrappedValue: asset.name ?? "")
        _serialNumber = State(wrappedValue: asset.serialNumber ?? "")
        _notes = State(wrappedValue: asset.notes ?? "")
    }

    private var hasChanges: Bool {
        name != (asset.name ?? "")
            || serialNumber != (asset.serialNumber ?? "")
            || notes != (asset.notes ?? "")
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 12) {
                    FormCard {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Name")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .textCase(.uppercase)
                            TextField("Custom name (optional)", text: $name)
                                .font(.body)
                            Text("Overrides the default \(asset.displayName) label.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    FormCard {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Serial Number")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .textCase(.uppercase)
                            TextField("Serial number", text: $serialNumber)
                                .fontDesign(.monospaced)
                                .autocorrectionDisabled()
                                .textInputAutocapitalization(.never)
                        }
                    }
                    FormCard {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Notes")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .textCase(.uppercase)
                            TextField("Notes…", text: $notes, axis: .vertical)
                                .lineLimit(3...8)
                        }
                    }
                    if let error {
                        Text(error)
                            .foregroundStyle(Color.statusText(.red))
                            .font(.footnote)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 4)
                    }
                }
                .padding(20)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Edit Item")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        if isSaving { return }
                        if hasChanges {
                            showDiscardConfirm = true
                        } else {
                            dismiss()
                        }
                    }
                    .disabled(isSaving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await save() }
                    } label: {
                        if isSaving {
                            ProgressView().controlSize(.small)
                        } else {
                            Text("Save").fontWeight(.semibold)
                        }
                    }
                    .disabled(!hasChanges || isSaving)
                }
            }
            .interactiveDismissDisabled(hasChanges || isSaving)
            .confirmationDialog(
                "Discard changes?",
                isPresented: $showDiscardConfirm,
                titleVisibility: .visible
            ) {
                Button("Discard", role: .destructive) { dismiss() }
                Button("Keep Editing", role: .cancel) {}
            } message: {
                Text("Your changes will be lost.")
            }
        }
    }

    private func save() async {
        isSaving = true
        do {
            let updated = try await APIClient.shared.updateAsset(
                id: asset.id,
                name: textMutation(edited: name, original: asset.name),
                serialNumber: textMutation(edited: serialNumber, original: asset.serialNumber),
                notes: textMutation(edited: notes, original: asset.notes)
            )
            Haptics.success()
            onSaved(updated)
            dismiss()
        } catch {
            self.error = error.localizedDescription
            Haptics.warning()
        }
        isSaving = false
    }

    private func textMutation(edited: String, original: String?) -> AssetTextMutation {
        guard edited != (original ?? "") else { return .unchanged }
        return edited.isEmpty ? .clear : .value(edited)
    }
}

// MARK: - Hero card

private struct ItemHeroCard: View {
    let asset: AssetDetail
    let onCopyQR: (String) -> Void
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    // Primary identifier: assetTag if set, else brand+model
    private var heroTitle: String {
        asset.assetTag ?? asset.displayName
    }
    // Secondary: custom name, or brand+model when assetTag is the hero
    private var subtitle: String? {
        let candidate = asset.assetTag != nil
            ? (asset.name ?? asset.displayName)
            : asset.name
        guard let s = candidate, !s.isEmpty else { return nil }
        return s
    }

    var body: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: Brand.Space.md) {
                    banner
                    infoBlock
                }
            } else {
                HStack(alignment: .center, spacing: Brand.Space.md) {
                    banner
                    infoBlock
                }
            }
        }
        .padding(Brand.Space.md)
        .background(Color.cardSurface)
        .clipShape(RoundedRectangle(cornerRadius: Brand.Radius.card, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Brand.Radius.card, style: .continuous)
                .strokeBorder(Color.hairline, lineWidth: 0.5)
        )
    }

    // MARK: Banner

    @ViewBuilder
    private var banner: some View {
        if asset.imageUrl != nil {
            bannerArtwork
                .accessibilityLabel("Item photo")
        } else {
            bannerArtwork
                .accessibilityHidden(true)
        }
    }

    private var bannerArtwork: some View {
        // Full white when a photo exists: inventory shots are catalog images on
        // white, so the frame disappears into the image instead of letterboxing
        // it. Placeholders keep the brand-tinted gradient.
        Group {
            if asset.imageUrl != nil {
                Color.white
            } else {
                Color.clear
            }
        }
        .overlay { bannerImage }
        .frame(
            width: dynamicTypeSize.isAccessibilitySize ? nil : 124,
            height: dynamicTypeSize.isAccessibilitySize ? 180 : 124
        )
        .frame(maxWidth: dynamicTypeSize.isAccessibilitySize ? .infinity : nil)
        .clipped()
        .clipShape(RoundedRectangle(cornerRadius: Brand.Radius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Brand.Radius.md, style: .continuous)
                .strokeBorder(Color.hairline, lineWidth: 0.5)
        )
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private var bannerImage: some View {
        if let urlString = asset.imageUrl, let url = URL(string: urlString) {
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    // Fit, not fill: catalog product shots get cropped by fill.
                    image.resizable().scaledToFit().padding(10)
                case .empty:
                    ZStack { bannerPlaceholder; ProgressView() }
                default:
                    bannerPlaceholder
                }
            }
        } else {
            bannerPlaceholder
        }
    }

    private var bannerPlaceholder: some View {
        ZStack {
            LinearGradient(
                colors: [Color.brandPrimary.opacity(0.20), Color.brandPrimary.opacity(0.04)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            Image(systemName: "shippingbox.fill")
                .font(.system(size: 38))
                .foregroundStyle(Color.brandPrimary.opacity(0.35))
        }
        .accessibilityHidden(true)
    }

    // MARK: Info

    private var infoBlock: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(heroTitle)
                .font(.gothamBlack(size: 26, relativeTo: .title2))
                .tracking(-0.2)
                .lineLimit(2)

            if let sub = subtitle {
                Text(sub)
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .lineLimit(2)
            }

            Text(asset.location.name)
                .font(.caption.weight(.medium))
                .foregroundStyle(.secondary)
                .lineLimit(1)

            // QR sticker code — tap copies the value for the kiosk / relink form.
            if let qr = asset.qrCodeValue, !qr.isEmpty {
                Button {
                    onCopyQR(qr)
                } label: {
                    HStack(spacing: 5) {
                        Image(systemName: "qrcode")
                            .font(.caption2.weight(.semibold))
                        Text(qr)
                            .font(.system(.caption2, design: .monospaced))
                    }
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(Color(.tertiarySystemFill), in: Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("QR code \(qr), tap to copy")
                .padding(.top, 2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Location and details

private struct ItemDetailsCard: View {
    let asset: AssetDetail
    /// Web gates purchase date / fiscal year / price / product link to non-
    /// students under the "Procurement" section. iOS mirrors that gate via
    /// canEditAsset, which is already STAFF+ADMIN-only.
    let canSeeProcurement: Bool
    @State private var isExpanded = false
    @State private var attachmentsExpanded = false

    private struct Row {
        let label: String
        let value: String
        var mono: Bool = false
        var link: URL? = nil
    }

    private var rows: [Row] {
        var result: [Row] = []
        if let cat = asset.category { result.append(Row(label: "Category", value: cat.name)) }
        if let dept = asset.department { result.append(Row(label: "Department", value: dept.name)) }
        if let serial = asset.serialNumber { result.append(Row(label: "Serial", value: serial, mono: true)) }
        if let uwTag = asset.metadata?.uwAssetTag, !uwTag.isEmpty {
            result.append(Row(label: "UW Asset Tag", value: uwTag, mono: true))
        }
        if canSeeProcurement {
            if let raw = asset.purchaseDate,
               let date = ISO8601DateFormatter().date(from: raw) {
                result.append(Row(label: "Purchased", value: date.formatted(date: .abbreviated, time: .omitted)))
            }
            if let price = asset.purchasePrice.flatMap(Double.init) {
                let formatted = price.formatted(.currency(code: Locale.current.currency?.identifier ?? "USD"))
                result.append(Row(label: "Purchase Price", value: formatted))
            }
            if let raw = asset.linkUrl, !raw.isEmpty, let url = URL(string: raw) {
                result.append(Row(label: "Link", value: url.host ?? raw, link: url))
            }
        }
        return result
    }

    var body: some View {
        DisclosureGroup(isExpanded: $isExpanded) {
            VStack(spacing: 0) {
                ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                    VStack(spacing: 0) {
                        Divider().padding(.leading, 36)
                        rowContent(row)
                            .padding(.leading, 36)
                            .padding(.vertical, 11)
                    }
                }
                if let accessories = asset.accessories, !accessories.isEmpty {
                    Divider().padding(.leading, 36)
                    DisclosureGroup(isExpanded: $attachmentsExpanded) {
                        VStack(spacing: 0) {
                            ForEach(Array(accessories.enumerated()), id: \.element.id) { index, accessory in
                                if index > 0 { Divider().padding(.leading, 46) }
                                NavigationLink(destination: ItemDetailView(assetId: accessory.id)) {
                                    HStack(spacing: 10) {
                                        AssetThumbnail(imageUrl: accessory.imageUrl, size: 36)
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(accessory.assetTag)
                                                .font(.system(.subheadline, design: .monospaced).weight(.medium))
                                                .foregroundStyle(.primary)
                                            Text(accessory.name ?? accessory.displayName)
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                                .lineLimit(1)
                                        }
                                        Spacer()
                                        Image(systemName: "chevron.right")
                                            .font(.caption2.weight(.semibold))
                                            .foregroundStyle(.tertiary)
                                            .accessibilityHidden(true)
                                    }
                                    .padding(.vertical, 6)
                                }
                                .buttonStyle(.plain)
                                .accessibilityElement(children: .combine)
                                .accessibilityLabel("Attachment: \(accessory.assetTag), \(accessory.name ?? accessory.displayName)")
                            }
                        }
                        .padding(.leading, 36)
                    } label: {
                        HStack {
                            Label("Attachments", systemImage: "shippingbox")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(.primary)
                            Spacer()
                            Text("\(accessories.count)")
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(.tertiary)
                        }
                    }
                    .padding(.leading, 36)
                    .padding(.vertical, 11)
                    .tint(.secondary)
                }
            }
        } label: {
            Label("Details", systemImage: "info.circle")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.primary)
        }
        .padding(Brand.Space.md)
        .tint(.secondary)
        .brandCard(padding: 0)
    }

    @ViewBuilder
    private func rowContent(_ row: Row) -> some View {
        if let url = row.link {
            Link(destination: url) {
                HStack {
                    Text(row.label)
                        .font(.subheadline)
                        // Explicit label color: inside a tinted Link, the
                        // hierarchical `.primary` style adopts the accent
                        // (brand red) instead of the neutral label color.
                        .foregroundStyle(Color(.label))
                    Spacer()
                    Text(row.value)
                        .font(.subheadline)
                        .foregroundStyle(Color.statusText(.blue))
                        .lineLimit(1)
                    Image(systemName: "arrow.up.right.square")
                        .font(.caption2)
                        .foregroundStyle(Color.statusText(.blue))
                }
            }
            .accessibilityLabel("\(row.label) — opens in browser")
        } else {
            HStack {
                Text(row.label)
                    .font(.subheadline)
                    .foregroundStyle(.primary)
                Spacer()
                Text(row.value)
                    .font(row.mono ? .system(.subheadline, design: .monospaced) : .subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
    }
}

// MARK: - Active booking card

private struct ActiveBookingCard: View {
    let booking: AssetActiveBooking

    private var isReservation: Bool { booking.kind == "RESERVATION" }

    private func isPendingPickup(now: Date) -> Bool {
        if booking.kind == "CHECKOUT" && booking.status == "PENDING_PICKUP" {
            return true
        }
        return isReservation
            && booking.status == "BOOKED"
            && booking.startsAt.map { $0 <= now } == true
    }

    private func tone(now: Date) -> StatusTone {
        if booking.kind == "CHECKOUT" && booking.isOverdue { return .red }
        return isPendingPickup(now: now) ? .orange : isReservation ? .purple : .blue
    }

    private func timing(now: Date) -> String {
        if let startsAt = booking.startsAt, isPendingPickup(now: now) {
            return "Scheduled pickup \(startsAt.operationalDateTimeLabel(now: now, capitalizesRelativeDay: false))"
        }
        if let startsAt = booking.startsAt, isReservation {
            return "Pickup \(startsAt.operationalDateTimeLabel(now: now, capitalizesRelativeDay: false))"
        }
        return Date.itemDueLabel(for: booking.endsAt, now: now)
    }

    var body: some View {
        TimelineView(.periodic(from: .now, by: 60)) { context in
            let pendingPickup = isPendingPickup(now: context.date)
            let title = pendingPickup ? "Pending Pickup" : isReservation ? "Active Reservation" : "Checked Out"
            let currentTone = tone(now: context.date)
            NavigationLink(destination: BookingDetailView(bookingId: booking.id)) {
                HStack(spacing: 12) {
                    StatusRail(tone: currentTone)
                    UserAvatarView(
                        name: booking.requesterName,
                        avatarUrl: booking.requesterAvatarUrl,
                        size: 40
                    )
                    VStack(alignment: .leading, spacing: 3) {
                        Text(booking.title)
                            .font(.headline)
                            .foregroundStyle(.primary)
                            .lineLimit(1)
                        Text(timing(now: context.date))
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(Color.statusText(currentTone))
                            .contentTransition(.numericText())
                        Text(booking.requesterName)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 8)
                    Image(systemName: "chevron.right")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.tertiary)
                        .accessibilityHidden(true)
                }
                .frame(minHeight: 54)
            }
            .buttonStyle(.plain)
            .brandCard(padding: Brand.Space.md)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(title): with \(booking.requesterName), \(booking.title), \(timing(now: context.date))")
            .accessibilityHint("Opens booking details")
        }
    }

}

// MARK: - Availability card

private struct ItemAvailabilityCard: View {
    let status: AssetComputedStatus
    let nextReservation: UpcomingReservation?

    private var tone: StatusTone {
        switch status {
        case .available: return .green
        case .checkedOut: return .blue
        case .pendingPickup, .maintenance: return .orange
        case .reserved: return .purple
        case .retired, .unknown: return .gray
        }
    }

    private var title: String {
        guard status == .available else { return status.label }
        guard let nextReservation else { return "Available" }
        return "Available until \(nextReservation.startsAt.formatted(date: .abbreviated, time: .shortened))"
    }

    var body: some View {
        HStack(spacing: 12) {
            StatusRail(tone: tone)
            Image(systemName: status == .available ? "checkmark.circle.fill" : "info.circle.fill")
                .font(.title3)
                .foregroundStyle(Color.statusText(tone))
                .accessibilityHidden(true)
            Text(title)
                .font(.headline)
                .foregroundStyle(.primary)
            Spacer(minLength: 0)
        }
        .frame(minHeight: 44)
        .brandCard(padding: Brand.Space.md)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Item bookings

private struct UpcomingReservationsCard: View {
    let reservations: [UpcomingReservation]

    private var orderedReservations: [UpcomingReservation] {
        reservations.sorted { $0.startsAt < $1.startsAt }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "calendar.badge.clock")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color.statusText(.purple))
                    .accessibilityHidden(true)
                Text("Upcoming Reservations")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .textCase(.uppercase)
                    .tracking(0.04)
                Spacer()
                Text("\(orderedReservations.count)")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.tertiary)
            }

            if orderedReservations.isEmpty {
                Text("No upcoming reservations")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .padding(.vertical, 6)
            } else {
                ForEach(Array(orderedReservations.enumerated()), id: \.element.id) { index, reservation in
                    if index > 0 { Divider() }
                    NavigationLink(destination: BookingDetailView(bookingId: reservation.bookingId)) {
                        HStack(spacing: 10) {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(reservation.title)
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(.primary)
                                    .lineLimit(1)
                                Text("\(reservation.requesterName) · \(bookingDateRange(from: reservation.startsAt, to: reservation.endsAt))")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(2)
                            }
                            Spacer(minLength: 8)
                            Image(systemName: "chevron.right")
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle(.tertiary)
                                .accessibilityHidden(true)
                        }
                        .padding(.vertical, 6)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Upcoming reservation: \(reservation.title), \(reservation.requesterName), \(bookingDateRange(from: reservation.startsAt, to: reservation.endsAt))")
                }
            }
        }
        .brandCard()
    }
}

private struct ItemBookingsLinkCard: View {
    let history: [AssetBookingHistoryEntry]

    private var previous: [AssetBookingHistoryEntry] {
        previousBookings(from: history)
    }

    var body: some View {
        NavigationLink {
            ItemBookingsView(
                previousBookings: previous
            )
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "calendar")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .frame(width: 24)
                    .accessibilityHidden(true)
                Text("Previous Bookings")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.primary)
                Spacer(minLength: 8)
                Image(systemName: "chevron.right")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
            .padding(Brand.Space.md)
            .contentShape(Rectangle())
            .brandCard(padding: 0)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Previous Bookings, \(previous.count)")
        .accessibilityHint("Shows previous bookings")
    }
}

private struct ItemBookingsView: View {
    let previousBookings: [AssetBookingHistoryEntry]
    @State private var visiblePreviousCount = 10

    private var visiblePreviousBookings: [AssetBookingHistoryEntry] {
        Array(previousBookings.prefix(visiblePreviousCount))
    }

    var body: some View {
        List {
            Section("Previous Bookings") {
                if previousBookings.isEmpty {
                    Text("No previous bookings")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(visiblePreviousBookings) { entry in
                        NavigationLink(destination: BookingDetailView(bookingId: entry.booking.id)) {
                            HStack(spacing: 10) {
                                UserAvatarView(
                                    name: entry.booking.requester?.name ?? "Unknown",
                                    avatarUrl: entry.booking.requester?.avatarUrl,
                                    size: 36
                                )
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(entry.booking.title)
                                        .font(.subheadline.weight(.semibold))
                                        .lineLimit(1)
                                    Text("\(entry.booking.requester?.name ?? "Unknown") · \(bookingDateRange(from: entry.booking.startsAt, to: entry.booking.endsAt))")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(2)
                                }
                                Spacer(minLength: 8)
                                StatusBadge(status: entry.booking.status, kind: entry.booking.kind)
                            }
                        }
                        .accessibilityLabel("Previous booking: \(entry.booking.title), \(entry.booking.requester?.name ?? "Unknown"), \(bookingDateRange(from: entry.booking.startsAt, to: entry.booking.endsAt))")
                        .onAppear {
                            guard entry.id == visiblePreviousBookings.last?.id else { return }
                            visiblePreviousCount = min(visiblePreviousCount + 10, previousBookings.count)
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Previous Bookings")
        .navigationBarTitleDisplayMode(.inline)
    }
}

private func previousBookings(
    from history: [AssetBookingHistoryEntry],
    now: Date = .now
) -> [AssetBookingHistoryEntry] {
    var seen = Set<String>()
    return history
        .filter { entry in
            guard entry.booking.endsAt < now else { return false }
            guard entry.booking.status != .cancelled, entry.booking.status != .draft else { return false }
            return seen.insert(entry.booking.id).inserted
        }
        .sorted { $0.booking.endsAt > $1.booking.endsAt }
}

private func bookingDateRange(from start: Date, to end: Date) -> String {
    if Calendar.current.isDate(start, inSameDayAs: end) {
        return "\(start.formatted(date: .abbreviated, time: .shortened)) – \(end.formatted(date: .omitted, time: .shortened))"
    }
    return "\(start.formatted(date: .abbreviated, time: .omitted)) – \(end.formatted(date: .abbreviated, time: .omitted))"
}

// MARK: - Parent link card

/// Shown above the hero when this asset is itself an accessory — a tap leads
/// back to the parent gear so floor users can answer "what does this cable
/// belong to?" in one tap.
private struct ParentLinkCard: View {
    let parent: AssetParentLink

    var body: some View {
        NavigationLink(destination: ItemDetailView(assetId: parent.id)) {
            HStack(spacing: 10) {
                Image(systemName: "link")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Part of")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .textCase(.uppercase)
                        .tracking(0.04)
                    HStack(spacing: 6) {
                        Text(parent.assetTag)
                            .font(.system(.subheadline, design: .monospaced).weight(.medium))
                        Text(parent.name ?? parent.displayName)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
            .padding(12)
            .background(Color(.secondarySystemGroupedBackground))
            .clipShape(RoundedRectangle(cornerRadius: Brand.Radius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Brand.Radius.md, style: .continuous)
                    .strokeBorder(Color.hairline, lineWidth: 0.5)
            )
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Part of \(parent.assetTag), \(parent.name ?? parent.displayName)")
    }
}

// MARK: - Notes card

private struct NotesCard: View {
    let notes: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "note.text")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Text("Notes")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .textCase(.uppercase)
                    .tracking(0.04)
            }
            Text(notes)
                .font(.subheadline)
                .foregroundStyle(.primary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .brandCard()
    }
}

// MARK: - Date helpers

private extension Date {
    /// Natural sentence-case due copy for Item Detail, with punctuation between
    /// duration components: "Due in 2 hours, 40 minutes."
    static func itemDueLabel(for endsAt: Date, now: Date = .now) -> String {
        let interval = endsAt.timeIntervalSince(now)
        let totalMinutes = max(1, Int(abs(interval) / 60))
        let days = totalMinutes / (24 * 60)
        let hours = (totalMinutes % (24 * 60)) / 60
        let minutes = totalMinutes % 60
        var components: [String] = []

        if days > 0 {
            components.append("\(days) \(days == 1 ? "day" : "days")")
            if hours > 0 { components.append("\(hours) \(hours == 1 ? "hour" : "hours")") }
        } else if hours > 0 {
            components.append("\(hours) \(hours == 1 ? "hour" : "hours")")
            if minutes > 0 { components.append("\(minutes) \(minutes == 1 ? "minute" : "minutes")") }
        } else {
            components.append("\(minutes) \(minutes == 1 ? "minute" : "minutes")")
        }

        return "\(interval < 0 ? "Overdue by" : "Due in") \(components.joined(separator: ", "))"
    }

    /// "Today", "Tomorrow", "in N days" for near dates; abbreviated date beyond 7 days.
    var relativeLabel: String {
        let days = Calendar.current.dateComponents([.day], from: .now, to: self).day ?? 0
        switch days {
        case 0: return "Today"
        case 1: return "Tomorrow"
        case 2...7: return "in \(days) days"
        default: return formatted(date: .abbreviated, time: .omitted)
        }
    }
}
