import SwiftUI
import VisionKit
import AVFoundation

// MARK: - Entry point

struct LinkStickerWizard: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var step: WizardStep = .scan
    @State private var scannedCode: String = ""
    @State private var selectedAsset: Asset? = nil
    @State private var linkedCount = 0

    enum WizardStep { case scan, pick, confirm, success }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                StepIndicator(step: step)
                    .padding(.horizontal)
                    .padding(.top, 8)
                    .padding(.bottom, 4)

                switch step {
                case .scan:
                    ScanStepView(scannedCode: $scannedCode, onContinue: { step = .pick })
                        .transition(.asymmetric(insertion: .move(edge: .leading), removal: .move(edge: .leading)))
                case .pick:
                    PickItemStepView(scannedCode: scannedCode, selectedAsset: $selectedAsset,
                                     onBack: { step = .scan },
                                     onContinue: { step = .confirm })
                        .transition(.asymmetric(insertion: .move(edge: .trailing), removal: .move(edge: .leading)))
                case .confirm:
                    ConfirmStepView(scannedCode: scannedCode, asset: selectedAsset!,
                                    onBack: { step = .pick },
                                    onSaved: {
                                        linkedCount += 1
                                        step = .success
                                    })
                        .transition(.asymmetric(insertion: .move(edge: .trailing), removal: .move(edge: .leading)))
                case .success:
                    SuccessStepView(asset: selectedAsset!, scannedCode: scannedCode, linkedCount: linkedCount,
                                    onScanNext: {
                                        scannedCode = ""
                                        selectedAsset = nil
                                        step = .scan
                                    },
                                    onDone: { dismiss() })
                        .transition(.asymmetric(insertion: .move(edge: .trailing), removal: .move(edge: .trailing)))
                }

            }
            .animation(reduceMotion ? nil : .easeInOut(duration: 0.25), value: step)
            .navigationTitle("Link Sticker Codes")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}

// MARK: - Step indicator

private struct StepIndicator: View {
    let step: LinkStickerWizard.WizardStep

    private let steps: [(LinkStickerWizard.WizardStep, String)] = [
        (.scan, "Scan"), (.pick, "Item"), (.confirm, "Link")
    ]
    private var currentIndex: Int {
        switch step {
        case .scan: 0
        case .pick: 1
        case .confirm, .success: 2
        }
    }

    var body: some View {
        HStack(spacing: 0) {
            ForEach(Array(steps.enumerated()), id: \.offset) { idx, s in
                HStack(spacing: 0) {
                    Circle()
                        .fill(idx <= currentIndex ? Color.brandPrimary : Color(.systemFill))
                        .frame(width: 24, height: 24)
                        .overlay {
                            if idx < currentIndex {
                                Image(systemName: "checkmark")
                                    .font(.system(size: 11, weight: .bold))
                                    .foregroundStyle(.white)
                            } else {
                                Text("\(idx + 1)")
                                    .font(.caption2.weight(.semibold))
                                    .foregroundStyle(idx == currentIndex ? .white : .secondary)
                            }
                        }
                    Text(s.1)
                        .font(.caption)
                        .foregroundStyle(idx == currentIndex ? .primary : .secondary)
                        .padding(.leading, 5)
                    if idx < steps.count - 1 {
                        Rectangle()
                        .fill(idx < currentIndex ? Color.brandPrimary : Color(.systemFill))
                            .frame(height: 2)
                            .padding(.horizontal, 8)
                    }
                }
            }
        }
        .padding(.vertical, 8)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Step \(currentIndex + 1) of \(steps.count): \(steps[currentIndex].1)")
    }
}

// MARK: - Step 1: Scan

private struct ScanStepView: View {
    @Binding var scannedCode: String
    let onContinue: () -> Void

    @State private var torchOn = false
    @State private var cameraAuthorized: Bool? = nil
    @State private var showManual = false
    @State private var manualInput = ""
    @State private var isPaused = false

    var body: some View {
        ZStack {
            if let authorized = cameraAuthorized {
                if authorized && DataScannerViewController.isSupported {
                    ScannerRepresentable(
                        torchOn: torchOn,
                        isPaused: isPaused,
                        onScan: handleScan
                    )
                    .ignoresSafeArea(edges: .bottom)
                } else if !authorized {
                    ContentUnavailableView("Camera Access Required",
                        systemImage: "camera.badge.exclamationmark",
                        description: Text("Allow camera access in Settings."))
                } else {
                    typeManuallyFallback
                }
            }

            VStack {
                Spacer()
                bottomOverlay
                    .padding(.horizontal)
                    .padding(.bottom, 24)
            }
        }
        .task { await checkPermission() }
        .alert("Enter Code Manually", isPresented: $showManual) {
            TextField("Paste or type code", text: $manualInput)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
            Button("Use This Code") {
                let trimmed = manualInput.trimmingCharacters(in: .whitespaces)
                guard !trimmed.isEmpty else { return }
                scannedCode = trimmed
                manualInput = ""
                onContinue()
            }
            Button("Cancel", role: .cancel) { manualInput = "" }
        }
    }

    @ViewBuilder private var typeManuallyFallback: some View {
        VStack(spacing: 16) {
            Image(systemName: "qrcode.viewfinder")
                .font(.system(size: 48))
                .foregroundStyle(.secondary)
            Text("Scanner Unavailable")
                .font(.title3.weight(.semibold))
            Button("Enter Code Manually") { showManual = true }
                .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    @ViewBuilder private var bottomOverlay: some View {
        VStack(spacing: 12) {
            if !scannedCode.isEmpty {
                HStack(spacing: 10) {
                    Image(systemName: "qrcode")
                        .foregroundStyle(.secondary)
                        .accessibilityHidden(true)
                    Text(scannedCode)
                        .font(.system(.subheadline, design: .monospaced))
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Spacer()
                    Button {
                        scannedCode = ""
                        isPaused = false
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.tertiary)
                    }
                    .accessibilityLabel("Clear scanned code")
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))

                Button("Next: Pick Item") { onContinue() }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .frame(maxWidth: .infinity)
            } else {
                HStack(spacing: 12) {
                    Button {
                        torchOn.toggle()
                    } label: {
                        Label(torchOn ? "Torch On" : "Torch", systemImage: torchOn ? "bolt.fill" : "bolt.slash")
                            .font(.subheadline.weight(.medium))
                            .padding(.horizontal, 14)
                            .padding(.vertical, 10)
                            .background(.regularMaterial, in: Capsule())
                            .foregroundStyle(torchOn ? .yellow : .primary)
                    }
                    .accessibilityLabel(torchOn ? "Turn off flashlight" : "Turn on flashlight")
                    Spacer()
                    Button("Enter Manually") { showManual = true }
                        .font(.subheadline.weight(.medium))
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .background(.regularMaterial, in: Capsule())
                }
            }
        }
    }

    private func handleScan(_ value: String) {
        guard scannedCode.isEmpty else { return }
        Haptics.success()
        scannedCode = value
        isPaused = true
    }

    private func checkPermission() async {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: cameraAuthorized = true
        case .notDetermined: cameraAuthorized = await AVCaptureDevice.requestAccess(for: .video)
        default: cameraAuthorized = false
        }
    }
}

private struct ScannerRepresentable: UIViewControllerRepresentable {
    let torchOn: Bool
    let isPaused: Bool
    let onScan: (String) -> Void

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let vc = DataScannerViewController(
            recognizedDataTypes: [.barcode()],
            qualityLevel: .accurate,
            recognizesMultipleItems: false,
            isPinchToZoomEnabled: true,
            isGuidanceEnabled: true,
            isHighlightingEnabled: true
        )
        vc.delegate = context.coordinator
        try? vc.startScanning()
        return vc
    }

    func updateUIViewController(_ vc: DataScannerViewController, context: Context) {
        context.coordinator.onScan = onScan
        if isPaused, vc.isScanning { vc.stopScanning() }
        else if !isPaused, !vc.isScanning { try? vc.startScanning() }
        if let device = AVCaptureDevice.default(for: .video), device.hasTorch {
            try? device.lockForConfiguration()
            device.torchMode = torchOn ? .on : .off
            device.unlockForConfiguration()
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(onScan: onScan) }

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        var onScan: (String) -> Void
        init(onScan: @escaping (String) -> Void) { self.onScan = onScan }
        func dataScanner(_ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) {
            guard let item = addedItems.first, case .barcode(let b) = item, let val = b.payloadStringValue else { return }
            DispatchQueue.main.async { self.onScan(val) }
        }
    }
}

// MARK: - Step 2: Pick Item

private struct PickItemStepView: View {
    let scannedCode: String
    @Binding var selectedAsset: Asset?
    let onBack: () -> Void
    let onContinue: () -> Void

    @State private var query = ""
    @State private var results: [Asset] = []
    @State private var isSearching = false
    @State private var searchError: String?
    @State private var searchTask: Task<Void, Never>? = nil

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Code to link:")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text(scannedCode)
                    .font(.system(.subheadline, design: .monospaced).weight(.medium))
                    .foregroundStyle(.primary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal)
            .padding(.vertical, 10)
            .background(Color(.secondarySystemBackground))

            List {
                Section {
                    if isSearching {
                        HStack {
                            Spacer()
                            ProgressView()
                            Spacer()
                        }
                        .listRowBackground(Color.clear)
                    } else if let err = searchError, results.isEmpty {
                        // Distinct from "no matches" so server failure doesn't
                        // masquerade as an empty result set.
                        VStack(spacing: 10) {
                            Image(systemName: "wifi.exclamationmark")
                                .font(.title2)
                                .foregroundStyle(Color.statusText(.red))
                                .accessibilityHidden(true)
                            Text("Couldn't search")
                                .font(.subheadline.weight(.semibold))
                            Text(err)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .multilineTextAlignment(.center)
                            Button("Retry") { scheduleSearch(query) }
                                .buttonStyle(.bordered)
                                .controlSize(.small)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .listRowBackground(Color.clear)
                    } else if results.isEmpty && !query.isEmpty {
                        ContentUnavailableView.search(text: query)
                            .listRowBackground(Color.clear)
                    } else {
                        ForEach(results) { asset in
                            Button { pick(asset) } label: {
                                AssetPickRow(asset: asset)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                } header: {
                    if results.isEmpty && query.isEmpty {
                        Text("Search for an item by name, tag, or serial number.")
                            .textCase(nil)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .listStyle(.plain)
            .searchable(text: $query, prompt: "Search items…")
            .onChange(of: query) { _, new in scheduleSearch(new) }

            HStack {
                Button("Back", action: onBack)
                    .buttonStyle(.bordered)
                Spacer()
            }
            .padding()
        }
    }

    private func pick(_ asset: Asset) {
        selectedAsset = asset
        onContinue()
    }

    private func scheduleSearch(_ q: String) {
        searchTask?.cancel()
        guard !q.trimmingCharacters(in: .whitespaces).isEmpty else {
            results = []
            searchError = nil
            return
        }
        searchTask = Task {
            try? await Task.sleep(nanoseconds: 300_000_000)
            guard !Task.isCancelled else { return }
            isSearching = true
            searchError = nil
            defer { isSearching = false }
            do {
                let resp = try await APIClient.shared.assets(search: q, limit: 20)
                guard !Task.isCancelled else { return }
                results = resp.data
            } catch {
                guard !Task.isCancelled else { return }
                searchError = error.localizedDescription
                results = []
            }
        }
    }
}

private struct AssetPickRow: View {
    let asset: Asset
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "archivebox")
                .frame(width: 28)
                .foregroundStyle(.tint)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(asset.itemListPrimaryTitle)
                    .font(.gothamBold(size: 16))
                Text([asset.itemListSecondaryTitle, asset.serialNumber].compactMap { $0 }.joined(separator: " · ").nilIfEmpty ?? "—")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.caption)
                .foregroundStyle(.tertiary)
                .accessibilityHidden(true)
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(rowAccessibilityLabel)
    }

    private var rowAccessibilityLabel: String {
        var parts: [String] = [asset.itemListPrimaryTitle]
        if let subtitle = asset.itemListSecondaryTitle { parts.append(subtitle) }
        if let serial = asset.serialNumber { parts.append("Serial \(serial)") }
        return parts.joined(separator: ", ")
    }
}

// MARK: - Step 3: Confirm

private struct ConfirmStepView: View {
    let scannedCode: String
    let asset: Asset
    let onBack: () -> Void
    let onSaved: () -> Void

    @State private var isSaving = false
    @State private var saveError: String?

    var body: some View {
        VStack(spacing: 0) {
            List {
                Section("Item") {
                    LabeledContent("Name", value: asset.displayName)
                    if let tag = asset.assetTag {
                        LabeledContent("Asset Tag", value: tag)
                    }
                }

                Section("Code to Link") {
                    LabeledContent("Scanned Code") {
                        Text(scannedCode)
                            .font(.system(.subheadline, design: .monospaced))
                            .foregroundStyle(Color.statusText(.green))
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                }

                if let err = saveError {
                    Section {
                        Label(err, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(Color.statusText(.red))
                            .font(.subheadline)
                    }
                }
            }
            .listStyle(.insetGrouped)

            VStack(spacing: 12) {
                Button {
                    Task { await save() }
                } label: {
                    if isSaving {
                        ProgressView().tint(.white)
                    } else {
                        Text("Save & Link")
                    }
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(isSaving)
                .frame(maxWidth: .infinity)

                Button("Back", action: onBack)
                    .disabled(isSaving)
            }
            .padding()
        }
    }

    private func save() async {
        saveError = nil
        isSaving = true
        defer { isSaving = false }
        do {
            try await APIClient.shared.updateAssetQR(id: asset.id, qrCodeValue: scannedCode)
            Haptics.success()
            onSaved()
        } catch {
            Haptics.error()
            saveError = error.localizedDescription
        }
    }
}

// MARK: - Step 4: Success

private struct SuccessStepView: View {
    let asset: Asset
    let scannedCode: String
    let linkedCount: Int
    let onScanNext: () -> Void
    let onDone: () -> Void

    var body: some View {
        VStack(spacing: 32) {
            Spacer()

            VStack(spacing: 16) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 64))
                    .foregroundStyle(Color.statusText(.green))
                    .accessibilityHidden(true)
                Text("Linked!")
                    .font(.title.weight(.bold))
                Text("\(Text(scannedCode).fontDesign(.monospaced)) → \(Text(asset.itemListPrimaryTitle).font(.gothamBold(size: 16)))")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
            }

            if linkedCount > 1 {
                Text("\(linkedCount) stickers linked this session")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }

            Spacer()

            VStack(spacing: 12) {
                Button("Scan Next Sticker", action: onScanNext)
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .frame(maxWidth: .infinity)

                Button("Done", action: onDone)
                    .foregroundStyle(.secondary)
            }
            .padding()
        }
    }
}

// MARK: - Helpers

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
