import SwiftUI
import VisionKit
import AVFoundation
import UIKit

/// Sheet-presented camera fallback for kiosk flows when a HID hand scanner
/// is unavailable (unplugged, dead battery, or staff is using the iPad on
/// the floor at an event). Reuses Apple's DataScannerViewController; falls
/// back to a clear permission-needed message when the camera is denied.
struct KioskBarcodeCameraView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.openURL) private var openURL
    // Scan feedback uses the shared `KioskBannerTone` so any flow (checkout,
    // pickup, return) can pipe its own message + tone in without coupling types.
    let feedbackMessage: String?
    let feedbackTone: KioskBannerTone?
    let onScan: (String) -> Void
    let onCancel: () -> Void

    @State private var permissionState: PermissionState = .checking
    @State private var manualCode = ""

    init(
        feedbackMessage: String? = nil,
        feedbackTone: KioskBannerTone? = nil,
        onScan: @escaping (String) -> Void,
        onCancel: @escaping () -> Void
    ) {
        self.feedbackMessage = feedbackMessage
        self.feedbackTone = feedbackTone
        self.onScan = onScan
        self.onCancel = onCancel
    }

    enum PermissionState {
        case checking
        case authorized
        case denied
        case unsupported
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            switch permissionState {
            case .checking:
                ProgressView().tint(.white).scaleEffect(1.4)
            case .authorized:
                if DataScannerViewController.isSupported && DataScannerViewController.isAvailable {
                    KioskDataScannerRepresentable(onScan: { value in
                        Haptics.success()
                        onScan(value)
                    })
                    .ignoresSafeArea()
                    .overlay(alignment: .top) { header }
                    .overlay(alignment: .bottom) {
                        VStack(spacing: 12) {
                            feedbackOverlay
                            manualEntry
                        }
                        .padding(.bottom, 32)
                    }
                } else {
                    unsupportedView
                }
            case .denied:
                deniedView
            case .unsupported:
                unsupportedView
            }
        }
        .task { await checkPermission() }
    }

    @ViewBuilder
    private var feedbackOverlay: some View {
        if let message = feedbackMessage, let tone = feedbackTone {
            KioskFeedbackBanner(tone: tone, message: message)
                .transition(reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity))
                .animation(reduceMotion ? nil : .spring(response: 0.3, dampingFraction: 1), value: feedbackMessage)
        }
    }

    private var header: some View {
        HStack {
            Button {
                onCancel()
            } label: {
                Label("Close", systemImage: "xmark")
                    .font(.headline)
                    .foregroundStyle(.white)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(KioskScrim.control, in: Capsule())
            }
            Spacer()
            Text("Aim camera at barcode or QR")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.white)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(KioskScrim.control, in: Capsule())
            Spacer()
            Spacer().frame(width: 80)
        }
        .padding()
    }

    private var deniedView: some View {
        VStack(spacing: 16) {
            Image(systemName: "camera.fill")
                .font(.system(size: 56))
                .foregroundStyle(.secondary)
            Text("Camera access required")
                .font(.title3.bold())
                .foregroundStyle(.white)
            Text("Enable camera access in Settings to scan with the iPad camera.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
            manualEntry
                .padding(.horizontal, 40)
            HStack(spacing: 12) {
                Button("Open Settings") {
                    if let url = URL(string: UIApplication.openSettingsURLString) {
                        openURL(url)
                    }
                }
                .kioskButtonRole(.primary)
                .tint(Color.kioskRed)
                Button("Close") { onCancel() }
                    .kioskButtonRole(.secondary)
            }
            .controlSize(.large)
        }
    }

    private var unsupportedView: some View {
        VStack(spacing: 16) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 56))
                .foregroundStyle(Color.statusText(.orange))
            Text("Camera scanning unavailable")
                .font(.title3.bold())
                .foregroundStyle(.white)
            Text("Use the hand scanner or type the barcode below.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            manualEntry
                .padding(.horizontal, 40)
            Button("Close") { onCancel() }
                .foregroundStyle(.white)
                .padding(.horizontal, 28)
                .padding(.vertical, 12)
                .background(Color.kioskRed, in: Capsule())
        }
    }

    private func checkPermission() async {
        guard DataScannerViewController.isSupported else {
            permissionState = .unsupported
            return
        }
        let status = AVCaptureDevice.authorizationStatus(for: .video)
        switch status {
        case .authorized:
            permissionState = .authorized
        case .notDetermined:
            let granted = await AVCaptureDevice.requestAccess(for: .video)
            permissionState = granted ? .authorized : .denied
        case .denied, .restricted:
            permissionState = .denied
        @unknown default:
            permissionState = .denied
        }
    }

    private var manualEntry: some View {
        HStack(spacing: 10) {
            TextField("Type barcode or unit QR", text: $manualCode)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.go)
                .textFieldStyle(.roundedBorder)
                .onSubmit(submitManualCode)
                .accessibilityLabel("Type barcode or unit QR")
            Button(action: submitManualCode) {
                Label("Submit", systemImage: "keyboard")
                    .font(.subheadline.weight(.semibold))
            }
            .disabled(manualCode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .foregroundStyle(.white)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(Color.kioskRed, in: Capsule())
        }
        .padding(12)
        .background(KioskScrim.field, in: RoundedRectangle(cornerRadius: KioskRadius.lg))
        .padding(.horizontal, 24)
        .accessibilityElement(children: .contain)
    }

    private func submitManualCode() {
        let value = manualCode.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return }
        manualCode = ""
        Haptics.warning()
        onScan(value)
    }
}

private struct KioskDataScannerRepresentable: UIViewControllerRepresentable {
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

    func updateUIViewController(_ vc: DataScannerViewController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(onScan: onScan) }

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        let onScan: (String) -> Void
        private var lastScan: String?
        private var lastScanAt: Date = .distantPast

        init(onScan: @escaping (String) -> Void) { self.onScan = onScan }

        func dataScanner(_ scanner: DataScannerViewController, didTapOn item: RecognizedItem) {
            if case .barcode(let barcode) = item, let value = barcode.payloadStringValue {
                emit(value)
            }
        }

        func dataScanner(_ scanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) {
            guard let item = addedItems.first, case .barcode(let barcode) = item,
                  let value = barcode.payloadStringValue else { return }
            emit(value)
        }

        // Simple debounce — same value within 1.5s is dropped.
        private func emit(_ value: String) {
            let now = Date()
            if value == lastScan, now.timeIntervalSince(lastScanAt) < 1.5 { return }
            lastScan = value
            lastScanAt = now
            onScan(value)
        }
    }
}
