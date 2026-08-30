import SwiftUI
import AVFoundation
import UIKit

/// Soft pre-prompt shown the first time a user opens the Scan tab.
/// iOS only lets you ask for camera permission once per install, so we frame
/// the value before the system alert appears — this materially improves opt-in.
///
/// Mirrors `PushPrePromptView` in shape; generalize into a reusable
/// `PrePromptScreen(symbol:title:body:bullets:onContinue:)` once a third
/// permission flow is added.
struct ScanPrePromptView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// Called after the user makes a choice on the system permission alert.
    /// `granted` reflects the final authorization decision.
    let onDecision: (_ granted: Bool) -> Void

    @State private var isRequesting = false

    var body: some View {
        ScrollView {
            VStack(spacing: 22) {
                VStack(spacing: 10) {
                    Image(systemName: "barcode.viewfinder")
                        .font(.system(size: 52))
                        .foregroundStyle(Color.brandPrimary)
                        .symbolEffect(.bounce, options: .nonRepeating, isActive: !reduceMotion)
                        .accessibilityHidden(true)

                    Text("Scan to find gear fast")
                        .font(.title2.weight(.bold))

                        Text("Point your camera at a barcode or QR code on a piece of gear to open its record — checked out, reserved, or available.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, 12)
                }

                VStack(spacing: 10) {
                    bullet("archivebox", "Look up gear by sticker code")
                    bullet("calendar.badge.checkmark", "Open the booking it's checked out on")
                    bullet("person.fill", "Find the person who has it")
                }
                .padding(.horizontal, 24)

                VStack(spacing: 10) {
                    Button {
                        Task { await requestSystemPermission() }
                    } label: {
                        Text("Continue")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.glassProminent)
                    .controlSize(.large)
                    .disabled(isRequesting)
                }
                .padding(.horizontal, 24)
            }
            .frame(maxWidth: .infinity)
            .padding(.top, 36)
            .padding(.bottom, 16)
        }
        .scrollBounceBehavior(.basedOnSize)
    }

    private func bullet(_ icon: String, _ text: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.body)
                .foregroundStyle(Color.brandPrimary)
                .frame(width: 28)
                .accessibilityHidden(true)
            Text(text)
                .font(.subheadline)
                .foregroundStyle(.primary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer()
        }
    }

    @MainActor
    private func requestSystemPermission() async {
        isRequesting = true
        let granted = await AVCaptureDevice.requestAccess(for: .video)
        isRequesting = false
        onDecision(granted)
    }
}

/// Recovery view shown when the user previously denied camera access.
/// Provides a clear path to Settings since iOS won't re-prompt.
struct ScanDeniedView: View {
    let onTypeCode: () -> Void

    var body: some View {
        ContentUnavailableView {
            Label("Camera Access Off", systemImage: "camera.badge.exclamationmark")
        } description: {
            Text("Turn on Camera in Settings to scan, or type the sticker code instead.")
        } actions: {
            VStack(spacing: 12) {
                Button {
                    onTypeCode()
                } label: {
                    Label("Type code instead", systemImage: "keyboard")
                }
                .buttonStyle(.glassProminent)

                Button {
                    if let url = URL(string: UIApplication.openSettingsURLString) {
                        UIApplication.shared.open(url)
                    }
                } label: {
                    Label("Open Settings", systemImage: "gear")
                }
                .buttonStyle(.glass)
            }
            .controlSize(.large)
        }
    }
}
