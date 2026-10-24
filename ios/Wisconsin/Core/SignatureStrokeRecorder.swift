import CoreGraphics
import Foundation

/// One Apple Pencil sample in logical signature space (points, the same scale
/// the web capture page uses for CSS pixels), with the UIKit touch timestamp.
/// The timestamp stays on device for now; the save contract sends `x`/`y` only.
struct SignatureSample: Equatable, Sendable {
    var x: Double
    var y: Double
    var time: TimeInterval
}

/// Pure stroke state for native signature capture. It owns the sample rules the
/// server relies on so they are unit-testable without UIKit:
/// - samples are clamped to the logical canvas, and a stroke that reaches the
///   edge counts as clipped (the clamp flattens whatever ran past it), so the
///   capture blocks Save until that stroke is undone or cleared,
/// - exact consecutive duplicates and exact back-to-back repeated sample runs
///   are dropped (the same rule as `src/lib/signatures/capture.ts`; Safari
///   delivered whole Pencil batches twice and every 2026-27 capture retraced
///   about a third of its length),
/// - the wire payload is rounded to 3 decimals and bounded to the server limits.
struct SignatureStrokeRecorder: Sendable {
    static let maxStrokes = 128
    static let maxSamplesPerStroke = 10_000
    static let maxRepeatedRun = 64
    /// Points within this distance of the canvas edge count as touching it.
    static let edgeTolerance = 1.0

    let logicalSize: CGSize
    private(set) var strokes: [[SignatureSample]] = []
    private(set) var isDrawing = false

    init(logicalSize: CGSize) {
        self.logicalSize = logicalSize
    }

    var isEmpty: Bool { strokes.isEmpty }

    /// True when any stroke reaches the canvas edge, i.e. the signature is clipped.
    var isClipped: Bool { strokes.contains(where: touchesEdge) }

    func touchesEdge(_ stroke: [SignatureSample]) -> Bool {
        let maxX = Double(logicalSize.width) - Self.edgeTolerance
        let maxY = Double(logicalSize.height) - Self.edgeTolerance
        return stroke.contains { $0.x <= Self.edgeTolerance || $0.y <= Self.edgeTolerance || $0.x >= maxX || $0.y >= maxY }
    }
    var canStartStroke: Bool { strokes.count < Self.maxStrokes }

    /// Starts a stroke; returns false at the stroke limit.
    @discardableResult
    mutating func begin(_ sample: SignatureSample) -> Bool {
        guard canStartStroke else { return false }
        strokes.append([clamped(sample)])
        isDrawing = true
        return true
    }

    /// Appends coalesced samples to the stroke being drawn. Returns false when
    /// the stroke is at the server's per-stroke sample limit and samples were
    /// dropped, so the caller can tell the signer to lift and continue.
    @discardableResult
    mutating func append(_ samples: [SignatureSample]) -> Bool {
        guard isDrawing, var stroke = strokes.popLast() else { return true }
        var dropped = false
        for sample in samples {
            guard stroke.count < Self.maxSamplesPerStroke else { dropped = true; break }
            Self.push(clamped(sample), onto: &stroke)
        }
        strokes.append(stroke)
        return !dropped
    }

    mutating func end() {
        isDrawing = false
    }

    /// Pencil input was interrupted; the partial stroke is kept, as on the web.
    mutating func cancel() {
        isDrawing = false
    }

    mutating func undo() {
        guard !isDrawing, !strokes.isEmpty else { return }
        strokes.removeLast()
    }

    mutating func clear() {
        strokes.removeAll()
        isDrawing = false
    }

    /// Replaces the finished strokes (redo and undo-of-clear restore through here).
    mutating func setStrokes(_ restored: [[SignatureSample]]) {
        guard !isDrawing else { return }
        strokes = Array(restored.prefix(Self.maxStrokes))
    }

    /// The save payload: points only, rounded to the 3 decimals the server keeps.
    var payload: [SignatureStrokePayload] {
        strokes.map { stroke in
            SignatureStrokePayload(points: stroke.map { SignaturePointPayload(x: Self.round3($0.x), y: Self.round3($0.y)) })
        }
    }

    private func clamped(_ sample: SignatureSample) -> SignatureSample {
        SignatureSample(
            x: min(max(sample.x, 0), Double(logicalSize.width)),
            y: min(max(sample.y, 0), Double(logicalSize.height)),
            time: sample.time
        )
    }

    /// Appends one sample, then drops a run that now repeats the run right
    /// before it exactly (A B A B -> A B). Run length 1 is a plain duplicate.
    static func push(_ sample: SignatureSample, onto stroke: inout [SignatureSample]) {
        stroke.append(sample)
        let maxRun = min(maxRepeatedRun, stroke.count / 2)
        guard maxRun > 0 else { return }
        for run in 1...maxRun {
            let end = stroke.count
            var repeated = true
            for offset in 1...run where !samePosition(stroke[end - offset], stroke[end - run - offset]) {
                repeated = false
                break
            }
            if repeated {
                stroke.removeLast(run)
                return
            }
        }
    }

    private static func samePosition(_ a: SignatureSample, _ b: SignatureSample) -> Bool {
        a.x == b.x && a.y == b.y
    }

    private static func round3(_ value: Double) -> Double {
        (value * 1_000).rounded() / 1_000
    }
}

struct SignaturePointPayload: Encodable, Equatable, Sendable {
    let x: Double
    let y: Double
}

struct SignatureStrokePayload: Encodable, Equatable, Sendable {
    let points: [SignaturePointPayload]
}

enum SignatureCaptureGeometry {
    /// Logical drawing size for a canvas view. Points never leave this box, so
    /// the server's crop (ink extent + rendered width + padding on both sides)
    /// always fits `maxWidth` x `maxHeight`. The rendered width can reach twice
    /// the configured width, and crop bounds round outward by a point per side.
    static func logicalSize(available: CGSize, settings: SignatureCaptureSettings) -> CGSize {
        let margin = 2 * settings.strokeWidth + 2 * settings.cropPadding + 4
        return CGSize(
            width: max(1, min(Double(available.width), Double(settings.maxWidth) - margin)).rounded(.down),
            height: max(1, min(Double(available.height), Double(settings.maxHeight) - margin)).rounded(.down)
        )
    }

    /// The same curve the server writes into the SVG: a quadratic through the
    /// midpoints of consecutive samples, so on-screen ink matches the artifact.
    static func path(for stroke: [SignatureSample]) -> CGPath {
        let path = CGMutablePath()
        guard let first = stroke.first else { return path }
        let point = { (sample: SignatureSample) in CGPoint(x: sample.x, y: sample.y) }
        path.move(to: point(first))
        if stroke.count == 1 {
            path.addLine(to: point(first))
            return path
        }
        if stroke.count == 2 {
            path.addLine(to: point(stroke[1]))
            return path
        }
        for index in 1..<(stroke.count - 1) {
            let control = stroke[index]
            let next = stroke[index + 1]
            path.addQuadCurve(
                to: CGPoint(x: (control.x + next.x) / 2, y: (control.y + next.y) / 2),
                control: point(control)
            )
        }
        let last = point(stroke[stroke.count - 1])
        path.addQuadCurve(to: last, control: last)
        return path
    }
}

enum SignatureReplay {
    /// Longest pen lift kept in a replay; a signer pausing to think should not
    /// leave the replay sitting on a blank stretch.
    static let maxLift: TimeInterval = 0.5

    /// Each sample's replay time: real Pencil timing within strokes, with pen
    /// lifts between strokes capped at `maxLift`.
    static func timeline(_ strokes: [[SignatureSample]]) -> [[TimeInterval]] {
        var clock: TimeInterval = 0
        var previousEnd: TimeInterval?
        return strokes.map { stroke in
            guard let first = stroke.first else { return [] }
            if let previousEnd { clock += min(max(first.time - previousEnd, 0), maxLift) }
            let times = stroke.map { clock + max($0.time - first.time, 0) }
            clock = times.last ?? clock
            previousEnd = stroke.last?.time
            return times
        }
    }

    /// The strokes as drawn `elapsed` seconds into the replay.
    static func strokes(_ strokes: [[SignatureSample]], timeline: [[TimeInterval]], at elapsed: TimeInterval) -> [[SignatureSample]] {
        zip(strokes, timeline).compactMap { stroke, times in
            let count = times.prefix { $0 <= elapsed }.count
            return count == 0 ? nil : Array(stroke.prefix(count))
        }
    }

    static func duration(_ timeline: [[TimeInterval]]) -> TimeInterval {
        timeline.last?.last ?? 0
    }
}

enum SignatureSaveRetry {
    /// Mirrors `shouldRetainSignatureSaveRequestId` on the web: an ambiguous
    /// failure (network, 425 still saving, 429, 5xx) replays the same request ID
    /// so the server can finish or return the original result; any other
    /// failure needs a new ID because the server will not accept the old one.
    static func retainsRequestID(after error: Error) -> Bool {
        switch error as? APIError {
        case .networkError, .serverError, .decodingError:
            return true
        case .httpError(let statusCode, _):
            return statusCode == 425 || statusCode == 429 || statusCode >= 500
        case .unauthorized, .sessionChanged, .notFound, .conflict, .inviteLinkRequired, nil:
            return false
        }
    }
}
