import SwiftUI
import UIKit

/// Where the return's "Something damaged or missing?" page is.
enum KioskReturnReportStep: Equatable {
    /// G3: pick the item, then what happened to it.
    case choose(selectedId: String?)
    /// G4: scan it back if it isn't yet, then describe it and take a photo.
    case damaged(itemId: String)
    /// G5: mark it missing and tell staff. The item was not scanned back.
    case missing(itemId: String)
}

/// Damaged or missing, reported from the return screen (redesign G3–G5).
///
/// Posts to `/api/kiosk/checkin/{id}/report`. Covers all gear: serialized
/// items, each numbered battery unit, and counted stock by quantity. A damaged
/// item still counts as returned and is flagged for staff; a missing item is
/// accounted for (the same as web's LOST report), so the return can finish
/// without it.
struct KioskReturnReportView: View {
    @Environment(KioskStore.self) private var store
    let bookingId: String
    let actorId: String
    /// C5: the staff card proof, when Staff actions opened this report.
    var staffToken: String? = nil
    let checkoutTitle: String?
    let ownerSubtitle: String
    let avatarURL: String?
    let avatarInitials: String?
    /// Everything on the return: serialized items, battery units, counted stock.
    let items: [KioskCheckoutDetail.ReturnItem]
    let returnedIds: Set<String>
    /// Scanned back on this page. Kept here too, so the page moves past
    /// "scan it first" even when the caller doesn't track returns (Staff
    /// actions passes a fixed set).
    @State private var scannedHereIds: Set<String> = []
    private func isReturned(_ id: String) -> Bool { returnedIds.contains(id) || scannedHereIds.contains(id) }
    /// Already reported missing: can't be reported again.
    var missingIds: Set<String> = []
    @Binding var step: KioskReturnReportStep?
    /// A scan on the damaged page returned this item (it counts as returned).
    var onReturned: (KioskScanResult.ScannedItem) -> Void = { _ in }
    let onReported: (KioskCheckinReportResult, KioskCheckoutDetail.ReturnItem) -> Void

    @State private var note = ""
    @State private var photo: UIImage?
    @State private var showCamera = false
    @State private var isSubmitting = false
    /// The operation reference for the submit in progress, kept across
    /// retries of the same details so a resend replays rather than counting
    /// twice. New details or a success start a new one.
    @State private var pendingReport: (details: String, requestId: String)?
    @State private var errorMessage: String?
    /// Counted stock: how many are damaged or missing.
    @State private var quantity = 1
    /// Damaged page, before the item is back: the inline scan.
    @State private var isScanning = false
    @State private var scanMessage: String?
    @State private var showScanCamera = false

    private var cameraAvailable: Bool { UIImagePickerController.isSourceTypeAvailable(.camera) }

    var body: some View {
        switch step {
        case .damaged(let id):
            if let item = items.first(where: { $0.id == id }) { damagedPage(item) }
        case .missing(let id):
            if let item = items.first(where: { $0.id == id }) { missingPage(item) }
        default:
            chooserPage
        }
    }

    // MARK: - G3 chooser

    private var selectedItem: KioskCheckoutDetail.ReturnItem? {
        if case .choose(let id?) = step { return items.first { $0.id == id } }
        return nil
    }

    private var chooserPage: some View {
        KioskTaskScaffold(header: KioskTaskHeader(
            title: "Report a problem",
            subtitle: ownerSubtitle,
            avatarURL: avatarURL,
            avatarInitials: avatarInitials,
            onBack: { step = nil }
        )) {
            VStack(alignment: .leading, spacing: 14) {
                if let item = selectedItem {
                    Text("What happened to \(KioskReturnReportCopy.label(item))?")
                        .font(KioskType.heroAction)
                        .foregroundStyle(KioskText.primary)
                    HStack(spacing: 12) {
                        let isBack = isReturned(item.id)
                        let isMissing = missingIds.contains(item.id)
                        choiceCard(
                            dot: KioskSection.comingBack.accent,
                            title: "It's damaged",
                            detail: KioskReturnReportCopy.damagedChoiceDetail(item, isBack: isBack, isMissing: isMissing),
                            enabled: !isMissing
                        ) { resetDraft(); step = .damaged(itemId: item.id) }
                        choiceCard(
                            dot: KioskSection.problem.accent,
                            title: "It's missing",
                            detail: isMissing
                                ? "Already marked missing. Staff have been told."
                                : isBack
                                    ? "It was scanned back, so it isn't missing."
                                    : "You can't find it. We'll mark it and let staff know.",
                            enabled: !isBack && !isMissing
                        ) { resetDraft(); step = .missing(itemId: item.id) }
                    }
                } else {
                    Text("Which item?")
                        .font(KioskType.heroAction)
                        .foregroundStyle(KioskText.primary)
                    Text("Tap the item on the right. Everything else returns as normal.")
                        .font(KioskType.body)
                        .foregroundStyle(KioskText.secondary)
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .topLeading)
        } panel: {
            overline("Coming back")
            ScrollView {
                VStack(spacing: 10) {
                    ForEach(items) { item in
                        itemButton(item, isSelected: selectedItem?.id == item.id)
                    }
                }
            }
            .scrollIndicators(.hidden)
        }
    }

    private func itemButton(_ item: KioskCheckoutDetail.ReturnItem, isSelected: Bool) -> some View {
        Button {
            store.resetInactivity()
            step = .choose(selectedId: item.id)
        } label: {
            HStack(spacing: 12) {
                itemPhoto(item, size: 40)
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.isNumberedBulk ? (item.bulkSkuName ?? item.name) : item.itemListPrimaryTitle)
                        .font(KioskType.rowTitle)
                        .foregroundStyle(KioskText.primary)
                        .lineLimit(1)
                    if let secondary = rowSecondary(item) {
                        Text(secondary)
                            .font(KioskType.meta)
                            .foregroundStyle(KioskText.tertiary)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 8)
                if missingIds.contains(item.id) {
                    Text("Missing")
                        .font(KioskType.meta)
                        .foregroundStyle(KioskSection.problem.text)
                } else if isReturned(item.id) {
                    Text("Back")
                        .font(KioskType.meta)
                        .foregroundStyle(KioskSection.comingBack.text)
                }
            }
            .padding(.horizontal, 16)
            .frame(maxWidth: .infinity, minHeight: 60, alignment: .leading)
            .background(isSelected ? KioskSurface.cardSelected : KioskSurface.cardRaised,
                        in: RoundedRectangle(cornerRadius: KioskRadius.lg))
            .overlay(RoundedRectangle(cornerRadius: KioskRadius.lg)
                .stroke(isSelected ? KioskStroke.selected : KioskStroke.standard, lineWidth: 1))
            .contentShape(RoundedRectangle(cornerRadius: KioskRadius.lg))
        }
        .buttonStyle(KioskPressStyle())
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private func rowSecondary(_ item: KioskCheckoutDetail.ReturnItem) -> String? {
        if item.isCountedStock { return "\(item.quantity ?? 0) still out" }
        if item.isNumberedBulk { return nil }
        return item.itemListSecondaryTitle
    }

    /// The item's photo; a battery unit also shows its number circle.
    @ViewBuilder
    private func itemPhoto(_ item: KioskCheckoutDetail.ReturnItem, size: CGFloat) -> some View {
        if item.isNumberedBulk {
            HStack(spacing: size > 60 ? 12 : 8) {
                KioskItemThumbnail(imageUrl: item.imageUrl, size: size)
                KioskBatteryUnitChip(
                    label: item.unitNumber.map { "#\($0)" } ?? item.tagName,
                    isScanned: isReturned(item.id),
                    section: .comingBack,
                    size: size > 60 ? 44 : 32
                )
            }
        } else {
            KioskItemThumbnail(imageUrl: item.imageUrl, size: size)
        }
    }

    private func choiceCard(dot: Color, title: String, detail: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 6) {
                Circle().fill(dot).frame(width: 12, height: 12)
                Text(title)
                    .font(KioskType.heroAction)
                    .foregroundStyle(enabled ? KioskText.primary : KioskText.muted)
                Text(detail)
                    .font(.system(size: 15))
                    .foregroundStyle(KioskText.secondary)
                    .lineSpacing(4)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(24)
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .kioskCard(radius: 20, stroke: KioskStroke.standard)
            .contentShape(RoundedRectangle(cornerRadius: 20))
        }
        .buttonStyle(KioskPressStyle())
        .disabled(!enabled)
    }

    /// Big photo and tag at the top of the damaged and missing cards.
    private func itemHero(_ item: KioskCheckoutDetail.ReturnItem) -> some View {
        HStack(spacing: 16) {
            itemPhoto(item, size: 96)
            VStack(alignment: .leading, spacing: 4) {
                Text(item.isNumberedBulk ? (item.bulkSkuName ?? item.name) : item.itemListPrimaryTitle)
                    .font(.system(size: 24, weight: .heavy))
                    .foregroundStyle(KioskText.primary)
                    .lineLimit(2)
                if let secondary = rowSecondary(item) {
                    Text(secondary)
                        .font(KioskType.body)
                        .foregroundStyle(KioskText.secondary)
                        .lineLimit(2)
                }
            }
            Spacer(minLength: 0)
        }
    }

    /// Counted stock: how many. Bounded by what is still out.
    @ViewBuilder
    private func quantityStepper(_ item: KioskCheckoutDetail.ReturnItem, verb: String) -> some View {
        if item.isCountedStock {
            let maxQuantity = max(1, item.quantity ?? 1)
            Stepper(value: $quantity, in: 1...maxQuantity) {
                Text("\(quantity) of \(maxQuantity) \(verb)")
                    .font(.system(size: 20, weight: .bold).monospacedDigit())
                    .foregroundStyle(KioskText.primary)
            }
            .onChange(of: quantity) { _, _ in store.resetInactivity() }
            .accessibilityLabel("\(quantity) \(verb)")
        }
    }

    // MARK: - G4 damaged

    /// Serialized items and battery units are scanned back first, right here,
    /// so "It's damaged" never dead-ends. Counted stock has no per-piece QR:
    /// the damaged quantity counts as returned when the report is sent.
    private func needsScan(_ item: KioskCheckoutDetail.ReturnItem) -> Bool {
        !item.isCountedStock && !isReturned(item.id)
    }

    private func damagedPage(_ item: KioskCheckoutDetail.ReturnItem) -> some View {
        let awaitingScan = needsScan(item)
        return KioskTaskScaffold(header: KioskTaskHeader(
            title: "\(KioskReturnReportCopy.label(item)) is damaged",
            subtitle: [item.isNumberedBulk ? nil : item.itemListSecondaryTitle, checkoutTitle].compactMap { $0 }.joined(separator: " · "),
            onBack: { step = .choose(selectedId: item.id) }
        )) {
            VStack(alignment: .leading, spacing: 16) {
                itemHero(item)
                quantityStepper(item, verb: "damaged")
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
            .kioskCard(radius: KioskRadius.hero, stroke: KioskStroke.standard)
            if awaitingScan {
                scanPrompt(item)
            } else {
                photoArea
            }
            if let errorMessage { errorLine(errorMessage) }
            KioskPrimaryPill(
                title: "Report and return it",
                isEnabled: !awaitingScan && (!note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || photo != nil),
                isBusy: isSubmitting
            ) { submit(item, type: "DAMAGED") }
        } panel: {
            overline("What's wrong?")
            if awaitingScan {
                Text("Scan it back first. Then describe the damage here.")
                    .font(KioskType.body)
                    .foregroundStyle(KioskText.tertiary)
            } else {
                noteField(placeholder: "Describe the damage")
            }
            Text("It still counts as returned. Staff check it before anyone can check it out again.")
                .font(KioskType.meta)
                .foregroundStyle(KioskText.tertiary)
                .lineSpacing(4)
        }
        .sheet(isPresented: $showCamera) {
            KioskPhotoCapture { image in
                photo = image
                showCamera = false
            } onCancel: { showCamera = false }
                .ignoresSafeArea()
        }
    }

    /// The inline scan on the damaged page: the hidden HID field plus the
    /// iPad camera. A matching scan returns the item through the same
    /// check-in scan the return screen uses.
    private func scanPrompt(_ item: KioskCheckoutDetail.ReturnItem) -> some View {
        VStack(spacing: 14) {
            Image(systemName: "barcode.viewfinder")
                .font(.system(size: 44, weight: .regular))
                .foregroundStyle(KioskText.secondary)
                .accessibilityHidden(true)
            Text("Scan \(KioskReturnReportCopy.label(item)) to return it, then describe the damage")
                .font(.system(size: 24, weight: .bold))
                .foregroundStyle(KioskText.primary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            if isScanning {
                ProgressView().tint(KioskText.primary)
            } else if let scanMessage {
                Text(scanMessage)
                    .font(KioskType.meta.weight(.semibold))
                    .foregroundStyle(KioskSection.problem.text)
            }
            Button("Use the iPad camera") { store.resetInactivity(); showScanCamera = true }
                .font(.system(size: 16, weight: .bold))
                .frame(minHeight: 52)
                .kioskButtonRole(.secondary)
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(KioskSurface.card, in: RoundedRectangle(cornerRadius: KioskRadius.hero))
        .overlay(RoundedRectangle(cornerRadius: KioskRadius.hero)
            .strokeBorder(KioskStroke.pending, style: StrokeStyle(lineWidth: 1, dash: [6, 5])))
        .overlay(alignment: .bottom) {
            HIDScannerField(onScan: { store.scanner.receive($0) }, onFocusChange: nil)
                .frame(width: 1, height: 1)
                .opacity(0)
        }
        .task(id: item.id) {
            store.scanner.claim(.returnReport) { value in handleDamageScan(value, item: item) }
        }
        .onDisappear { store.scanner.release(.returnReport) }
        .sheet(isPresented: $showScanCamera) {
            KioskBarcodeCameraView(
                feedbackMessage: scanMessage,
                feedbackTone: scanMessage == nil ? nil : .error,
                onScan: { value in handleDamageScan(value, item: item) },
                onCancel: { showScanCamera = false }
            )
        }
    }

    private func handleDamageScan(_ value: String, item: KioskCheckoutDetail.ReturnItem) {
        guard !isScanning else { return }
        store.resetInactivity()
        isScanning = true
        scanMessage = nil
        let flow = store.flowGeneration
        Task {
            defer { if store.ownsFlow(flow) { isScanning = false } }
            do {
                let result = try await KioskAPI.shared.kioskCheckinScan(bookingId: bookingId, actorId: actorId, scanValue: value)
                guard store.ownsFlow(flow) else { return }
                guard result.success, let scanned = result.item else {
                    Haptics.error()
                    scanMessage = result.error ?? "That's not \(KioskReturnReportCopy.label(item))."
                    return
                }
                // Another item on this checkout still came back: say so.
                scannedHereIds.insert(scanned.id)
                onReturned(scanned)
                if scanned.id == item.id {
                    Haptics.success()
                    showScanCamera = false
                } else {
                    Haptics.error()
                    scanMessage = "That's not \(KioskReturnReportCopy.label(item)). \(scanned.itemListPrimaryTitle) was returned."
                }
            } catch {
                guard store.ownsFlow(flow) else { return }
                Haptics.error()
                scanMessage = (error as? APIError)?.errorDescription ?? "That scan didn't go through. Try again."
            }
        }
    }

    @ViewBuilder
    private var photoArea: some View {
        VStack(spacing: 14) {
            if let photo {
                Image(uiImage: photo)
                    .resizable()
                    .scaledToFit()
                    .clipShape(RoundedRectangle(cornerRadius: KioskRadius.xl))
                    .frame(maxHeight: 300)
                    .accessibilityLabel("Photo of the damage")
                Button("Retake") { showCamera = true }
                    .kioskButtonRole(.secondary)
            } else {
                Image(systemName: "camera")
                    .font(.system(size: 44, weight: .regular))
                    .foregroundStyle(KioskText.secondary)
                    .accessibilityHidden(true)
                Text(cameraAvailable ? "Take a photo of the damage" : "No camera here. Describe it instead.")
                    .font(.system(size: 24, weight: .bold))
                    .foregroundStyle(KioskText.primary)
                if cameraAvailable {
                    Button("Open camera") { store.resetInactivity(); showCamera = true }
                        .font(.system(size: 16, weight: .bold))
                        .frame(minHeight: 52)
                        .kioskButtonRole(.primary)
                }
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(KioskSurface.card, in: RoundedRectangle(cornerRadius: KioskRadius.hero))
        .overlay(RoundedRectangle(cornerRadius: KioskRadius.hero)
            .strokeBorder(KioskStroke.pending, style: StrokeStyle(lineWidth: 1, dash: photo == nil ? [6, 5] : [])))
    }

    // MARK: - G5 missing

    private func missingPage(_ item: KioskCheckoutDetail.ReturnItem) -> some View {
        KioskTaskScaffold(header: KioskTaskHeader(
            title: "\(KioskReturnReportCopy.label(item)) is missing",
            subtitle: [item.isNumberedBulk ? nil : item.itemListSecondaryTitle, checkoutTitle].compactMap { $0 }.joined(separator: " · "),
            onBack: { step = .choose(selectedId: item.id) }
        )) {
            VStack(alignment: .leading, spacing: 16) {
                itemHero(item)
                quantityStepper(item, verb: "missing")
                Text(item.isCountedStock
                     ? "We'll mark \(quantity) \(item.bulkSkuName ?? item.name) missing and tell staff."
                     : "We'll mark \(KioskReturnReportCopy.label(item)) missing and tell staff.")
                    .font(.system(size: 28, weight: .heavy))
                    .foregroundStyle(KioskText.primary)
                    .fixedSize(horizontal: false, vertical: true)
                Text(KioskReturnReportCopy.missingExplainer)
                    .font(KioskType.body)
                    .foregroundStyle(KioskText.secondary)
                    .lineSpacing(5)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(28)
            .frame(maxWidth: .infinity, alignment: .leading)
            .kioskCard(KioskSection.problem.stageFill, radius: KioskRadius.hero, stroke: KioskSection.problem.stageStroke)
            if let errorMessage { errorLine(errorMessage) }
            KioskPrimaryPill(title: "Mark missing", isBusy: isSubmitting) { submit(item, type: "LOST") }
            Spacer(minLength: 0)
        } panel: {
            overline("Anything that helps find it? (optional)")
            noteField(placeholder: "Where it might be")
        }
    }

    // MARK: - Shared pieces

    private func overline(_ text: String) -> some View {
        Text(text.uppercased())
            .font(KioskType.overline)
            .tracking(KioskType.overlineTracking)
            .foregroundStyle(KioskText.tertiary)
            .padding(.horizontal, 2)
    }

    private func noteField(placeholder: String) -> some View {
        TextField(placeholder, text: $note, axis: .vertical)
            .font(.system(size: 17, weight: .medium))
            .foregroundStyle(KioskText.primary)
            .lineLimit(6, reservesSpace: true)
            .padding(16)
            .background(KioskSurface.cardRaised, in: RoundedRectangle(cornerRadius: KioskRadius.xl))
            .overlay(RoundedRectangle(cornerRadius: KioskRadius.xl).stroke(KioskStroke.standard, lineWidth: 1))
            .onChange(of: note) { _, value in
                store.resetInactivity()
                if value.count > 1000 { note = String(value.prefix(1000)) }
            }
    }

    private func errorLine(_ message: String) -> some View {
        Text(message)
            .font(KioskType.meta.weight(.semibold))
            .foregroundStyle(KioskSection.problem.text)
            .frame(maxWidth: .infinity)
    }

    private func resetDraft() {
        note = ""
        photo = nil
        errorMessage = nil
        scanMessage = nil
        quantity = 1
        pendingReport = nil
    }

    private func submit(_ item: KioskCheckoutDetail.ReturnItem, type: String) {
        guard !isSubmitting else { return }
        store.resetInactivity()
        isSubmitting = true
        errorMessage = nil
        let flow = store.flowGeneration
        let trimmed = note.trimmingCharacters(in: .whitespacesAndNewlines)
        let jpeg = photo.flatMap { KioskPhotoCapture.uploadJPEG(from: $0) }
        let target = KioskReportTarget.for(item, quantity: quantity)
        let details = ([item.id, type, trimmed] + target.fields.map { "\($0.0)=\($0.1)" }).joined(separator: "|")
        let requestId: String
        if let pendingReport, pendingReport.details == details {
            requestId = pendingReport.requestId
        } else {
            requestId = "\(Int64(Date().timeIntervalSince1970 * 1000)):\(UUID().uuidString)"
            pendingReport = (details, requestId)
        }
        Task {
            defer { if store.ownsFlow(flow) { isSubmitting = false } }
            do {
                let result = try await KioskAPI.shared.kioskCheckinReport(
                    bookingId: bookingId,
                    actorId: actorId,
                    target: target,
                    type: type,
                    description: trimmed.isEmpty ? nil : trimmed,
                    photoJPEG: jpeg,
                    staffToken: staffToken,
                    requestId: requestId
                )
                guard store.ownsFlow(flow) else { return }
                pendingReport = nil
                Haptics.success()
                onReported(result, item)
            } catch {
                guard store.ownsFlow(flow) else { return }
                Haptics.error()
                errorMessage = (error as? APIError)?.errorDescription ?? "That report didn't go through. Try again."
            }
        }
    }
}


enum KioskReturnReportCopy {
    /// Decision 4: a missing item is accounted for, like web's LOST report.
    static let missingExplainer = "Staff follow up from here. It's accounted for, so this return can finish without it. Everything else you scanned is returned as normal."

    /// How the report names an item: the tag, "Sony Battery #7", or the
    /// counted stock's name.
    static func label(_ item: KioskCheckoutDetail.ReturnItem) -> String {
        if item.isNumberedBulk {
            if let sku = item.bulkSkuName, let number = item.unitNumber { return "\(sku) #\(number)" }
            return item.name
        }
        if item.isCountedStock { return item.bulkSkuName ?? item.name }
        return item.itemListPrimaryTitle
    }

    static func damagedChoiceDetail(_ item: KioskCheckoutDetail.ReturnItem, isBack: Bool, isMissing: Bool) -> String {
        if isMissing { return "It's marked missing, so it can't be reported damaged." }
        if item.isCountedStock { return "Some came back damaged. They count as returned, and staff take a look." }
        return isBack
            ? "You have it, but something's wrong. Describe it and take a photo."
            : "Scan it back, then describe the damage and take a photo."
    }

    /// G6: Returned, then a card for each item held for staff or marked missing.
    static func receipt(
        user: KioskUser,
        title: String,
        refNumber: String?,
        returnedCount: Int,
        totalItems: Int,
        returnedItems: [KioskReceipt.Item],
        damaged: [(tag: String, name: String?)],
        missing: [(tag: String, name: String?)]
    ) -> KioskReceipt {
        var cards: [KioskReceipt.Card] = []
        if returnedCount > 0 {
            let heading = returnedCount == totalItems
                ? "All \(totalItems) · \(title)"
                : "\(returnedCount) of \(totalItems) · \(title)"
            cards.append(KioskReceipt.Card(
                overline: "Returned",
                refNumber: refNumber,
                title: heading,
                items: returnedItems
            ))
        }
        for item in damaged {
            cards.append(KioskReceipt.Card(
                overline: "Held for staff",
                refNumber: refNumber,
                title: [item.tag, item.name].compactMap { $0 }.joined(separator: " · "),
                detail: "Returned and reported damaged. Staff check it before it goes out again."
            ))
        }
        for item in missing {
            cards.append(KioskReceipt.Card(
                overline: "Marked missing",
                refNumber: refNumber,
                title: [item.tag, item.name].compactMap { $0 }.joined(separator: " · "),
                detail: "Staff have been told. It's accounted for on this return.",
                isProblem: true
            ))
        }
        let nextStep: String?
        if let first = missing.first {
            nextStep = "Thanks. If \(missing.count == 1 ? first.tag : "any of them") turns up, bring it to staff."
        } else if !damaged.isEmpty {
            nextStep = "Thanks for flagging it. Staff will take a look."
        } else {
            nextStep = nil
        }
        return KioskReceipt(
            firstName: String(user.name.split(separator: " ").first ?? Substring(user.name)),
            avatarURL: user.avatarUrl,
            initials: user.initials,
            cards: cards,
            nextStep: nextStep
        )
    }
}

/// The iPad camera for a damage photo (G4). Device-only: the simulator has
/// no camera, so the page offers "describe it instead" there.
struct KioskPhotoCapture: UIViewControllerRepresentable {
    let onCapture: (UIImage) -> Void
    let onCancel: () -> Void

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.cameraCaptureMode = .photo
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: KioskPhotoCapture
        init(_ parent: KioskPhotoCapture) { self.parent = parent }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage { parent.onCapture(image) } else { parent.onCancel() }
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { parent.onCancel() }
    }

    /// JPEG under the server's 4.5 MB image limit: long edge capped at 2000 px.
    static func uploadJPEG(from image: UIImage) -> Data? {
        let maxEdge: CGFloat = 2000
        let size = image.size
        let scale = min(1, maxEdge / max(size.width, size.height))
        let target = CGSize(width: size.width * scale, height: size.height * scale)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let resized = UIGraphicsImageRenderer(size: target, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: target))
        }
        for quality in [0.75, 0.55, 0.4] {
            if let data = resized.jpegData(compressionQuality: quality), data.count < 4_400_000 { return data }
        }
        return nil
    }
}
