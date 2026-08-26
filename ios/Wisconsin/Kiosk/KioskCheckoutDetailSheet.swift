import SwiftUI

// MARK: - Checkout detail drawer
//
// Read-only checkout detail with in-place active-checkout edits (title, due
// back, add/remove item). Extracted verbatim from KioskIdleView.swift
// (2026-07-02 rework Slice 5a).

/// Lightweight context captured from the tapped row so the drawer can render
/// its header (who/what/when) immediately while the item list loads.
struct KioskCheckoutDrawerContext: Identifiable {
    let checkoutId: String
    let title: String
    let requesterId: String?
    let requesterName: String
    let requesterAvatarUrl: String?
    let endsAt: Date
    let isOverdue: Bool

    var id: String { checkoutId }

    var requesterInitials: String {
        requesterName.split(separator: " ").prefix(2)
            .compactMap { $0.first }
            .map { String($0) }
            .joined()
            .uppercased()
    }
}

struct KioskCheckoutDetailSheet: View {
    @Environment(\.dismiss) private var dismiss
    // Sheets inherit the environment, and the tip has to track connect/
    // disconnect live rather than snapshot it when the sheet was built.
    @Environment(KioskStore.self) private var store
    let context: KioskCheckoutDrawerContext
    let allowsEditing: Bool
    var onReturn: (() -> Void)? = nil
    var onScan: ((String) -> Void)? = nil
    let onChanged: () -> Void

    @State private var detail: KioskCheckoutDetail?
    @State private var isLoading = true
    @State private var loadError: String?
    @State private var editTitle = ""
    @State private var editEndsAt = Date().addingTimeInterval(24 * 60 * 60)
    @State private var titleFocused = false
    @State private var scannerCaptureEnabled = false
    @State private var activeMutation: ActiveMutation?
    @State private var pendingRemoval: KioskCheckoutDetail.ReturnItem?
    @State private var mutationMessage: KioskMutationMessage?
    @State private var showCamera = false

    private enum ActiveMutation: Equatable {
        case savingDetails
        case addingItem
        case removingItem
    }

    private var isMutating: Bool {
        activeMutation != nil
    }

    private var shouldListenForItemScans: Bool {
        canEditActiveCheckout
            && scannerCaptureEnabled
            && !titleFocused
            && !isMutating
            && pendingRemoval == nil
            && !showCamera
    }

    private var actorId: String? {
        context.requesterId ?? detail?.requesterId
    }

    private var canEditActiveCheckout: Bool {
        allowsEditing && detail?.status == "OPEN" && actorId != nil
    }

    private var currentTitle: String {
        detail?.title ?? context.title
    }

    private var currentEndsAt: Date {
        detail?.endsAt ?? context.endsAt
    }

    private var currentIsOverdue: Bool {
        currentEndsAt < Date()
    }

    private var custodyTone: Color {
        KioskStatus.custody(isOverdue: currentIsOverdue, dueAt: currentEndsAt)
    }

    var body: some View {
        ZStack {
            KioskSurface.base.ignoresSafeArea()
            VStack(alignment: .leading, spacing: 18) {
                header

                if let mutationMessage {
                    KioskFeedbackBanner(tone: mutationMessage.tone, message: mutationMessage.text)
                }

                // Controls left, manifest right. Stacking everything vertically
                // left the item list with whatever height the edit and scan
                // panels did not take -- about two rows of a six-item checkout,
                // on the screen whose entire job is showing what someone has.
                // The manifest now owns a full-height column of its own.
                if canEditActiveCheckout {
                    GeometryReader { proxy in
                        if proxy.size.width < KioskLayout.compactBreakpoint {
                            VStack(alignment: .leading, spacing: KioskSpacing.md) {
                                controlColumn
                                itemsPanel
                            }
                        } else {
                            HStack(alignment: .top, spacing: KioskSpacing.lg) {
                                controlColumn
                                    .frame(width: proxy.size.width * 0.44, alignment: .topLeading)
                                itemsPanel
                                    .frame(maxWidth: .infinity, alignment: .topLeading)
                            }
                        }
                    }
                } else {
                    timingRow
                    itemsPanel
                }
            }
            .padding(28)

            if canEditActiveCheckout {
                HIDScannerField(isEnabled: shouldListenForItemScans) { value in
                    Task { await addItem(scanValue: value) }
                }
                .frame(width: 1, height: 1)
                .opacity(0)
            }

            // A sheet presents above the shell, so the shell's copy of this
            // popup would sit behind it. Each presentation context needs its
            // own mount.
            KioskKeyboardHint(isFieldFocused: titleFocused)
        }
        .overlay(alignment: .bottom) {
            if !allowsEditing, let onScan {
                HIDScannerField(onScan: onScan).frame(width: 1, height: 1).opacity(0)
            }
        }
        .task {
            await load()
            armScannerCapture()
        }
        .onDisappear {
            scannerCaptureEnabled = false
        }
        .onChange(of: titleFocused) { _, isFocused in
            // Report focus so the shell's keyboard popup can arm for this
            // field the same way it does for checkout setup.
            store.scanner.setEditing(isFocused)
            if !isFocused {
                armScannerCapture()
            }
        }
        .onDisappear { store.scanner.setEditing(false) }
        .sheet(isPresented: $showCamera) {
            KioskBarcodeCameraView(
                feedbackMessage: mutationMessage?.text,
                feedbackTone: mutationMessage?.tone,
                onScan: { value in Task { await addItem(scanValue: value) } },
                onCancel: { showCamera = false }
            )
        }
        .onChange(of: showCamera) { _, isShowing in
            // The hidden HID field yielded first responder to the camera sheet;
            // take it back explicitly rather than waiting for a tap that may
            // never come on a mounted kiosk.
            if !isShowing {
                armScannerCapture()
            }
        }
        .confirmationDialog(
            "Remove item from checkout?",
            isPresented: Binding(
                get: { pendingRemoval != nil },
                set: { if !$0 { pendingRemoval = nil } }
            ),
            titleVisibility: .visible,
            presenting: pendingRemoval
        ) { item in
            Button("Remove \(item.itemListPrimaryTitle)", role: .destructive) {
                pendingRemoval = nil
                Task { await removeItem(item) }
            }
            Button("Cancel", role: .cancel) {
                pendingRemoval = nil
            }
        } message: { item in
            Text("This releases \(item.name) from \(context.requesterName)'s active checkout.")
        }
    }

    /// Left column while editing: how to add another item, then what can be
    /// changed about the booking. Everything here is an input; nothing here is
    /// the custody record itself.
    ///
    /// Adding items leads. This sheet is reached from a row now labelled "Add
    /// Items", and adding gear to a live checkout is the errand people bring to
    /// the counter; retitling the booking is housekeeping. The order used to be
    /// the other way around, so the panel that answers the question you opened
    /// the sheet with sat below a title field and a date picker.
    private var controlColumn: some View {
        VStack(alignment: .leading, spacing: 18) {
            // No separate DUE banner here: the edit panel's own pickers are the
            // authority on due-back while editing, and showing the same
            // timestamp twice, stacked, was the sheet's most obvious redundancy.
            // The urgency chip that made the banner worth reading moves into the
            // edit panel header instead.
            scanToAddPanel
            editPanel
            Spacer(minLength: 0)
        }
    }

    /// The custody manifest. Full height in its own column so a six-item
    /// checkout reads as a list rather than a peek.
    private var itemsPanel: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Items")
                    .font(KioskType.sectionTitle)
                    .foregroundStyle(KioskText.primary)
                Spacer()
                if let items = detail?.items, !items.isEmpty {
                    Text("\(items.count)")
                        .font(KioskType.chip.monospacedDigit())
                        .foregroundStyle(KioskText.secondary)
                }
            }

            if isLoading {
                ProgressView().tint(KioskText.primary)
                    .frame(maxWidth: .infinity, minHeight: 80)
            } else if let loadError {
                KioskErrorState(title: loadError) { Task { await load() } }
            } else if detail?.items.isEmpty != false {
                ContentUnavailableView(
                    "No Items",
                    systemImage: "shippingbox",
                    description: Text("This checkout has no equipment.")
                )
                .foregroundStyle(KioskText.secondary)
                .frame(maxWidth: .infinity, minHeight: 100)
            } else {
                ScrollView {
                    LazyVStack(spacing: 8) {
                        ForEach(detail?.items ?? []) { item in
                            itemRow(item)
                        }
                    }
                }
                .scrollIndicators(.visible)
            }
        }
        .frame(maxHeight: .infinity, alignment: .top)
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 14) {
            KioskAvatar(url: context.requesterAvatarUrl, initials: context.requesterInitials, size: 48)
            VStack(alignment: .leading, spacing: 4) {
                Text(currentTitle)
                    .font(.title2.weight(.heavy))
                    .foregroundStyle(KioskText.primary)
                    .lineLimit(2)
                    .minimumScaleFactor(0.78)
                Text(context.requesterName)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(KioskText.secondary)
            }
            Spacer()
            if let onReturn {
                // Returning gear is the primary custody action on this sheet,
                // so it carries the brand red. Save and Remove are deliberately
                // quieter below — red here must mean "the main thing to do".
                Button("Return Gear") {
                    dismiss()
                    onReturn()
                }
                .font(.headline.weight(.semibold))
                .buttonStyle(.glassProminent)
                .tint(Color.kioskRed)
                .controlSize(.large)
            }
            Button("Done") { dismiss() }
                .font(.headline.weight(.semibold))
                .foregroundStyle(KioskText.primary)
                .buttonStyle(.glass)
                .controlSize(.large)
        }
    }

    /// Every input on this sheet used to be an unlabelled box -- a bare "Shoot"
    /// field and a bare date/time pair -- so nothing said what you were editing.
    private func fieldLabel(_ text: String) -> some View {
        Text(text.uppercased())
            .font(KioskType.overline)
            .tracking(1.2)
            .foregroundStyle(KioskText.muted)
    }

    private var editPanel: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Text("Edit Checkout")
                    .font(KioskType.sectionTitle)
                    .foregroundStyle(KioskText.primary)
                Spacer()
                // Secondary: editing the title/due-back is housekeeping, not
                // the reason this sheet is open. Red belongs to Return Gear.
                Button(activeMutation == .savingDetails ? "Saving..." : "Save") {
                    Task { await saveDetails() }
                }
                .font(KioskType.chip)
                .kioskButtonRole(.secondary)
                .controlSize(.regular)
                .disabled(isMutating)
            }

            fieldLabel("Title")
            KioskNativeTextField(
                placeholder: "Checkout title",
                text: $editTitle,
                isFocused: $titleFocused
            )
            .padding(.horizontal, 12)
            .frame(height: 46)
            .frame(maxWidth: .infinity)
            .background(KioskSurface.sunken, in: RoundedRectangle(cornerRadius: KioskRadius.md))
            .overlay(RoundedRectangle(cornerRadius: KioskRadius.md).stroke(KioskStroke.standard, lineWidth: 1))

            HStack(spacing: 8) {
                fieldLabel("Due back")
                // The urgency chip lives next to the control that sets it, so
                // the sheet states the due time once instead of twice.
                Text(relativeDue)
                    .font(KioskType.micro)
                    .foregroundStyle(custodyTone)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(custodyTone.opacity(0.14), in: Capsule())
                Spacer()
            }

            HStack(spacing: 12) {
                DatePicker(
                    "Due date",
                    selection: clampedEditEndsAt,
                    in: minimumEditEndsAt...,
                    displayedComponents: .date
                )
                .labelsHidden()
                .datePickerStyle(.compact)

                KioskQuarterHourTimePicker(
                    selection: clampedEditEndsAt,
                    minimumDate: minimumEditEndsAt
                )
            }
            .tint(Color.kioskRed)
            .frame(height: 46)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 10)
            .background(KioskSurface.sunken, in: RoundedRectangle(cornerRadius: KioskRadius.md))
            .overlay(RoundedRectangle(cornerRadius: KioskRadius.md).stroke(KioskStroke.standard, lineWidth: 1))
        }
        .padding(14)
        .background(KioskSurface.card, in: RoundedRectangle(cornerRadius: KioskRadius.lg))
        .overlay(RoundedRectangle(cornerRadius: KioskRadius.lg).stroke(KioskStroke.standard, lineWidth: 1))
    }

    /// Adding gear to a live checkout, stated as an instruction with a control
    /// beside it.
    ///
    /// This panel used to be a viewfinder graphic, a heading, and a readiness
    /// badge — three pieces of decoration around a capability with no visible
    /// control at all. It worked only if you already knew that a hand scanner
    /// pointed at this screen would add to this booking, and it offered nothing
    /// when the counter scanner was unplugged or in use. The camera button is
    /// the same `KioskBarcodeCameraView` fallback the checkout, pickup, and
    /// return flows already carry, so the one custody screen that could not
    /// scan without hardware now can.
    private var scanToAddPanel: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 16) {
                KioskScanTarget(
                    tint: activeMutation == .addingItem ? KioskStatus.active : Color.kioskRedGlyph,
                    width: 96,
                    height: 64
                )

                VStack(alignment: .leading, spacing: 4) {
                    Text("Add Items")
                        .font(KioskType.sectionTitle)
                        .foregroundStyle(KioskText.primary)
                    Text("Scan an item to add it to this checkout.")
                        .font(KioskType.rowDetail)
                        .foregroundStyle(KioskText.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 8)
            }

            HStack(spacing: 12) {
                if activeMutation == .addingItem {
                    Label("Adding scanned item...", systemImage: "arrow.triangle.2.circlepath")
                        .font(KioskType.chip)
                        .foregroundStyle(KioskStatus.active)
                    ProgressView()
                        .tint(KioskText.primary)
                        .controlSize(.small)
                } else {
                    // Same badge the scan screens use, rather than a private
                    // green Label that made "Scanner ready" a third color.
                    KioskScannerReadinessBadge(isReady: shouldListenForItemScans)
                }

                Spacer(minLength: 8)

                Button {
                    showCamera = true
                } label: {
                    Label("Use Camera", systemImage: "camera.fill")
                }
                .font(KioskType.chip)
                .kioskButtonRole(.secondary)
                .controlSize(.regular)
                .disabled(isMutating)
                .accessibilityLabel("Scan with the iPad camera to add an item")
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 16)
        .background(KioskSurface.cardRaised, in: RoundedRectangle(cornerRadius: KioskRadius.lg))
        .overlay(
            RoundedRectangle(cornerRadius: KioskRadius.lg)
                .stroke(
                    shouldListenForItemScans ? KioskStatus.ok.opacity(0.5) : KioskStroke.standard,
                    lineWidth: 1
                )
        )
        .accessibilityElement(children: .contain)
    }

    private var timingRow: some View {
        HStack(spacing: 10) {
            // Custody tone, not brand: blue while simply out, orange on the due
            // day, red once late. The clock glyph used to be brand red here,
            // which made an on-time checkout look like an alert.
            Image(systemName: currentIsOverdue ? "exclamationmark.triangle.fill" : "clock.badge.checkmark")
                .foregroundStyle(custodyTone)
                .accessibilityHidden(true)
            Text(currentIsOverdue ? "Overdue" : "Due")
                .font(KioskType.overline)
                .tracking(0.8)
                .foregroundStyle(custodyTone)
                .textCase(.uppercase)
            Text(currentEndsAt.kioskDueStamp())
                .font(.subheadline.weight(.semibold).monospacedDigit())
                .foregroundStyle(KioskText.primary)
            Text(relativeDue)
                .font(KioskType.chip)
                .foregroundStyle(custodyTone)
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(custodyTone.opacity(0.14), in: Capsule())
            Spacer()
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(KioskSurface.cardRaised, in: RoundedRectangle(cornerRadius: KioskRadius.lg))
        .overlay(
            RoundedRectangle(cornerRadius: KioskRadius.lg)
                .stroke(KioskStroke.standard, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(currentIsOverdue ? "Overdue, due" : "Due") \(currentEndsAt.kioskDueStamp())")
    }

    private var relativeDue: String {
        let rel = Self.relativeFormatter.localizedString(for: currentEndsAt, relativeTo: Date())
        return currentIsOverdue ? "\(rel)" : rel
    }

    private static let relativeFormatter: RelativeDateTimeFormatter = {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter
    }()

    private var minimumEditEndsAt: Date {
        KioskQuarterHour.roundedUp(Date().addingTimeInterval(5 * 60))
    }

    private var clampedEditEndsAt: Binding<Date> {
        Binding(
            get: { max(editEndsAt, minimumEditEndsAt) },
            set: { editEndsAt = KioskQuarterHour.clamped($0, minimum: minimumEditEndsAt) }
        )
    }

    @ViewBuilder
    private func itemRow(_ item: KioskCheckoutDetail.ReturnItem) -> some View {
        HStack(spacing: 12) {
            itemThumbnail(item)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 4) {
                Text(item.itemListPrimaryTitle)
                    .font(.gothamBold(size: 16))
                    .foregroundStyle(KioskText.primary)
                    .lineLimit(1)
                Text(item.itemListSecondaryTitle ?? item.bulkSkuName ?? item.name)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(KioskText.secondary)
                    .lineLimit(1)
            }
            Spacer()
            if canEditActiveCheckout && isRemovable(item) {
                // Icon-only: six of these stacked as full "Remove" pills made
                // the item list read as a row of destructive buttons rather
                // than a custody manifest. The confirmation dialog still names
                // the item, so nothing is lost by dropping the visible label.
                Button {
                    pendingRemoval = item
                } label: {
                    Image(systemName: "trash.fill")
                        .font(.callout)
                }
                .buttonStyle(.plain)
                .foregroundStyle(KioskStatus.problem)
                .frame(width: 40, height: 40)
                .contentShape(Rectangle())
                .disabled(isMutating)
                .accessibilityLabel("Remove \(item.itemListPrimaryTitle)")
            }
            if item.returned {
                Text("Returned")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(Color.statusText(.green))
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(KioskSurface.card, in: RoundedRectangle(cornerRadius: KioskRadius.md))
        .overlay(
            RoundedRectangle(cornerRadius: KioskRadius.md)
                .stroke(KioskStroke.hairline, lineWidth: 1)
        )
    }

    private func isRemovable(_ item: KioskCheckoutDetail.ReturnItem) -> Bool {
        !item.returned && (!item.isBulkDisplay || (item.isNumberedBulk && item.unitNumber != nil))
    }

    @ViewBuilder
    private func itemThumbnail(_ item: KioskCheckoutDetail.ReturnItem) -> some View {
        let fallbackIcon = item.isBulkDisplay ? "battery.100percent" : "camera.fill"
        Group {
            if let urlString = item.imageUrl, let url = URL(string: urlString) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().scaledToFill()
                    default:
                        thumbnailFallback(icon: fallbackIcon)
                    }
                }
            } else {
                thumbnailFallback(icon: fallbackIcon)
            }
        }
        .frame(width: 40, height: 40)
        .clipShape(RoundedRectangle(cornerRadius: KioskRadius.sm))
        .overlay(
            RoundedRectangle(cornerRadius: KioskRadius.sm)
                .stroke(KioskStroke.hairline, lineWidth: 1)
        )
    }

    private func thumbnailFallback(icon: String) -> some View {
        RoundedRectangle(cornerRadius: KioskRadius.sm)
            .fill(KioskSurface.placeholder)
            .overlay {
                Image(systemName: icon)
                    .font(.headline)
                    .foregroundStyle(KioskText.secondary)
            }
    }

    private func load() async {
        isLoading = true
        loadError = nil
        do {
            let loaded = try await KioskAPI.shared.kioskCheckoutDetail(id: context.checkoutId)
            detail = loaded
            editTitle = loaded.title
            editEndsAt = loaded.endsAt
        } catch {
            loadError = (error as? APIError)?.errorDescription ?? "Could not load checkout details."
        }
        isLoading = false
    }

    /// Mirrors the auto-dismissing feedback banner used by the sibling
    /// pickup/return flows — without this the banner used to sit in the
    /// drawer forever after a save/add/remove, stale the next time staff
    /// glanced at it.
    private func showMutationMessage(tone: KioskBannerTone, text: String) {
        let message = KioskMutationMessage(tone: tone, text: text)
        withAnimation { mutationMessage = message }
        Task {
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            if mutationMessage?.text == message.text, mutationMessage?.tone == message.tone {
                withAnimation { mutationMessage = nil }
            }
        }
    }

    private func saveDetails() async {
        guard let actorId else { return }
        let title = editTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else {
            showMutationMessage(tone: .warning, text: "Title is required")
            return
        }
        activeMutation = .savingDetails
        do {
            let result = try await KioskAPI.shared.kioskUpdateActiveCheckout(
                id: context.checkoutId,
                actorId: actorId,
                title: title,
                endsAt: editEndsAt
            )
            showMutationMessage(tone: result.success ? .success : .warning, text: result.message ?? result.error ?? "Checkout updated")
            await load()
            onChanged()
        } catch {
            showMutationMessage(tone: .error, text: (error as? APIError)?.errorDescription ?? "Could not update checkout")
        }
        activeMutation = nil
    }

    private func addItem(scanValue: String) async {
        guard let actorId else { return }
        let value = scanValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return }
        guard activeMutation == nil else { return }
        activeMutation = .addingItem
        do {
            let result = try await KioskAPI.shared.kioskAddActiveCheckoutItem(id: context.checkoutId, actorId: actorId, scanValue: value)
            showMutationMessage(tone: result.success ? .success : .warning, text: result.message ?? result.error ?? "Scan handled")
            if result.success {
                await load()
                onChanged()
            }
        } catch {
            showMutationMessage(tone: .error, text: (error as? APIError)?.errorDescription ?? "Could not add item")
        }
        activeMutation = nil
    }

    private func removeItem(_ item: KioskCheckoutDetail.ReturnItem) async {
        guard let actorId else { return }
        activeMutation = .removingItem
        do {
            let result = try await KioskAPI.shared.kioskRemoveActiveCheckoutItem(id: context.checkoutId, actorId: actorId, item: item)
            showMutationMessage(tone: result.success ? .success : .warning, text: result.message ?? result.error ?? "Remove handled")
            if result.success {
                await load()
                onChanged()
            }
        } catch {
            showMutationMessage(tone: .error, text: (error as? APIError)?.errorDescription ?? "Could not remove item")
        }
        activeMutation = nil
    }

    private func armScannerCapture() {
        guard canEditActiveCheckout else { return }
        scannerCaptureEnabled = false
        DispatchQueue.main.async {
            HIDScannerFocusGate.allowScannerFocusNow()
            scannerCaptureEnabled = true
        }
    }
}

private struct KioskMutationMessage {
    let tone: KioskBannerTone
    let text: String
}
