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
    let custodyScope: String
    let endsAt: Date
    let isOverdue: Bool

    var id: String { checkoutId }

    var isShared: Bool { custodyScope == "SHARED" }

    var requesterInitials: String {
        requesterName.split(separator: " ").prefix(2)
            .compactMap { $0.first }
            .map { String($0) }
            .joined()
            .uppercased()
    }
}

struct KioskCheckoutDetailSheet: View {
    @Environment(\.today) private var today
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
    @State private var pendingBlock: PendingBlockedAdd?
    @State private var mutationMessage: KioskMutationMessage?
    @State private var showCamera = false
    @State private var scanQueue = KioskScanQueue()
    @State private var presentationGeneration = UUID()
    /// H4: the unit being swapped for a like-for-like one.
    @State private var swapItem: KioskCheckoutDetail.ReturnItem?
    /// C5: staff actions, reached from the read-only sheet on home.
    @State private var showStaffFlow = false
    @State private var showExtend = false
    /// Extend from home acts as the holder, so it first asks "Continue as
    /// <holder>?" (the reserved-pickup identity card's trust level). Anyone
    /// else extends through Staff actions.
    @State private var extendHolderConfirmed = false

    private enum ActiveMutation: Equatable {
        case savingDetails
        case addingItem
        case removingItem
    }

    private struct PendingBlockedAdd: Identifiable {
        let title: String
        let message: String
        var id: String { title + message }
    }

    private var isMutating: Bool {
        activeMutation != nil
    }

    private var shouldListenForItemScans: Bool {
        canEditActiveCheckout
            && scannerCaptureEnabled
            && !titleFocused
            && (activeMutation == nil || activeMutation == .addingItem)
            && pendingRemoval == nil
            && pendingBlock == nil
            && !showCamera
            && swapItem == nil
            && !showStaffFlow
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
        KioskStatus.custody(isOverdue: currentIsOverdue, dueAt: currentEndsAt, today: today)
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
                    itemsPanel
                    actionBar
                }
            }
            .padding(28)

            if canEditActiveCheckout {
                HIDScannerField(isEnabled: shouldListenForItemScans) { value in
                    enqueueScan(value)
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
            if !allowsEditing, !showStaffFlow, let onScan {
                HIDScannerField(onScan: onScan).frame(width: 1, height: 1).opacity(0)
            }
        }
        .task {
            await load()
            armScannerCapture()
            #if DEBUG
            if KioskFixtureScenario.active == .changesSwap,
               let first = detail?.items.first(where: { isRemovable($0) && $0.isNumberedBulk }) ?? detail?.items.first(where: isRemovable) {
                swapItem = first
            }
            #endif
        }
        .fullScreenCover(item: $swapItem) { item in
            KioskSwapScreen(
                checkoutId: context.checkoutId,
                item: item,
                contextLine: "On \(context.requesterName)'s checkout · \(currentTitle) · due \(KioskDueCopy.midSentence(currentEndsAt))",
                actorId: actorId ?? "",
                onReportProblem: item.isNumberedBulk ? nil : onReturn.map { startReturn in
                    {
                        swapItem = nil
                        dismiss()
                        startReturn()
                    }
                },
                onCancel: { swapItem = nil },
                onSwapped: { message in
                    swapItem = nil
                    showMutationMessage(tone: .success, text: message)
                    Task { await load() }
                    onChanged()
                }
            )
            .statusBarHidden(true)
        }
        .fullScreenCover(isPresented: $showExtend) {
            // Extends as the holder, the same as Extend on their own page.
            if let holderId = context.requesterId ?? detail?.requesterId, !extendHolderConfirmed {
                KioskExtendHolderConfirm(
                    holderName: context.requesterName,
                    avatarURL: context.requesterAvatarUrl,
                    initials: context.requesterInitials,
                    checkoutTitle: currentTitle,
                    onConfirm: { extendHolderConfirmed = true },
                    onCancel: { showExtend = false }
                )
                .id(holderId)
                .statusBarHidden(true)
            } else if let holderId = context.requesterId ?? detail?.requesterId {
                KioskExtendScreen(
                    checkoutId: context.checkoutId,
                    title: currentTitle,
                    detailLine: context.requesterName,
                    actorId: holderId,
                    onCancel: { showExtend = false },
                    onExtended: {
                        showExtend = false
                        Task { await load() }
                        onChanged()
                    }
                )
            }
        }
        .onChange(of: showExtend) { _, isShowing in
            if !isShowing { extendHolderConfirmed = false }
        }
        .fullScreenCover(isPresented: $showStaffFlow) {
            KioskStaffActionsFlow(context: context) { changed in
                showStaffFlow = false
                if changed {
                    Task { await load() }
                    onChanged()
                }
            }
            .statusBarHidden(true)
        }
        .onDisappear {
            presentationGeneration = UUID()
            scanQueue.reset()
            scannerCaptureEnabled = false
        }
        .interactiveDismissDisabled(isMutating || !scanQueue.isEmpty)
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
                onScan: { value in enqueueScan(value) },
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
        .confirmationDialog(
            pendingBlock?.title ?? "Can't add this item",
            isPresented: Binding(
                get: { pendingBlock != nil },
                set: {
                    if !$0 {
                        pendingBlock = nil
                        processNextScanIfNeeded()
                    }
                }
            ),
            titleVisibility: .visible,
            presenting: pendingBlock
        ) { _ in
            Button("OK", role: .cancel) {
                pendingBlock = nil
                processNextScanIfNeeded()
            }
        } message: { blocked in
            Text(blocked.message)
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
                    let items = detail?.items ?? []
                    if canEditActiveCheckout {
                        // Editing: one row per unit so Swap/Remove act on it.
                        LazyVStack(spacing: 8) {
                            ForEach(items) { item in itemRow(item) }
                        }
                    } else {
                        // Reading: uniform tiles, photo over tag; numbered
                        // batteries share one tile with their unit chips.
                        let grouped = items.filter { $0.isNumberedBulk && $0.bulkSkuId != nil }
                        let singles = items.filter { item in !grouped.contains { $0.id == item.id } }
                        // Cameras, Lenses, Batteries, Audio, Other: only the
                        // sections with items. Numbered batteries share a chip.
                        let buckets = categoryGroups(singles)
                        let batteries = batteryGroups(grouped)
                        VStack(alignment: .leading, spacing: 12) {
                            ForEach(["Cameras", "Lenses", "Batteries", "Audio", "Other"], id: \.self) { name in
                                let loose = buckets.first { $0.name == name }?.items ?? []
                                let packs = name == "Batteries" ? batteries : []
                                if !loose.isEmpty || !packs.isEmpty {
                                    VStack(alignment: .leading, spacing: 6) {
                                        Text(name.uppercased())
                                            .font(KioskType.overline)
                                            .tracking(KioskType.overlineTracking)
                                            .foregroundStyle(KioskText.tertiary)
                                        if !loose.isEmpty {
                                            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 8)], alignment: .leading, spacing: 8) {
                                                ForEach(loose) { item in itemTile(item) }
                                            }
                                        }
                                        ForEach(packs, id: \.id) { group in batteryTile(group.items) }
                                    }
                                }
                            }
                        }
                    }
                }
                .scrollIndicators(.visible)
            }
        }
        .frame(maxHeight: .infinity, alignment: .top)
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 14) {
            KioskAvatar(url: context.requesterAvatarUrl, initials: context.requesterInitials, size: 48)
            VStack(alignment: .leading, spacing: 3) {
                Text(currentTitle)
                    .font(.title2.weight(.heavy))
                    .foregroundStyle(KioskText.primary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                // Who and when on one line; the due part carries custody tone.
                (Text(context.requesterName + " · ").foregroundStyle(KioskText.secondary)
                 + Text("\(currentIsOverdue ? "Overdue since" : "Due") \(currentEndsAt.kioskDueStamp()) · \(relativeDue)").foregroundStyle(custodyTone))
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)
            }
            Spacer(minLength: 8)
            if allowsEditing {
                Button("Done") { dismiss() }
                    .font(.headline.weight(.semibold))
                    .kioskButtonRole(.secondary)
                    .controlSize(.large)
                    .disabled(isMutating || !scanQueue.isEmpty)
            } else {
                Button { dismiss() } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 17, weight: .bold))
                        .frame(width: 44, height: 44)
                        .background(KioskSurface.cardRaised, in: Circle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(KioskText.secondary)
                .accessibilityLabel("Close")
                .disabled(isMutating || !scanQueue.isEmpty)
            }
        }
    }

    /// Read mode's actions, at the bottom where a thumb lands.
    @ViewBuilder
    private var actionBar: some View {
        HStack(spacing: 10) {
            if let onReturn {
                Button {
                    dismiss()
                    onReturn()
                } label: {
                    Text("Return gear").font(.headline.weight(.semibold)).frame(maxWidth: .infinity, minHeight: 50)
                }
                .kioskButtonRole(.primary)
                .disabled(isMutating || !scanQueue.isEmpty)
            }
            if detail?.status == "OPEN", context.custodyScope != "SHARED", (context.requesterId ?? detail?.requesterId) != nil {
                Button { showExtend = true } label: {
                    Label("Extend", systemImage: "clock.arrow.circlepath")
                        .font(.headline.weight(.semibold)).lineLimit(1).fixedSize()
                        .padding(.horizontal, 16).frame(minHeight: 50)
                }
                .kioskButtonRole(.secondary)
            }
            if detail?.status == "OPEN" {
                // C5: staff actions open behind a staff ID card scan.
                Button { showStaffFlow = true } label: {
                    Label("Staff actions", systemImage: "lock.fill")
                        .font(.headline.weight(.semibold)).lineLimit(1).fixedSize()
                        .padding(.horizontal, 16).frame(minHeight: 50)
                }
                .kioskButtonRole(.secondary)
            }
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
            .tint(KioskText.primary)
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
                    tint: activeMutation == .addingItem ? KioskStatus.active : KioskText.primary,
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
                    Label("Saving \(scanQueue.count) scan\(scanQueue.count == 1 ? "" : "s")…", systemImage: "arrow.triangle.2.circlepath")
                        .font(KioskType.chip)
                        .foregroundStyle(KioskStatus.active)
                    ProgressView()
                        .tint(KioskText.primary)
                        .controlSize(.small)
                } else {
                    // Same badge the scan screens use, rather than a private
                    // green Label that made "Scanner ready" a third color.
                    // Pass hardware state too: without it the badge claimed
                    // "Scanner ready" in green while the shell pill beside it
                    // said "No scanner connected".
                    KioskScannerReadinessBadge(
                        isReady: shouldListenForItemScans,
                        lastScanAt: store.scanner.lastScanAt,
                        isHardwareConnected: store.scanner.hardwareConnected
                    )
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
                    shouldListenForItemScans && store.scanner.hardwareConnected
                        ? KioskStatus.ok.opacity(0.5) : KioskStroke.standard,
                    lineWidth: 1
                )
        )
        .accessibilityElement(children: .contain)
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

            // Asset tag only; a numbered battery reads "Sony Battery #7"
            // rather than "#7" over "Sony Battery #7".
            Text(item.isNumberedBulk ? (item.itemListSecondaryTitle ?? item.itemListPrimaryTitle) : item.itemListPrimaryTitle)
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(KioskText.primary)
                .lineLimit(1)
                .minimumScaleFactor(0.9)
                .accessibilityLabel(item.itemListSecondaryTitle ?? item.name)
            Spacer()
            if canEditActiveCheckout && isRemovable(item) {
                Button("Swap") { swapItem = item }
                    .font(KioskType.chip)
                    .kioskButtonRole(.quiet)
                    .disabled(isMutating)
                    .accessibilityLabel("Swap \(item.itemListPrimaryTitle)")
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
                    .font(KioskType.chipStrong)
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

    /// Fixed buckets, in this order, shown only when they have items:
    /// Cameras, Lenses, Audio, Other (batteries are their own section).
    private func categoryGroups(_ items: [KioskCheckoutDetail.ReturnItem]) -> [(name: String, items: [KioskCheckoutDetail.ReturnItem])] {
        let order = ["Cameras", "Lenses", "Batteries", "Audio", "Other"]
        var byName: [String: [KioskCheckoutDetail.ReturnItem]] = [:]
        for item in items { byName[Self.bucket(item), default: []].append(item) }
        return order.compactMap { name in byName[name].map { (name, $0) } }
    }

    static func bucket(_ item: KioskCheckoutDetail.ReturnItem) -> String {
        let text = [item.category, item.bulkSkuName, item.name, item.tagName].compactMap { $0 }.joined(separator: " ").lowercased()
        func has(_ words: [String]) -> Bool { words.contains { text.contains($0) } }
        if item.isNumberedBulk || has(["battery", "batteries", "v-mount", "np-f"]) { return "Batteries" }
        if has(["audio", "mic", "microphone", "lav", "recorder", "sennheiser", "rode", "zoom h", "wireless go", "boom"]) { return "Audio" }
        if has(["lens", "mm f/", "mm f", "16-35", "17-28", "24-70", "70-200", "100-400", "prime"]) { return "Lenses" }
        if has(["camera", "body", "fx3", "fx6", "fx30", "a7", "a1 ", "canon r", "eos", "cinema"]) { return "Cameras" }
        return "Other"
    }

    private func batteryGroups(_ items: [KioskCheckoutDetail.ReturnItem]) -> [(id: String, items: [KioskCheckoutDetail.ReturnItem])] {
        var order: [String] = []
        var byKind: [String: [KioskCheckoutDetail.ReturnItem]] = [:]
        for item in items {
            let key = item.bulkSkuId ?? item.name
            if byKind[key] == nil { order.append(key) }
            byKind[key, default: []].append(item)
        }
        return order.map { ($0, (byKind[$0] ?? []).sorted { ($0.unitNumber ?? 0) < ($1.unitNumber ?? 0) }) }
    }

    /// Compact chip: small photo + asset tag. The sheet is a quick overview.
    private func itemTile(_ item: KioskCheckoutDetail.ReturnItem) -> some View {
        chipShell {
            itemThumbnail(item, size: 28)
            Text(item.isNumberedBulk ? (item.itemListSecondaryTitle ?? item.itemListPrimaryTitle) : item.itemListPrimaryTitle)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(item.returned ? KioskText.tertiary : KioskText.primary)
                .strikethrough(item.returned)
                .lineLimit(1)
        }
        .accessibilityLabel(item.itemListSecondaryTitle ?? item.name)
    }

    /// One chip per battery kind: "Sony Battery #7 #20".
    private func batteryTile(_ units: [KioskCheckoutDetail.ReturnItem]) -> some View {
        let first = units[0]
        let name = first.bulkSkuName ?? first.name
        return chipShell(fits: true) {
            itemThumbnail(first, size: 28)
            Text(name)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(KioskText.primary)
                .lineLimit(1)
            HStack(spacing: 4) {
                ForEach(units) { unit in
                    KioskBatteryUnitChip(label: unit.unitNumber.map(String.init) ?? unit.tagName, isScanned: unit.returned, size: 26)
                }
            }
        }
        .accessibilityLabel("\(name), units \(units.compactMap { $0.unitNumber.map(String.init) }.joined(separator: ", "))")
    }

    private func chipShell<Content: View>(fits: Bool = false, @ViewBuilder _ content: () -> Content) -> some View {
        HStack(spacing: 8) { content() }
            .padding(.leading, 5)
            .padding(.trailing, 12)
            .padding(.vertical, 5)
            .fixedSize(horizontal: fits, vertical: false)
            .frame(maxWidth: fits ? nil : .infinity, alignment: .leading)
            .background(KioskSurface.card, in: RoundedRectangle(cornerRadius: KioskRadius.sm))
            .overlay(RoundedRectangle(cornerRadius: KioskRadius.sm).stroke(KioskStroke.hairline, lineWidth: 1))
            .accessibilityElement(children: .ignore)
    }

    private func isRemovable(_ item: KioskCheckoutDetail.ReturnItem) -> Bool {
        !item.returned && (!item.isBulkDisplay || (item.isNumberedBulk && item.unitNumber != nil))
    }

    @ViewBuilder
    private func itemThumbnail(_ item: KioskCheckoutDetail.ReturnItem, size: CGFloat = 40) -> some View {
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
        .frame(width: size, height: size)
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

    private func presentBlockedAdd(title: String, message: String) {
        mutationMessage = nil
        pendingBlock = PendingBlockedAdd(title: title, message: message)
        Haptics.error()
        KioskScanFeedbackSound.playFailure()
        UIAccessibility.post(notification: .announcement, argument: message)
    }

    private func saveDetails() async {
        guard activeMutation == nil, scanQueue.isEmpty else { return }
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
                endsAt: editEndsAt == detail?.endsAt ? nil : editEndsAt
            )
            if result.success {
                showMutationMessage(tone: .success, text: result.message ?? "Checkout updated")
                await load()
                onChanged()
            } else {
                presentBlockedAdd(
                    title: "Can't update this checkout",
                    message: result.error ?? result.message ?? "This checkout could not be updated."
                )
            }
        } catch {
            presentBlockedAdd(
                title: "Can't update this checkout",
                message: (error as? APIError)?.errorDescription ?? "Could not update checkout"
            )
        }
        activeMutation = nil
    }

    private func enqueueScan(_ value: String) {
        // A scanner produces no touches, so scan-only work in this sheet never
        // reached the shell's activity monitor and timed out mid-session.
        store.resetInactivity()
        guard scanQueue.enqueue(value) else {
            showMutationMessage(tone: .warning, text: "Already waiting for that scan")
            KioskScanFeedbackSound.playFailure()
            return
        }
        processNextScanIfNeeded()
    }

    private func processNextScanIfNeeded() {
        guard activeMutation == nil, pendingBlock == nil, let entry = scanQueue.next() else { return }
        let generation = presentationGeneration
        Task {
            await addItem(scanValue: entry.value)
            guard presentationGeneration == generation else { return }
            scanQueue.finish(entry)
            processNextScanIfNeeded()
        }
    }

    private func addItem(scanValue: String) async {
        guard let actorId else { return }
        let value = scanValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return }
        guard activeMutation == nil else { return }
        let generation = presentationGeneration
        activeMutation = .addingItem
        do {
            let result = try await KioskAPI.shared.kioskAddActiveCheckoutItem(id: context.checkoutId, actorId: actorId, scanValue: value)
            guard presentationGeneration == generation else { return }
            if result.success {
                showMutationMessage(tone: .success, text: result.message ?? "Scan handled")
                await load()
                onChanged()
            } else {
                presentBlockedAdd(
                    title: "Can't add this item",
                    message: result.error ?? result.message ?? "This item cannot be added to this checkout."
                )
            }
        } catch {
            presentBlockedAdd(
                title: "Can't add this item",
                message: (error as? APIError)?.errorDescription ?? "Could not add item"
            )
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


/// Extend from the home booking sheet: confirm the person at the kiosk is the
/// holder before extending as them. Same trust as tapping your own name on
/// home; anyone else is pointed at Staff actions.
struct KioskExtendHolderConfirm: View {
    let holderName: String
    let avatarURL: String?
    let initials: String
    let checkoutTitle: String
    let onConfirm: () -> Void
    let onCancel: () -> Void

    private var firstName: String {
        holderName.split(separator: " ").first.map(String.init) ?? holderName
    }

    var body: some View {
        VStack(spacing: 0) {
            KioskTaskHeader(
                title: "Extend",
                subtitle: checkoutTitle,
                backTitle: "Cancel",
                backAccessibilityLabel: "Cancel extend",
                onBack: onCancel
            )
            VStack(alignment: .leading, spacing: 18) {
                Text("This is \(firstName)\u{2019}s checkout")
                    .font(KioskType.screenTitle)
                    .foregroundStyle(KioskText.primary)
                Button(action: onConfirm) {
                    HStack(spacing: 14) {
                        KioskAvatar(url: avatarURL, initials: initials, size: 48)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(holderName)
                                .font(.system(size: 19, weight: .bold))
                                .foregroundStyle(KioskText.primary)
                                .lineLimit(1)
                            Text("Continue as \(firstName)")
                                .font(KioskType.chip)
                                .foregroundStyle(KioskText.secondary)
                                .lineLimit(1)
                        }
                        Spacer(minLength: 0)
                        Image(systemName: "chevron.right")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(KioskText.muted)
                    }
                    .padding(.horizontal, 16)
                    .frame(height: 76)
                    .kioskCard(KioskSurface.cardRaised, radius: 16, stroke: KioskStroke.standard)
                }
                .buttonStyle(KioskPressStyle())
                .accessibilityLabel("\(holderName), continue as \(firstName)")
                Text("Not \(firstName)? Only \(firstName) can extend from here. Staff can extend it from Staff actions.")
                    .font(KioskType.meta)
                    .foregroundStyle(KioskText.tertiary)
                Spacer(minLength: 0)
            }
            .frame(maxWidth: 560, alignment: .leading)
            .padding(.horizontal, KioskSpacing.xl)
            .padding(.top, KioskSpacing.lg)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
        .background(KioskSurface.base.ignoresSafeArea())
    }
}
