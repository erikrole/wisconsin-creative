import SwiftUI
import UIKit

/// Where the return's "Something damaged or missing?" page is.
enum KioskReturnReportStep: Equatable {
    /// G3: pick the item, then what happened to it.
    case choose(selectedId: String?)
    /// G4: describe it and take a photo. The item was scanned back.
    case damaged(itemId: String)
    /// G5: mark it missing and tell staff. The item was not scanned back.
    case missing(itemId: String)
}

/// Damaged or missing, reported from the return screen (redesign G3–G5).
///
/// Posts to `/api/kiosk/checkin/{id}/report`. A damaged item still counts as
/// returned and is held for staff; a missing item is accounted for (the same
/// as web's LOST report), so the return can finish without it.
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
    /// Serialized items only: counted and numbered stock has no asset to report.
    let items: [KioskCheckoutDetail.ReturnItem]
    let returnedIds: Set<String>
    @Binding var step: KioskReturnReportStep?
    let onReported: (KioskCheckinReportResult, KioskCheckoutDetail.ReturnItem) -> Void

    @State private var note = ""
    @State private var photo: UIImage?
    @State private var showCamera = false
    @State private var isSubmitting = false
    @State private var errorMessage: String?

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
                    Text("What happened to \(item.itemListPrimaryTitle)?")
                        .font(KioskType.heroAction)
                        .foregroundStyle(KioskText.primary)
                    HStack(spacing: 12) {
                        let isBack = returnedIds.contains(item.id)
                        choiceCard(
                            dot: KioskSection.comingBack.accent,
                            title: "It's damaged",
                            detail: isBack
                                ? "You have it, but something's wrong. Describe it and take a photo."
                                : "Scan it back first, then report the damage.",
                            enabled: isBack
                        ) { resetDraft(); step = .damaged(itemId: item.id) }
                        choiceCard(
                            dot: KioskSection.problem.accent,
                            title: "It's missing",
                            detail: isBack
                                ? "It was scanned back, so it isn't missing."
                                : "You can't find it. We'll mark it and let staff know.",
                            enabled: !isBack
                        ) { resetDraft(); step = .missing(itemId: item.id) }
                    }
                } else {
                    Text("Which item?")
                        .font(KioskType.heroAction)
                        .foregroundStyle(KioskText.primary)
                    Text("Pick it from the list. Everything else returns as normal.")
                        .font(KioskType.body)
                        .foregroundStyle(KioskText.secondary)
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .topLeading)
        } panel: {
            overline("Which item?")
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
                Text(item.itemListPrimaryTitle)
                    .font(KioskType.rowTitle)
                    .foregroundStyle(KioskText.primary)
                if let name = item.itemListSecondaryTitle {
                    Text(name)
                        .font(KioskType.meta)
                        .foregroundStyle(KioskText.secondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 8)
                if returnedIds.contains(item.id) {
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

    // MARK: - G4 damaged

    private func damagedPage(_ item: KioskCheckoutDetail.ReturnItem) -> some View {
        KioskTaskScaffold(header: KioskTaskHeader(
            title: "\(item.itemListPrimaryTitle) is damaged",
            subtitle: [item.itemListSecondaryTitle, checkoutTitle].compactMap { $0 }.joined(separator: " · "),
            onBack: { step = .choose(selectedId: item.id) }
        )) {
            photoArea
            if let errorMessage { errorLine(errorMessage) }
            KioskPrimaryPill(
                title: "Report and return it",
                isEnabled: !note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || photo != nil,
                isBusy: isSubmitting
            ) { submit(item, type: "DAMAGED") }
        } panel: {
            overline("What's wrong?")
            noteField(placeholder: "Describe the damage")
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
            title: "\(item.itemListPrimaryTitle) is missing",
            subtitle: [item.itemListSecondaryTitle, checkoutTitle].compactMap { $0 }.joined(separator: " · "),
            onBack: { step = .choose(selectedId: item.id) }
        )) {
            VStack(alignment: .leading, spacing: 16) {
                Text("We'll mark \(item.itemListPrimaryTitle) missing and tell staff.")
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
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            .kioskCard(KioskSection.problem.stageFill, radius: KioskRadius.hero, stroke: KioskSection.problem.stageStroke)
            if let errorMessage { errorLine(errorMessage) }
            KioskPrimaryPill(title: "Mark missing", isBusy: isSubmitting) { submit(item, type: "LOST") }
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
    }

    private func submit(_ item: KioskCheckoutDetail.ReturnItem, type: String) {
        guard !isSubmitting else { return }
        store.resetInactivity()
        isSubmitting = true
        errorMessage = nil
        let flow = store.flowGeneration
        let trimmed = note.trimmingCharacters(in: .whitespacesAndNewlines)
        let jpeg = photo.flatMap { KioskPhotoCapture.uploadJPEG(from: $0) }
        Task {
            defer { if store.ownsFlow(flow) { isSubmitting = false } }
            do {
                let result = try await KioskAPI.shared.kioskCheckinReport(
                    bookingId: bookingId,
                    actorId: actorId,
                    assetId: item.id,
                    type: type,
                    description: trimmed.isEmpty ? nil : trimmed,
                    photoJPEG: jpeg,
                    staffToken: staffToken
                )
                guard store.ownsFlow(flow) else { return }
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

    /// G6: Returned, then a card for each item held for staff or marked missing.
    static func receipt(
        user: KioskUser,
        title: String,
        refNumber: String?,
        returnedCount: Int,
        totalItems: Int,
        returnedTags: [String],
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
                detail: returnedTags.isEmpty ? nil : returnedTags.joined(separator: ", ")
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
