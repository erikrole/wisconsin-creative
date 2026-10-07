#if DEBUG
import SwiftUI

/// Renders the real signature screens against canned payloads for review
/// captures (`GT_PERFORMANCE_SCENARIO=signature-collections|signature-roster|signature-capture`).
/// Names are fictional and the seeded ink is the web's synthetic pen-preview
/// sample (`SIGNATURE_PEN_SAMPLE_STROKES`), never a real signature.
struct SignatureHarnessView: View {
    let scenario: AppRuntimeMode.PerformanceScenario
    @Environment(SessionStore.self) private var session
    @State private var captureVM = SignatureCaptureViewModel(
        collectionId: SignatureFixtures.collectionId,
        memberId: "m-unsigned",
        loadBootstrap: { _, _ in SignatureFixtures.bootstrap },
        save: { _, _, _ in SignatureCaptureResult(status: "committed", captureVersion: 2) }
    )

    var body: some View {
        Group {
            switch scenario {
            case .signatureCollections:
                SignaturesView(
                    viewModel: SignatureCollectionsViewModel(loader: { SignatureFixtures.collections }),
                    rosterLoader: { _ in SignatureFixtures.roster }
                )
            case .signatureRoster:
                NavigationStack {
                    SignatureRosterView(
                        collection: SignatureFixtures.collections[0],
                        viewModel: SignatureRosterViewModel(collectionId: SignatureFixtures.collectionId, loader: { _ in SignatureFixtures.roster })
                    )
                }
            default:
                SignatureCaptureView(
                    collectionId: SignatureFixtures.collectionId,
                    memberId: "m-unsigned",
                    sportTitle: "Men’s Basketball",
                    onSaved: {},
                    viewModel: captureVM
                )
                .task { await seedInk() }
            }
        }
        .onAppear {
            session.currentUser = SignatureFixtures.staffUser
            SignaturePreviewStore.loader = { _ in SignatureFixtures.previewPNG }
        }
    }

    /// Waits for the canvas to lock its logical size, then draws the sample.
    private func seedInk() async {
        for _ in 0..<50 where captureVM.recorder == nil {
            do { try await Task.sleep(for: .milliseconds(100)) } catch { return }
        }
        guard let size = captureVM.recorder?.logicalSize else { return }
        let scale = min(size.width / 760, size.height / 300)
        let dx = (size.width - 760 * scale) / 2
        let dy = (size.height - 300 * scale) / 2
        for stroke in SignatureFixtures.sampleStrokes {
            let samples = stroke.map { SignatureSample(x: dx + ($0.0 - 20) * scale, y: dy + ($0.1 - 20) * scale, time: 0) }
            guard let first = samples.first else { continue }
            captureVM.begin(first)
            captureVM.append(Array(samples.dropFirst()))
            captureVM.end(cancelled: false)
        }
    }
}

enum SignatureFixtures {
    static let collectionId = "fixture-mbb"

    static let staffUser = CurrentUser(
        id: "fixture-staff",
        name: "Bucky Badger",
        email: "bucky.badger@wisc.edu",
        role: "STAFF",
        affiliation: nil,
        collaboratorProfile: nil,
        capabilities: [],
        collaboratorPolicy: nil,
        staffingType: "ST",
        avatarUrl: nil,
        forcePasswordChange: false
    )

    static let collections: [SignatureCollectionSummary] = [
        .init(id: collectionId, sportCode: "MBB", season: "2026-27", status: "OPEN", activeMemberCount: 32,
              completeness: .init(complete: 9, required: 14, percent: 64), staffCompleteness: .init(complete: 7, total: 18)),
        .init(id: "fixture-whky", sportCode: "WHKY", season: "2026-27", status: "OPEN", activeMemberCount: 25,
              completeness: .init(complete: 25, required: 25, percent: 100)),
        .init(id: "fixture-creative", sportCode: "CREATIVE", season: "2026-27", status: "OPEN", activeMemberCount: 14,
              completeness: .init(complete: 6, required: 14, percent: 43)),
    ]

    static let roster = SignatureCollectionDetail(
        id: collectionId, sportCode: "MBB", season: "2026-27", status: "OPEN",
        completeness: .init(complete: 3, required: 5, percent: 60),
        staffCompleteness: .init(complete: 1, total: 2),
        members: [
            member("m1", "Jordan Ellis", 0, "Guard • Senior", "PLAYER", signed: true),
            member("m2", "Marcus Hale", 2, "Guard • Junior", "PLAYER", signed: true),
            member("m-unsigned", "Avery Nakamura", 4, "Forward • Sophomore", "PLAYER", signed: false),
            member("m4", "Theo Brandt", 11, "Guard • Freshman", "PLAYER", signed: false),
            member("m5", "Isaiah Moore", 23, "Center • Senior", "PLAYER", signed: true),
            member("m6", "Coach Dana Wells", nil, "Assistant Coach", "COACHING_STAFF", signed: false, required: false),
            member("m7", "Riley Chen", nil, "Video Coordinator", "SUPPORT_STAFF", signed: true, required: false),
        ]
    )

    static let bootstrap = SignatureCaptureBootstrap(
        collection: .init(id: collectionId, season: "2026-27", status: "OPEN"),
        member: .init(
            id: "m-unsigned", name: "Avery Nakamura", jerseyNumber: 4, title: "Forward • Sophomore", roleGroup: "PLAYER",
            active: true, captureVersion: 1, settingsVersion: 1,
            captureSettings: .init(strokeColor: "#111827", strokeWidth: 4, cropPadding: 24, maxWidth: 1600, maxHeight: 900),
            artifact: nil
        )
    )

    /// The web's synthetic pen-preview sample (src/lib/signatures/geometry.ts).
    static let sampleStrokes: [[(Double, Double)]] = [
        [(60, 150), (70, 110), (90, 80), (115, 62), (140, 60), (155, 75), (150, 100), (130, 120), (108, 132), (95, 145),
         (100, 158), (120, 164), (150, 160), (175, 148), (195, 132), (210, 120), (222, 135), (234, 150), (246, 132), (258, 116),
         (268, 132), (280, 148), (292, 130), (305, 112)],
        [(330, 150), (340, 115), (352, 85), (368, 68), (386, 66), (398, 80), (394, 104), (378, 124), (360, 138), (350, 150),
         (356, 162), (376, 166), (404, 158), (430, 142), (452, 124), (466, 112), (478, 128), (490, 144), (502, 126), (514, 110),
         (526, 126), (538, 142), (552, 124), (566, 106)],
        [(120, 182), (200, 176), (300, 172), (400, 174), (500, 180), (570, 188)],
    ]

    /// The synthetic sample rendered as a transparent PNG, standing in for a
    /// saved artifact on signed fixture rows.
    static var previewPNG: Data {
        let size = CGSize(width: 1000, height: 380)
        let format = UIGraphicsImageRendererFormat()
        format.opaque = false
        format.scale = 1
        return UIGraphicsImageRenderer(size: size, format: format).pngData { context in
            let cg = context.cgContext
            cg.setStrokeColor(UIColor.black.cgColor)
            cg.setLineWidth(9)
            cg.setLineCap(.round)
            cg.setLineJoin(.round)
            for stroke in sampleStrokes {
                let samples = stroke.map { SignatureSample(x: ($0.0 - 40) * 1.75, y: ($0.1 - 40) * 1.75, time: 0) }
                cg.addPath(SignatureCaptureGeometry.path(for: samples))
            }
            cg.strokePath()
        }
    }

    private static func member(
        _ id: String, _ name: String, _ number: Int?, _ title: String, _ group: String, signed: Bool, required: Bool = true
    ) -> SignatureRosterMember {
        SignatureRosterMember(
            id: id, name: name, jerseyNumber: number, title: title, roleGroup: group, required: required, active: true,
            artifact: signed ? SignatureArtifactSummary(id: "a-\(id)") : nil
        )
    }
}
#endif
