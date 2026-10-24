import SwiftUI
import UIKit

/// Apple Pencil drawing surface. UIKit delivers every Pencil sample through
/// `coalescedTouches(for:)` with its own timestamp, so the recorder sees the
/// pen exactly once per sample (no browser in between). `predictedTouches`
/// only extend the on-screen ink to hide latency; they are never recorded.
/// Fingers, palms, and mice never draw, so touch stays free for the controls.
struct SignatureCanvasView: UIViewRepresentable {
    let strokes: [[SignatureSample]]
    /// Indices of strokes that reach the canvas edge; drawn over in red.
    let clippedStrokes: Set<Int>
    let inkColor: UIColor
    let lineWidth: CGFloat
    let isEnabled: Bool
    /// Whether the recorder accepted the current Pencil stroke (it refuses a
    /// 129th), so the canvas knows which stroke, if any, is still live.
    let hasLiveStroke: Bool
    let onBegin: (SignatureSample) -> Void
    let onAppend: ([SignatureSample]) -> Void
    let onEnd: (_ cancelled: Bool) -> Void
    /// Apple Pencil double-tap or squeeze (when the iPad's Pencil setting is not "Ignore").
    let onPencilUndo: () -> Void

    func makeUIView(context: Context) -> SignatureCanvasUIView {
        let view = SignatureCanvasUIView()
        update(view)
        return view
    }

    func updateUIView(_ view: SignatureCanvasUIView, context: Context) {
        update(view)
    }

    private func update(_ view: SignatureCanvasUIView) {
        view.inkColor = inkColor
        view.lineWidth = lineWidth
        view.isDrawingEnabled = isEnabled
        view.hasLiveStroke = hasLiveStroke
        view.onBegin = onBegin
        view.onAppend = onAppend
        view.onEnd = onEnd
        view.onPencilUndo = onPencilUndo
        view.render(strokes, clipped: clippedStrokes)
    }
}

final class SignatureCanvasUIView: UIView, UIPencilInteractionDelegate {
    var inkColor: UIColor = .black { didSet { applyStyle() } }
    var lineWidth: CGFloat = 4 { didSet { applyStyle() } }
    var isDrawingEnabled = true
    var hasLiveStroke = false
    var onBegin: ((SignatureSample) -> Void)?
    var onAppend: (([SignatureSample]) -> Void)?
    var onEnd: ((Bool) -> Void)?
    var onPencilUndo: (() -> Void)?

    private let inkLayer = CAShapeLayer()
    private let predictionLayer = CAShapeLayer()
    /// Strokes that reach the edge, redrawn in red over the ink.
    private let clippedLayer = CAShapeLayer()
    private weak var activeTouch: UITouch?

    override init(frame: CGRect) {
        super.init(frame: frame)
        isMultipleTouchEnabled = false
        backgroundColor = .clear
        for layer in [inkLayer, predictionLayer, clippedLayer] {
            layer.fillColor = nil
            layer.lineCap = .round
            layer.lineJoin = .round
            self.layer.addSublayer(layer)
        }
        applyStyle()
        let pencil = UIPencilInteraction()
        pencil.delegate = self
        addInteraction(pencil)
        isAccessibilityElement = true
        accessibilityLabel = "Signature area"
        accessibilityHint = "Sign with Apple Pencil."
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func layoutSubviews() {
        super.layoutSubviews()
        inkLayer.frame = bounds
        predictionLayer.frame = bounds
        clippedLayer.frame = bounds
    }

    /// Finished strokes are cached so a long signature does not rebuild every
    /// earlier stroke on each 240 Hz Pencil update; only the live stroke is.
    private var settledPath: CGPath = CGMutablePath()
    private var settledKey: [Int] = []

    func render(_ strokes: [[SignatureSample]], clipped: Set<Int> = []) {
        let settled = hasLiveStroke ? Array(strokes.dropLast()) : strokes
        let key = settled.map(\.count)
        if key != settledKey {
            let path = CGMutablePath()
            for stroke in settled { path.addPath(SignatureCaptureGeometry.path(for: stroke)) }
            settledPath = path
            settledKey = key
        }
        let path = CGMutablePath()
        path.addPath(settledPath)
        if hasLiveStroke, let live = strokes.last { path.addPath(SignatureCaptureGeometry.path(for: live)) }
        inkLayer.path = path
        let alert = CGMutablePath()
        for index in clipped.sorted() where strokes.indices.contains(index) {
            alert.addPath(SignatureCaptureGeometry.path(for: strokes[index]))
        }
        clippedLayer.path = clipped.isEmpty ? nil : alert
        if activeTouch == nil { predictionLayer.path = nil }
    }

    private func applyStyle() {
        for layer in [inkLayer, predictionLayer] {
            layer.strokeColor = inkColor.cgColor
            layer.lineWidth = lineWidth
        }
        clippedLayer.strokeColor = UIColor.systemRed.cgColor
        clippedLayer.lineWidth = lineWidth
    }

    /// Pencil only. The simulator has no Pencil, so simulator builds also
    /// accept direct touches for development; release devices never do.
    private func draws(_ touch: UITouch) -> Bool {
        if touch.type == .pencil { return true }
        #if targetEnvironment(simulator)
        return touch.type == .direct
        #else
        return false
        #endif
    }

    private func sample(_ touch: UITouch) -> SignatureSample {
        let location = touch.preciseLocation(in: self)
        return SignatureSample(x: location.x, y: location.y, time: touch.timestamp)
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard isDrawingEnabled, activeTouch == nil, let touch = touches.first(where: draws) else {
            super.touchesBegan(touches, with: event)
            return
        }
        activeTouch = touch
        onBegin?(sample(touch))
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let touch = activeTouch, touches.contains(touch) else {
            super.touchesMoved(touches, with: event)
            return
        }
        let coalesced = event?.coalescedTouches(for: touch) ?? [touch]
        onAppend?(coalesced.map(sample))
        let predicted = event?.predictedTouches(for: touch) ?? []
        if let last = coalesced.last, !predicted.isEmpty {
            let tail = [sample(last)] + predicted.map(sample)
            predictionLayer.path = SignatureCaptureGeometry.path(for: tail)
        } else {
            predictionLayer.path = nil
        }
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let touch = activeTouch, touches.contains(touch) else {
            super.touchesEnded(touches, with: event)
            return
        }
        onAppend?((event?.coalescedTouches(for: touch) ?? [touch]).map(sample))
        finish(cancelled: false)
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let touch = activeTouch, touches.contains(touch) else {
            super.touchesCancelled(touches, with: event)
            return
        }
        finish(cancelled: true)
    }

    // Double-tap and squeeze undo the last stroke, the common drawing-app
    // shortcut, unless the signer's iPad is set to ignore them.
    func pencilInteraction(_ interaction: UIPencilInteraction, didReceiveTap tap: UIPencilInteraction.Tap) {
        guard UIPencilInteraction.preferredTapAction != .ignore, activeTouch == nil else { return }
        onPencilUndo?()
    }

    func pencilInteraction(_ interaction: UIPencilInteraction, didReceiveSqueeze squeeze: UIPencilInteraction.Squeeze) {
        guard squeeze.phase == .ended, UIPencilInteraction.preferredSqueezeAction != .ignore, activeTouch == nil else { return }
        onPencilUndo?()
    }

    private func finish(cancelled: Bool) {
        activeTouch = nil
        predictionLayer.path = nil
        onEnd?(cancelled)
    }
}
