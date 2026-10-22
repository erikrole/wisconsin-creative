import SwiftUI
import UIKit

struct ProfilePhotoCropView: View {
    let image: UIImage
    let profileName: String
    var saveFailureMessage: () -> String? = { nil }
    let onSave: (Data) async -> Bool

    @Environment(\.dismiss) private var dismiss
    @State private var adjustment = AvatarCropAdjustment()
    @State private var isSaving = false
    @State private var error: String?

    private let cropDiameter: CGFloat = 280

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    Text("Drag to move. Pinch to zoom.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)

                    AvatarCropCanvas(image: image, cropDiameter: cropDiameter, adjustment: $adjustment, isSaving: isSaving)
                        .frame(width: 320, height: 320)
                        .clipShape(RoundedRectangle(cornerRadius: 16))
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel("\(profileName)’s profile photo crop preview")
                        .accessibilityIdentifier("profile-photo-crop")
                        .accessibilityValue("\(Int(adjustment.zoom * 100)) percent zoom")
                        .accessibilityHint("Swipe up or down to zoom. Use Actions to move the photo or reset.")
                        .accessibilityAdjustableAction { direction in
                            guard !isSaving else { return }
                            switch direction {
                            case .increment: adjustment.zoom = min(adjustment.zoom + 0.15, 3)
                            case .decrement: adjustment.zoom = max(adjustment.zoom - 0.15, 1)
                            @unknown default: break
                            }
                        }
                        .accessibilityAction(named: "Move left") { movePhoto(x: -20) }
                        .accessibilityAction(named: "Move right") { movePhoto(x: 20) }
                        .accessibilityAction(named: "Move up") { movePhoto(y: -20) }
                        .accessibilityAction(named: "Move down") { movePhoto(y: 20) }
                        .accessibilityAction(named: "Reset crop") { resetCrop() }

                    Button(action: resetCrop) {
                        Label("Reset", systemImage: "arrow.counterclockwise")
                    }
                    .buttonStyle(.borderless)
                    .disabled(adjustment.isCentered)

                    if let error {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
                            .font(.footnote)
                            .foregroundStyle(Color.statusText(.red))
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .accessibilityAddTraits(.updatesFrequently)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 24)
                .frame(maxWidth: 600)
                .frame(maxWidth: .infinity)
                .disabled(isSaving)
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
                    Button { save() } label: {
                        if isSaving { ProgressView() }
                        else { Text("Save").fontWeight(.semibold) }
                    }
                    .disabled(isSaving)
                }
            }
        }
    }

    private func resetCrop() {
        guard !isSaving else { return }
        adjustment = AvatarCropAdjustment()
    }

    private func movePhoto(x: CGFloat = 0, y: CGFloat = 0) {
        guard !isSaving else { return }
        adjustment.offset.width += x
        adjustment.offset.height += y
    }

    private func save() {
        guard !isSaving else { return }
        error = nil
        isSaving = true
        Task {
            guard let data = await NativeImageProcessor.croppedJPEGData(
                image: image,
                cropDiameter: cropDiameter,
                zoom: adjustment.zoom,
                offset: adjustment.offset
            ) else {
                isSaving = false
                error = "The selected photo could not be cropped. Choose another photo and try again."
                return
            }
            let saved = await onSave(data)
            isSaving = false
            if !saved {
                error = saveFailureMessage() ?? "The photo could not be saved. Check your connection and try again."
                Haptics.error()
            } else {
                Haptics.success()
                dismiss()
            }
        }
    }
}

private struct AvatarCropAdjustment: Equatable {
    var zoom: CGFloat = 1
    var offset: CGSize = .zero
    var isCentered: Bool { abs(zoom - 1) < 0.001 && abs(offset.width) < 0.01 && abs(offset.height) < 0.01 }

    func matches(_ other: Self) -> Bool {
        abs(zoom - other.zoom) < 0.001 && abs(offset.width - other.offset.width) < 0.01 && abs(offset.height - other.offset.height) < 0.01
    }
}

/// UIScrollView supplies system pan/pinch recognition and keeps the point under
/// the fingers anchored while zooming. The inset constrains the circular crop.
private struct AvatarCropCanvas: UIViewRepresentable {
    let image: UIImage
    let cropDiameter: CGFloat
    @Binding var adjustment: AvatarCropAdjustment
    let isSaving: Bool

    func makeUIView(context: Context) -> AvatarCropScrollView {
        AvatarCropScrollView(image: image, cropDiameter: cropDiameter)
    }

    func updateUIView(_ view: AvatarCropScrollView, context: Context) {
        view.isUserInteractionEnabled = !isSaving
        view.onChange = { value in
            guard !isSaving else { return }
            adjustment = value
        }
        if !view.currentAdjustment.matches(adjustment) {
            let clamped = view.apply(adjustment)
            // A VoiceOver move/zoom can exceed an edge. Reflect the actual crop
            // after the SwiftUI update completes, without interrupting gestures.
            if !clamped.matches(adjustment) {
                let expected = adjustment
                DispatchQueue.main.async {
                    if !isSaving && adjustment.matches(expected) { adjustment = clamped }
                }
            }
        }
    }
}

private final class AvatarCropScrollView: UIView, UIScrollViewDelegate {
    let scrollView = UIScrollView()
    let imageView: UIImageView
    let cropDiameter: CGFloat
    var onChange: ((AvatarCropAdjustment) -> Void)?
    private let shade = CAShapeLayer()
    private let guide = CAShapeLayer()
    private let overlay = UIView()
    private var laidOutSize = CGSize.zero
    private var applying = false

    init(image: UIImage, cropDiameter: CGFloat) {
        imageView = UIImageView(image: image)
        self.cropDiameter = cropDiameter
        super.init(frame: .zero)
        backgroundColor = .black
        scrollView.delegate = self
        scrollView.minimumZoomScale = 1
        scrollView.maximumZoomScale = 3
        scrollView.bounces = false
        scrollView.bouncesZoom = false
        scrollView.showsHorizontalScrollIndicator = false
        scrollView.showsVerticalScrollIndicator = false
        scrollView.contentInsetAdjustmentBehavior = .never
        scrollView.decelerationRate = .fast
        scrollView.addSubview(imageView)
        addSubview(scrollView)
        overlay.isUserInteractionEnabled = false
        shade.fillRule = .evenOdd
        shade.fillColor = UIColor.black.withAlphaComponent(0.55).cgColor
        guide.fillColor = UIColor.clear.cgColor
        guide.strokeColor = UIColor.white.withAlphaComponent(0.9).cgColor
        guide.lineWidth = 2
        overlay.layer.addSublayer(shade)
        overlay.layer.addSublayer(guide)
        addSubview(overlay)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func layoutSubviews() {
        super.layoutSubviews()
        guard bounds.width > 0, bounds.height > 0, bounds.size != laidOutSize, let image = imageView.image else { return }
        let previous = currentAdjustment
        applying = true
        scrollView.frame = bounds
        overlay.frame = bounds
        let insetX = (bounds.width - cropDiameter) / 2
        let insetY = (bounds.height - cropDiameter) / 2
        scrollView.contentInset = UIEdgeInsets(top: insetY, left: insetX, bottom: insetY, right: insetX)
        scrollView.zoomScale = 1
        let scale = max(cropDiameter / image.size.width, cropDiameter / image.size.height)
        imageView.frame = CGRect(origin: .zero, size: CGSize(width: image.size.width * scale, height: image.size.height * scale))
        scrollView.contentSize = imageView.frame.size
        let circle = CGRect(x: insetX, y: insetY, width: cropDiameter, height: cropDiameter)
        let mask = UIBezierPath(rect: bounds)
        mask.append(UIBezierPath(ovalIn: circle))
        shade.path = mask.cgPath
        guide.path = UIBezierPath(ovalIn: circle).cgPath
        laidOutSize = bounds.size
        applying = false
        _ = apply(previous)
    }

    var currentAdjustment: AvatarCropAdjustment {
        guard laidOutSize != .zero else { return AvatarCropAdjustment() }
        return AvatarCropAdjustment(zoom: scrollView.zoomScale, offset: CGSize(
            width: (scrollView.contentSize.width - bounds.width) / 2 - scrollView.contentOffset.x,
            height: (scrollView.contentSize.height - bounds.height) / 2 - scrollView.contentOffset.y
        ))
    }

    @discardableResult func apply(_ value: AvatarCropAdjustment) -> AvatarCropAdjustment {
        guard laidOutSize != .zero else { return value }
        applying = true
        scrollView.setZoomScale(min(max(value.zoom, 1), 3), animated: false)
        let inset = scrollView.contentInset
        let center = CGPoint(x: (scrollView.contentSize.width - bounds.width) / 2, y: (scrollView.contentSize.height - bounds.height) / 2)
        scrollView.setContentOffset(CGPoint(
            x: min(max(center.x - value.offset.width, -inset.left), scrollView.contentSize.width - bounds.width + inset.right),
            y: min(max(center.y - value.offset.height, -inset.top), scrollView.contentSize.height - bounds.height + inset.bottom)
        ), animated: false)
        applying = false
        return currentAdjustment
    }

    func viewForZooming(in scrollView: UIScrollView) -> UIView? { imageView }
    func scrollViewDidScroll(_ scrollView: UIScrollView) { reportAdjustment() }
    func scrollViewDidZoom(_ scrollView: UIScrollView) { reportAdjustment() }
    private func reportAdjustment() {
        guard !applying, laidOutSize != .zero else { return }
        onChange?(currentAdjustment)
    }
}
