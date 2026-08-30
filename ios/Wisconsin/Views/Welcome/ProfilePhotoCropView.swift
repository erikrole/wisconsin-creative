import SwiftUI
import UIKit

struct ProfilePhotoCropView: View {
    let image: UIImage
    let profileName: String
    let onSave: (Data) async -> Bool

    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var zoom = 1.25
    @State private var magnifyOrigin = 1.25
    @State private var offset = CGSize.zero
    @State private var dragOrigin = CGSize.zero
    @State private var preResetAdjustment: CropAdjustmentState?
    @State private var isSaving = false
    @State private var error: String?

    private let cropDiameter: CGFloat = 280

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    Text("Move and zoom until \(profileName)’s face is centered.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)

                    cropPreview

                    VStack(spacing: 18) {
                        adjustmentSlider(
                            title: "Zoom",
                            systemImage: "magnifyingglass",
                            value: zoomBinding,
                            range: 1...3
                        )

                        adjustmentSlider(
                            title: "Left or right",
                            systemImage: "arrow.left.and.right",
                            value: horizontalBinding,
                            range: -1...1
                        )
                        .disabled(maxOffset.width < 1)

                        adjustmentSlider(
                            title: "Up or down",
                            systemImage: "arrow.up.and.down",
                            value: verticalBinding,
                            range: -1...1
                        )
                        .disabled(maxOffset.height < 1)
                    }

                    Button {
                        preResetAdjustment = CropAdjustmentState(
                            zoom: zoom,
                            magnifyOrigin: magnifyOrigin,
                            offset: offset,
                            dragOrigin: dragOrigin
                        )
                        withAnimation(reduceMotion ? nil : .snappy(duration: 0.2)) {
                            zoom = 1.25
                            magnifyOrigin = 1.25
                            offset = .zero
                            dragOrigin = .zero
                        }
                    } label: {
                        Label("Reset crop", systemImage: "arrow.counterclockwise")
                    }
                    .buttonStyle(.borderless)

                    if preResetAdjustment != nil {
                        Button {
                            guard let preResetAdjustment else { return }
                            restore(preResetAdjustment)
                            self.preResetAdjustment = nil
                        } label: {
                            Label("Undo Reset", systemImage: "arrow.uturn.backward")
                        }
                        .buttonStyle(.borderless)
                    }

                    if let error {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
                            .font(.footnote)
                            .foregroundStyle(Color.statusText(.red))
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .padding(24)
                .frame(maxWidth: 600)
                .frame(maxWidth: .infinity)
            }
            .navigationTitle("Crop photo")
            .navigationBarTitleDisplayMode(.inline)
            .interactiveDismissDisabled(isSaving)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .disabled(isSaving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        save()
                    } label: {
                        if isSaving {
                            ProgressView()
                        } else {
                            Text("Save").fontWeight(.semibold)
                        }
                    }
                    .disabled(isSaving)
                }
            }
        }
    }

    private var cropPreview: some View {
        let baseScale = max(cropDiameter / image.size.width, cropDiameter / image.size.height)
        return Image(uiImage: image)
            .resizable()
            .interpolation(.high)
            .frame(
                width: image.size.width * baseScale * zoom,
                height: image.size.height * baseScale * zoom
            )
            .offset(offset)
            .frame(width: cropDiameter, height: cropDiameter)
            .clipShape(Circle())
            .overlay(Circle().stroke(Color.primary.opacity(0.22), lineWidth: 2))
            .shadow(color: .black.opacity(0.14), radius: 16, y: 8)
            .contentShape(Circle())
            .gesture(
                DragGesture()
                    .onChanged { value in
                        offset = clamped(
                            CGSize(
                                width: dragOrigin.width + value.translation.width,
                                height: dragOrigin.height + value.translation.height
                            )
                        )
                    }
                    .onEnded { _ in dragOrigin = offset }
            )
            .simultaneousGesture(
                MagnifyGesture()
                    .onChanged { value in
                        zoom = min(max(magnifyOrigin * value.magnification, 1), 3)
                    }
                    .onEnded { _ in magnifyOrigin = zoom }
            )
            .accessibilityLabel("Profile photo crop preview")
            .accessibilityHint("Drag the image or use the adjustment controls below.")
            .onChange(of: zoom) { _, _ in
                offset = clamped(offset)
                dragOrigin = offset
            }
    }

    private var maxOffset: CGSize {
        let baseScale = max(cropDiameter / image.size.width, cropDiameter / image.size.height)
        return CGSize(
            width: max(0, (image.size.width * baseScale * zoom - cropDiameter) / 2),
            height: max(0, (image.size.height * baseScale * zoom - cropDiameter) / 2)
        )
    }

    private var horizontalBinding: Binding<Double> {
        Binding(
            get: { maxOffset.width > 0 ? Double(offset.width / maxOffset.width) : 0 },
            set: {
                offset.width = CGFloat($0) * maxOffset.width
                dragOrigin = offset
            }
        )
    }

    private var zoomBinding: Binding<Double> {
        Binding(
            get: { zoom },
            set: {
                zoom = $0
                magnifyOrigin = $0
            }
        )
    }

    private var verticalBinding: Binding<Double> {
        Binding(
            get: { maxOffset.height > 0 ? Double(offset.height / maxOffset.height) : 0 },
            set: {
                offset.height = CGFloat($0) * maxOffset.height
                dragOrigin = offset
            }
        )
    }

    private func adjustmentSlider(
        title: String,
        systemImage: String,
        value: Binding<Double>,
        range: ClosedRange<Double>
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(title, systemImage: systemImage)
                .font(.subheadline.weight(.medium))
            Slider(value: value, in: range)
                .accessibilityLabel(title)
                .accessibilityValue(accessibilityValue(for: title, value: value.wrappedValue))
            HStack {
                Text(endpointLabel(for: title, isMinimum: true))
                Spacer()
                Text(endpointLabel(for: title, isMinimum: false))
            }
            .font(.caption2)
            .foregroundStyle(.secondary)
            .accessibilityHidden(true)
        }
    }

    private func endpointLabel(for title: String, isMinimum: Bool) -> String {
        switch title {
        case "Zoom": return isMinimum ? "1×" : "3×"
        case "Left or right": return isMinimum ? "Left" : "Right"
        case "Up or down": return isMinimum ? "Up" : "Down"
        default: return isMinimum ? "Minimum" : "Maximum"
        }
    }

    private func accessibilityValue(for title: String, value: Double) -> String {
        switch title {
        case "Zoom": return "\(Int(value * 100)) percent"
        case "Left or right":
            if abs(value) < 0.05 { return "Centered" }
            return value < 0 ? "Left" : "Right"
        case "Up or down":
            if abs(value) < 0.05 { return "Centered" }
            return value < 0 ? "Up" : "Down"
        default: return String(format: "%.0f", value)
        }
    }

    private func restore(_ adjustment: CropAdjustmentState) {
        withAnimation(reduceMotion ? nil : .snappy(duration: 0.2)) {
            zoom = adjustment.zoom
            magnifyOrigin = adjustment.magnifyOrigin
            offset = adjustment.offset
            dragOrigin = adjustment.dragOrigin
        }
    }

    private func clamped(_ candidate: CGSize) -> CGSize {
        CGSize(
            width: min(max(candidate.width, -maxOffset.width), maxOffset.width),
            height: min(max(candidate.height, -maxOffset.height), maxOffset.height)
        )
    }

    private func save() {
        guard !isSaving else { return }
        error = nil
        isSaving = true
        Task {
            guard let data = await NativeImageProcessor.croppedJPEGData(
                image: image,
                cropDiameter: cropDiameter,
                zoom: zoom,
                offset: offset
            ) else {
                isSaving = false
                error = "The selected photo could not be cropped. Choose another photo and try again."
                return
            }
            let saved = await onSave(data)
            isSaving = false
            if !saved {
                error = "The photo could not be saved. Check your connection and try again."
                Haptics.error()
            } else {
                Haptics.success()
                dismiss()
            }
        }
    }
}

private struct CropAdjustmentState: Equatable {
    let zoom: CGFloat
    let magnifyOrigin: CGFloat
    let offset: CGSize
    let dragOrigin: CGSize
}
