import SwiftUI
import VisionKit
import AVFoundation

enum QRScannerMatch {
    case asset(String)
    case itemFamily(AssetFamilySearchResult)
}

/// What the host wants the scanner to do after it handles a match.
enum QRScannerResolution {
    case dismiss
    /// Keep scanning; optionally flash a success/failure banner in-scanner.
    case continueScanning(message: String?, success: Bool)
}

struct QRScannerSheet: View {
    /// Async match handler. Return `.dismiss` for one-shot lookups or
    /// `.continueScanning` to keep the camera open (e.g. adding a shelf of
    /// items to a reservation in one session).
    let resolve: (QRScannerMatch) async -> QRScannerResolution

    /// One-shot form: the host receives the match and the sheet dismisses.
    init(onMatch: @escaping (QRScannerMatch) -> Void) {
        self.resolve = { match in
            onMatch(match)
            return .dismiss
        }
    }

    init(resolve: @escaping (QRScannerMatch) async -> QRScannerResolution) {
        self.resolve = resolve
    }

    private struct ScanBanner: Equatable {
        let message: String
        let success: Bool
    }

    /// One line in the session's scan history strip. Kept in memory only: it
    /// answers "did that one go through?" during a run of scans, and has no
    /// reason to outlive the sheet.
    struct ScanHistoryEntry: Identifiable, Equatable {
        let id = UUID()
        let label: String
        let success: Bool
    }

    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOverEnabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var cameraAuth: AVAuthorizationStatus = AVCaptureDevice.authorizationStatus(for: .video)
    @State private var banner: ScanBanner?
    @State private var bannerClearTask: Task<Void, Never>?
    @State private var isLookingUp = false
    @State private var showManualEntry = false
    @State private var lastScanTime: Date = .distantPast
    @State private var torchOn = false
    @State private var history: [ScanHistoryEntry] = []
    @State private var showsNoCodeHint = false
    /// Bumped on every scan attempt so the idle-hint timer restarts.
    @State private var idleToken = 0

    var body: some View {
        ZStack {
            scannerContent
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            topControls
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if cameraAuth == .authorized && DataScannerViewController.isSupported && DataScannerViewController.isAvailable && !voiceOverEnabled {
                bottomControls
            }
        }
        .overlay {
            if showManualEntry {
                ScanManualEntrySheet(
                    onSubmit: { code in
                    showManualEntry = false
                    Task { await lookUp(rawScan: code) }
                    },
                    onCancel: { showManualEntry = false }
                )
                .background(Color(.systemBackground))
                .ignoresSafeArea()
                .transition(reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity))
                .zIndex(1)
            }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                cameraAuth = AVCaptureDevice.authorizationStatus(for: .video)
            } else {
                torchOn = false
                setTorch(false)
            }
        }
        .onDisappear {
            torchOn = false
            setTorch(false)
        }
        .preferredColorScheme(cameraAuth == .authorized && !voiceOverEnabled ? .dark : nil)
        .statusBarHidden(false)
    }

    // MARK: - Scanner

    @ViewBuilder
    private var scannerContent: some View {
        switch cameraAuth {
        case .notDetermined:
            ScanPrePromptView { granted in
                cameraAuth = granted ? .authorized : .denied
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color(.systemBackground))
        case .denied, .restricted:
            ScanDeniedView {
                showManualEntry = true
            }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color(.systemBackground))
        case .authorized:
            if voiceOverEnabled {
                voiceOverManualFallback
            } else if DataScannerViewController.isSupported && DataScannerViewController.isAvailable {
                ZStack(alignment: .bottom) {
                    Color.black.ignoresSafeArea()
                    scannerView
                    if let banner {
                        bannerView(banner)
                            .padding(.horizontal, 24)
                            .padding(.bottom, 168)
                            .transition(reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity))
                    } else if showsNoCodeHint, !isLookingUp, !showManualEntry {
                        noCodeHint
                            .padding(.horizontal, 24)
                            .padding(.bottom, 168)
                            .transition(.opacity)
                    }
                }
                .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: banner)
                .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: showsNoCodeHint)
                // Restarts on every attempt. Six quiet seconds with the camera
                // open usually means a code that is too far, too close, or
                // glare-struck, and the viewfinder gives no hint of that.
                .task(id: idleToken) {
                    showsNoCodeHint = false
                    try? await Task.sleep(for: .seconds(6))
                    guard !Task.isCancelled else { return }
                    showsNoCodeHint = true
                }
            } else {
                unavailableView
                    .background(Color.black.ignoresSafeArea())
            }
        @unknown default:
            unavailableView
                .background(Color.black.ignoresSafeArea())
        }
    }

    private var scannerView: some View {
        DataScannerRepresentable(
            torchOn: torchOn,
            onScan: { value in
                Task { await handleScan(rawScan: value) }
            }
        )
        .ignoresSafeArea()
    }

    // MARK: - Overlay

    private var topControls: some View {
        HStack {
            Button { dismiss() } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(cameraAuth == .authorized ? .white : .primary)
                    .frame(width: 44, height: 44)
                    .background(.ultraThinMaterial, in: Circle())
            }
            .accessibilityLabel("Close scanner")
            Spacer()
            if cameraAuth == .authorized && !voiceOverEnabled && DataScannerViewController.isSupported && DataScannerViewController.isAvailable {
                Button {
                    let next = !torchOn
                    torchOn = next
                    setTorch(next)
                } label: {
                    Image(systemName: torchOn ? "bolt.fill" : "bolt.slash")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(torchOn ? .yellow : .white)
                        .frame(width: 44, height: 44)
                        .background(.ultraThinMaterial, in: Circle())
                }
                .accessibilityLabel(torchOn ? "Turn flashlight off" : "Turn flashlight on")
                .disabled(!hasTorch)
                .opacity(hasTorch ? 1 : 0.4)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
    }

    private var bottomControls: some View {
        VStack {
            VStack(spacing: 16) {
                if !history.isEmpty {
                    historyStrip
                }
                if isLookingUp {
                    HStack(spacing: 8) {
                        ProgressView()
                        Text("Looking up…")
                            .foregroundStyle(.white)
                            .font(.subheadline)
                    }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 10)
                    .background(.ultraThinMaterial, in: Capsule())
                }

                Button {
                    showManualEntry = true
                } label: {
                    Label("Type code", systemImage: "keyboard")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 18)
                        .frame(height: 44)
                        .background(.ultraThinMaterial, in: Capsule())
                }
                .accessibilityLabel("Type code instead")
            }
            .padding(.bottom, 32)
        }
    }

    /// The last few scans of this session, newest first. A scan that did not
    /// match is listed too, in red, so a skipped item is never silent.
    private var historyStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(history) { entry in
                    Label(entry.label, systemImage: entry.success ? "checkmark.circle.fill" : "xmark.circle.fill")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.white)
                        .lineLimit(1)
                        .padding(.horizontal, 12)
                        .frame(height: 32)
                        .background(
                            entry.success ? Color.statusText(.green).opacity(0.7) : Color.statusText(.red).opacity(0.7),
                            in: Capsule()
                        )
                        .accessibilityElement(children: .combine)
                        .accessibilityLabel("\(entry.success ? "Scanned" : "No match"): \(entry.label)")
                }
            }
            .padding(.horizontal, 16)
        }
        .frame(height: 32)
        .accessibilityLabel("Recent scans")
    }

    private var noCodeHint: some View {
        Label("No code found yet. Hold it steady inside the frame, or type it.", systemImage: "viewfinder")
            .font(.subheadline)
            .foregroundStyle(.white)
            .multilineTextAlignment(.leading)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(.ultraThinMaterial, in: Capsule())
            .accessibilityElement(children: .combine)
    }

    private func record(_ label: String, success: Bool) {
        history.insert(ScanHistoryEntry(label: label, success: success), at: 0)
        if history.count > 5 { history.removeLast(history.count - 5) }
    }

    @ViewBuilder
    private func bannerView(_ banner: ScanBanner) -> some View {
        if banner.success {
            Label(banner.message, systemImage: "checkmark.circle.fill")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.white)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .background(Color.statusText(.green).opacity(0.88), in: RoundedRectangle(cornerRadius: 14))
                .accessibilityElement(children: .combine)
        } else {
            VStack(spacing: 10) {
                Text(banner.message)
                    .font(.subheadline)
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)

                HStack(spacing: 12) {
                    Button {
                        showManualEntry = true
                    } label: {
                        Label("Type code", systemImage: "keyboard")
                    }
                    .buttonStyle(.bordered)
                    .tint(.white)

                    Button("Dismiss") {
                        self.banner = nil
                    }
                    .buttonStyle(.bordered)
                    .tint(.white)
                }
                .controlSize(.small)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(Color.statusText(.red).opacity(0.88), in: RoundedRectangle(cornerRadius: 14))
            .accessibilityElement(children: .contain)
        }
    }

    /// Shows a banner; success banners clear themselves so the next scan
    /// starts from a clean viewfinder.
    private func showBanner(_ newBanner: ScanBanner) {
        bannerClearTask?.cancel()
        banner = newBanner
        guard newBanner.success else { return }
        bannerClearTask = Task {
            try? await Task.sleep(for: .seconds(1.8))
            guard !Task.isCancelled else { return }
            banner = nil
        }
    }

    private var voiceOverManualFallback: some View {
        VStack(spacing: 18) {
            Image(systemName: "keyboard")
                .font(.system(size: 44))
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)

            Text("Type code instead")
                .font(.title3.weight(.semibold))

            Text("VoiceOver is on, so use keyboard entry instead of the camera scanner.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)

            Button {
                showManualEntry = true
            } label: {
                Label("Type code", systemImage: "keyboard")
            }
            .buttonStyle(.glassProminent)
            .controlSize(.large)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemBackground))
    }

    // MARK: - Permission views

    private var unavailableView: some View {
        VStack(spacing: 16) {
            if !showManualEntry {
                Image(systemName: "qrcode.viewfinder")
                    .font(.system(size: 48))
                    .foregroundStyle(.white.opacity(0.6))
                Text("Scanner Unavailable")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(.white)
                Button("Type Code Instead") { showManualEntry = true }
                    .buttonStyle(.glassProminent)
                    .controlSize(.large)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Logic

    private var hasTorch: Bool {
        AVCaptureDevice.default(for: .video)?.hasTorch ?? false
    }

    private func setTorch(_ on: Bool) {
        guard let device = AVCaptureDevice.default(for: .video), device.hasTorch else { return }
        do {
            try device.lockForConfiguration()
            device.torchMode = on ? .on : .off
            device.unlockForConfiguration()
        } catch {
            // Torch is best-effort. A lock failure should not block lookup.
        }
    }

    private func handleScan(rawScan: String) async {
        let now = Date()
        guard now.timeIntervalSince(lastScanTime) > 2.0 else { return }
        lastScanTime = now
        await lookUp(rawScan: rawScan)
    }

    private func lookUp(rawScan: String) async {
        guard !rawScan.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        banner = nil
        isLookingUp = true
        idleToken += 1
        defer { isLookingUp = false }
        let shortCode = rawScan.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            let response = try await APIClient.shared.scannedAssets(rawScan: rawScan)
            let match: QRScannerMatch?
            var label = shortCode
            if let asset = response.data.first {
                match = .asset(asset.id)
                label = asset.assetTag.nonBlankText ?? asset.displayName
            } else if let family = response.bulkItems.first {
                match = .itemFamily(family)
                label = family.name
            } else {
                match = nil
            }
            guard let match else {
                Haptics.warning()
                record(shortCode, success: false)
                showBanner(ScanBanner(message: "No item matches this code.", success: false))
                return
            }
            switch await resolve(match) {
            case .dismiss:
                Haptics.success()
                record(label, success: true)
                // A beat of confirmation before the sheet closes, so the scan
                // is seen to land rather than the screen simply vanishing.
                showBanner(ScanBanner(message: label, success: true))
                try? await Task.sleep(for: .milliseconds(reduceMotion ? 150 : 350))
                dismiss()
            case .continueScanning(let message, let success):
                record(label, success: success)
                if success { Haptics.success() } else { Haptics.warning() }
                if let message {
                    showBanner(ScanBanner(message: message, success: success))
                }
            }
        } catch {
            Haptics.error()
            record(shortCode, success: false)
            showBanner(ScanBanner(message: error.localizedDescription, success: false))
        }
    }
}

// MARK: - DataScannerViewController wrapper

private struct DataScannerRepresentable: UIViewControllerRepresentable {
    let torchOn: Bool
    let onScan: (String) -> Void

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let vc = DataScannerViewController(
            recognizedDataTypes: [.barcode()],
            qualityLevel: .balanced,
            recognizesMultipleItems: false,
            isHighFrameRateTrackingEnabled: false,
            isGuidanceEnabled: true,
            isHighlightingEnabled: true
        )
        vc.delegate = context.coordinator
        try? vc.startScanning()
        return vc
    }

    func updateUIViewController(_ vc: DataScannerViewController, context: Context) {
        // Toggle torch via AVCaptureDevice
        if let device = AVCaptureDevice.default(for: .video), device.hasTorch {
            try? device.lockForConfiguration()
            device.torchMode = torchOn ? .on : .off
            device.unlockForConfiguration()
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(onScan: onScan) }

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        let onScan: (String) -> Void
        private var lastScanned: String?
        private var lastScannedAt: Date = .distantPast

        init(onScan: @escaping (String) -> Void) { self.onScan = onScan }

        func dataScanner(_ dataScanner: DataScannerViewController, didTapOn item: RecognizedItem) {
            if case .barcode(let barcode) = item, let value = barcode.payloadStringValue {
                handle(value)
            }
        }

        func dataScanner(_ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) {
            guard let item = addedItems.first, case .barcode(let barcode) = item,
                  let value = barcode.payloadStringValue else { return }
            handle(value)
        }

        private func handle(_ value: String) {
            let now = Date()
            guard value != lastScanned || now.timeIntervalSince(lastScannedAt) > 2 else { return }
            lastScanned = value
            lastScannedAt = now
            onScan(value)
        }
    }
}

// MARK: - Manual entry sheet

/// Shared typed-code fallback used by `QRScannerSheet` and `ScannerDebuggerView`.
struct ScanManualEntrySheet: View {
    let onSubmit: (String) -> Void
    var onCancel: (() -> Void)? = nil
    @Environment(\.dismiss) private var dismiss
    @State private var code = ""
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                TextField("Asset tag, sticker code, or ref number", text: $code)
                    .textFieldStyle(.roundedBorder)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.search)
                    .focused($focused)
                    .onSubmit(submit)

                Button("Look up") { submit() }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .frame(maxWidth: .infinity)
                    .disabled(code.trimmingCharacters(in: .whitespaces).isEmpty)

                Spacer()
            }
            .padding()
            .navigationTitle("Type code")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        if let onCancel {
                            onCancel()
                        } else {
                            dismiss()
                        }
                    }
                }
            }
        }
        .onAppear {
            // Tiny delay so the focus survives the sheet animation.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { focused = true }
        }
    }

    private func submit() {
        let trimmed = code.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        onSubmit(trimmed)
    }
}
