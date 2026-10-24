import SwiftUI

// MARK: - View model

@MainActor
@Observable
final class SignatureCaptureViewModel {
    typealias BootstrapLoader = @MainActor (_ collectionId: String, _ memberId: String) async throws -> SignatureCaptureBootstrap
    typealias Saver = @MainActor (_ collectionId: String, _ memberId: String, SignatureCaptureRequest) async throws -> SignatureCaptureResult

    let collectionId: String
    let memberId: String
    private(set) var bootstrap: SignatureCaptureBootstrap?
    private(set) var recorder: SignatureStrokeRecorder?
    private(set) var isLoading = false
    private(set) var isSaving = false
    private(set) var didSave = false
    var loadError: String?
    var saveError: String?
    var notice: String?

    @ObservationIgnored private let loadBootstrap: BootstrapLoader
    @ObservationIgnored private let save: Saver
    /// Kept across ambiguous failures so a replay reaches the same server
    /// operation; replaced after any failure the server will not replay.
    @ObservationIgnored private var requestId: String?

    init(
        collectionId: String,
        memberId: String,
        loadBootstrap: @escaping BootstrapLoader = { try await APIClient.shared.signatureCaptureBootstrap(collectionId: $0, memberId: $1) },
        save: @escaping Saver = { try await APIClient.shared.saveSignatureCapture(collectionId: $0, memberId: $1, body: $2) }
    ) {
        self.collectionId = collectionId
        self.memberId = memberId
        self.loadBootstrap = loadBootstrap
        self.save = save
    }

    var settings: SignatureCaptureSettings? { bootstrap?.member.captureSettings }
    var hasInk: Bool { !(recorder?.isEmpty ?? true) }
    /// A stroke reached the canvas edge, so part of the signature is cut off.
    var isClipped: Bool { recorder?.isClipped ?? false }
    var canSave: Bool {
        hasInk && !isClipped && isEditable && bootstrap?.collection.status == "OPEN" && bootstrap?.member.active == true
    }

    /// Set when a save lost to another iPad (409) and the signer was reloaded:
    /// the next save would replace that iPad's signature, so it needs an
    /// explicit confirmation instead of one more tap on Save.
    private(set) var needsReplaceConfirmation = false

    func load() async {
        guard bootstrap == nil, !isLoading else { return }
        await reload()
    }

    /// Reloads the member without touching the ink, so a stale-version or
    /// settings conflict can be saved again after a fresh bootstrap.
    func reload() async {
        isLoading = true
        defer { isLoading = false }
        do {
            bootstrap = try await loadBootstrap(collectionId, memberId)
            loadError = nil
        } catch {
            loadError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    /// Locks the logical drawing space the first time the canvas has a size,
    /// like the web page. Rotation letterboxes this box rather than changing it.
    func prepareCanvas(available: CGSize) {
        guard recorder == nil, let settings, available.width > 0, available.height > 0 else { return }
        recorder = SignatureStrokeRecorder(logicalSize: SignatureCaptureGeometry.logicalSize(available: available, settings: settings))
    }

    func begin(_ sample: SignatureSample) {
        guard !isSaving, !didSave else { return }
        stopReplay()
        if recorder?.begin(sample) == false {
            notice = "This signature has reached \(SignatureStrokeRecorder.maxStrokes) strokes."
            Haptics.warning()
            return
        }
        // A new stroke starts a new history branch, as on the web.
        redoStack.removeAll()
        clearedStrokes = nil
        saveError = nil
        notice = nil
        requestId = nil
    }

    func append(_ samples: [SignatureSample]) {
        guard var recorder else { return }
        let complete = recorder.append(samples)
        self.recorder = recorder
        if !complete, notice == nil {
            notice = "This stroke is at its length limit. Lift the Pencil and keep signing."
            Haptics.warning()
        }
    }

    func end(cancelled: Bool) {
        if cancelled {
            recorder?.cancel()
            notice = "Pencil input was interrupted; the partial stroke was kept."
        } else {
            recorder?.end()
            if let recorder, let stroke = recorder.strokes.last, recorder.touchesEdge(stroke) {
                Haptics.warning()
            }
        }
    }

    /// Indices of the strokes that reach the canvas edge, drawn in red so the
    /// signer sees exactly which stroke Undo will remove.
    func clippedStrokeIndices(in strokes: [[SignatureSample]]) -> Set<Int> {
        guard let recorder else { return [] }
        return Set(strokes.indices.filter { recorder.touchesEdge(strokes[$0]) })
    }

    // MARK: History (web parity: undo, redo, and an undoable Clear)

    private(set) var redoStack: [[SignatureSample]] = []
    private(set) var clearedStrokes: [[SignatureSample]]?

    private var isEditable: Bool { !isSaving && !didSave && recorder?.isDrawing == false }
    var canUndo: Bool { isEditable && (hasInk || clearedStrokes != nil) }
    var canRedo: Bool { isEditable && !redoStack.isEmpty }
    var canClear: Bool { isEditable && hasInk }

    func undo() {
        guard canUndo, var recorder else { return }
        stopReplay()
        if !recorder.isEmpty {
            redoStack.append(recorder.strokes[recorder.strokes.count - 1])
            recorder.undo()
        } else if let cleared = clearedStrokes {
            recorder.setStrokes(cleared)
            clearedStrokes = nil
        }
        self.recorder = recorder
        requestId = nil
        Haptics.selection()
    }

    func redo() {
        guard canRedo, var recorder, let stroke = redoStack.popLast() else { return }
        stopReplay()
        recorder.setStrokes(recorder.strokes + [stroke])
        self.recorder = recorder
        requestId = nil
        Haptics.selection()
    }

    func clear() {
        guard canClear, var recorder else { return }
        stopReplay()
        clearedStrokes = recorder.strokes
        redoStack.removeAll()
        recorder.clear()
        self.recorder = recorder
        requestId = nil
        saveError = nil
        Haptics.selection()
    }

    // MARK: Replay (the signer's real Pencil timing, before saving)

    private(set) var replayStartedAt: Date?
    @ObservationIgnored private var replayTimeline: [[TimeInterval]] = []

    var isReplaying: Bool { replayStartedAt != nil }
    var canReplay: Bool { isEditable && hasInk }

    func toggleReplay() {
        if isReplaying { stopReplay(); return }
        guard canReplay, let recorder else { return }
        replayTimeline = SignatureReplay.timeline(recorder.strokes)
        replayStartedAt = Date()
    }

    func stopReplay() {
        replayStartedAt = nil
    }

    /// What the canvas shows: the live strokes, or the replay at `date`.
    func displayedStrokes(at date: Date) -> [[SignatureSample]] {
        guard let start = replayStartedAt, let strokes = recorder?.strokes else { return recorder?.strokes ?? [] }
        let elapsed = date.timeIntervalSince(start)
        if elapsed >= SignatureReplay.duration(replayTimeline) + 0.6 {
            Task { @MainActor in self.stopReplay() }
            return strokes
        }
        return SignatureReplay.strokes(strokes, timeline: replayTimeline, at: elapsed)
    }

    /// `replacingConfirmed` is required after a 409 so a stale iPad never
    /// silently replaces a signature another iPad just saved.
    func submit(replacingConfirmed: Bool = false) async {
        guard canSave, let bootstrap, let recorder else { return }
        if needsReplaceConfirmation && !replacingConfirmed { return }
        needsReplaceConfirmation = false
        stopReplay()
        isSaving = true
        defer { isSaving = false }
        let id = requestId ?? UUID().uuidString
        requestId = id
        let body = SignatureCaptureRequest(
            requestId: id,
            expectedCaptureVersion: bootstrap.member.captureVersion,
            settingsVersion: bootstrap.member.settingsVersion,
            strokes: recorder.payload
        )
        do {
            _ = try await save(collectionId, memberId, body)
            didSave = true
            saveError = nil
            Haptics.success()
        } catch {
            // A 2xx whose body did not decode is still a committed save; replaying
            // would only return the same body again.
            if case .decodingError = error as? APIError {
                didSave = true
                saveError = nil
                Haptics.success()
                return
            }
            if !SignatureSaveRetry.retainsRequestID(after: error) {
                requestId = nil
                // A 409 means the member or pen settings moved on; reload them
                // so the kept ink can be saved against the current versions,
                // but only after the operator confirms replacing what is there.
                if case .httpError(409, _) = error as? APIError {
                    let before = bootstrap.member.artifact?.id
                    await reload()
                    let after = self.bootstrap?.member.artifact?.id
                    needsReplaceConfirmation = after != nil && after != before
                }
            }
            saveError = (error as? APIError)?.errorDescription ?? error.localizedDescription
            Haptics.error()
        }
    }
}

// MARK: - View

/// The signer-facing capture screen. The athlete sees who they are signing for
/// (big name and Wisconsin-font jersey number), a signing line, and Undo, Redo,
/// Clear, Replay, and Done. Strokes that reach the edge turn red and block Done, and a
/// save shows the cropped ink that was kept before returning to the roster.
struct SignatureCaptureView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(SessionStore.self) private var session
    @State private var vm: SignatureCaptureViewModel
    @State private var confirmDiscard = false
    @State private var confirmReplace = false
    let onSaved: () -> Void

    init(collectionId: String, memberId: String, onSaved: @escaping () -> Void, viewModel: SignatureCaptureViewModel? = nil) {
        _vm = State(initialValue: viewModel ?? SignatureCaptureViewModel(collectionId: collectionId, memberId: memberId))
        self.onSaved = onSaved
    }

    private var isReadOnly: Bool { session.currentUser?.isReadOnlyRolePreview == true }

    var body: some View {
        content
            .background(Color(.systemGroupedBackground))
            .task { await vm.load() }
            .interactiveDismissDisabled(vm.hasInk && !vm.didSave)
            // Signing runs to the screen edges: keep edge swipes and the
            // home indicator from stealing a stroke, and keep the iPad awake
            // while a signer is mid-signature.
            .defersSystemGestures(on: .all)
            .persistentSystemOverlays(.hidden)
            .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
            .onDisappear { UIApplication.shared.isIdleTimerDisabled = false }
            .confirmationDialog("Discard this signature?", isPresented: $confirmDiscard, titleVisibility: .visible) {
                Button("Discard Signature", role: .destructive) { dismiss() }
            } message: {
                Text("The ink on the canvas has not been saved.")
            }
            .confirmationDialog("Replace the signature saved on another iPad?", isPresented: $confirmReplace, titleVisibility: .visible) {
                Button("Replace Signature", role: .destructive) { Task { await vm.submit(replacingConfirmed: true) } }
            } message: {
                Text("This signer was saved elsewhere while you were signing. The earlier signature stays in the roster history.")
            }
            .onChange(of: vm.didSave) { _, saved in
                guard saved else { return }
                onSaved()
                UIAccessibility.post(notification: .announcement, argument: "Signature saved")
                Task {
                    // Show the kept ink long enough to read, then back to the
                    // roster. Signers arrive in no particular order, so there
                    // is no auto-advance.
                    do { try await Task.sleep(for: .milliseconds(1_600)) } catch { return }
                    dismiss()
                }
            }
    }

    private func leave() {
        if vm.hasInk && !vm.didSave { confirmDiscard = true } else { dismiss() }
    }

    @ViewBuilder
    private var content: some View {
        if let bootstrap = vm.bootstrap, let settings = vm.settings {
            GeometryReader { proxy in
                // One sheet: who is signing, then the canvas and its controls.
                VStack(spacing: Brand.Space.sm) {
                    header(bootstrap)
                    Divider()
                    // Signatures are captured in landscape (Erik, 2026-10-07).
                    // iPadOS will not let a multitasking app force rotation, so
                    // portrait shows a rotate prompt; ink already drawn is kept.
                    if proxy.size.width >= proxy.size.height {
                        canvasCard(settings)
                    } else {
                        rotatePrompt
                    }
                }
                .padding(Brand.Space.md)
                .brandCard(padding: 0)
                .padding(Brand.Space.md)
            }
        } else if let error = vm.loadError {
            ContentUnavailableView {
                Label("Couldn’t load this signer", systemImage: "exclamationmark.triangle")
            } description: {
                Text(error)
            } actions: {
                Button("Retry") { Task { await vm.reload() } }
                    .buttonStyle(.borderedProminent)
                Button("Return to roster") { dismiss() }
                    .buttonStyle(.bordered)
            }
        } else {
            ProgressView("Loading signer")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private var rotatePrompt: some View {
        ContentUnavailableView {
            Label("Rotate iPad to landscape", systemImage: "rectangle.landscape.rotate")
        } description: {
            Text(vm.hasInk ? "The signature so far is kept. Turn the iPad sideways to keep signing." : "Signatures are captured in landscape so there is room for the full name.")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: Header (who is signing)

    /// The signer checks this before signing: a big name and jersey number
    /// are the cheapest guard against signing in someone else's slot.
    private func header(_ bootstrap: SignatureCaptureBootstrap) -> some View {
        let member = bootstrap.member
        let detail = [member.title ?? SignatureSport.groupTitle(for: member.roleGroup), bootstrap.collection.season]
            .compactMap { $0 }
            .joined(separator: " · ")
        return HStack(spacing: Brand.Space.sm) {
            HStack(spacing: Brand.Space.xs) {
                Button(action: leave) {
                    Label("Roster", systemImage: "chevron.left")
                        .font(.body.weight(.semibold))
                        .frame(minHeight: 44)
                        .padding(.horizontal, Brand.Space.xs)
                }
                .buttonStyle(.glass)
                .keyboardShortcut(.cancelAction)
                .disabled(vm.isSaving)
            }
            .frame(width: 160, alignment: .leading)

            HStack(spacing: Brand.Space.md) {
                if let number = member.jerseyNumber {
                    Text("\(number)")
                        .font(.wisconsinJersey(size: 56, relativeTo: .largeTitle))
                        .monospacedDigit()
                        .tracking(2)
                        .foregroundStyle(Color.jerseyNumber)
                        .accessibilityLabel("Jersey \(number)")
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(member.name)
                        .font(.gothamBlack(size: 32, relativeTo: .title))
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                    Text(detail)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity)
            .accessibilityElement(children: .combine)

            // Balances the left controls so the signer stays centred.
            Color.clear.frame(width: 160, height: 1)
        }
        .padding(.vertical, Brand.Space.xs)
    }

    // MARK: Canvas card

    private func canvasCard(_ settings: SignatureCaptureSettings) -> some View {
        VStack(alignment: .leading, spacing: Brand.Space.sm) {
            Text(message)
                .font(.headline)
                .foregroundStyle(vm.saveError == nil && !vm.isClipped ? Color.secondary : Color.statusText(.red))
                .lineLimit(2)
                .frame(maxWidth: .infinity, minHeight: 28, alignment: .leading)
                .accessibilityAddTraits(.updatesFrequently)
            canvas(settings)
            HStack(spacing: Brand.Space.sm) {
                historyButton("Undo", systemImage: "arrow.uturn.backward", enabled: vm.canUndo) { vm.undo() }
                    .keyboardShortcut("z", modifiers: .command)
                historyButton("Redo", systemImage: "arrow.uturn.forward", enabled: vm.canRedo) { vm.redo() }
                    .keyboardShortcut("z", modifiers: [.command, .shift])
                historyButton("Clear", systemImage: "eraser", enabled: vm.canClear) { vm.clear() }
                    .keyboardShortcut(.delete, modifiers: .command)
                historyButton(vm.isReplaying ? "Stop" : "Replay", systemImage: vm.isReplaying ? "stop.fill" : "play.fill", enabled: vm.canReplay || vm.isReplaying) { vm.toggleReplay() }
                    .keyboardShortcut("r", modifiers: .command)
                Spacer()
                saveButton
            }
        }
        // Rotating to portrait mid-stroke removes the canvas before the Pencil
        // lifts; keep the partial stroke and leave the recorder ready.
        .onDisappear { if vm.recorder?.isDrawing == true { vm.end(cancelled: true) } }
    }

    private var message: String {
        if let error = vm.saveError { return error }
        if vm.didSave { return "Signature saved" }
        if isReadOnly { return "Role preview is read-only. Signatures can’t be saved." }
        if vm.bootstrap?.collection.status != "OPEN" { return "This collection is archived. Signatures can’t be saved." }
        if vm.isClipped && !vm.isReplaying { return "The red stroke runs off the edge. Undo it, then sign inside the box." }
        if let notice = vm.notice { return notice }
        if vm.isReplaying { return "Replaying the signature at the signer’s pace" }
        if vm.recorder?.isDrawing == true { return "Signing…" }
        if vm.hasInk { return "Tap Done when the signature looks right." }
        if vm.bootstrap?.member.artifact != nil { return "Signing again replaces the saved signature." }
        return "Sign on the line with Apple Pencil."
    }

    private func historyButton(_ title: String, systemImage: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: systemImage)
                .font(.title3.weight(.semibold))
                .frame(minWidth: 120, minHeight: 52)
        }
        .buttonStyle(.glass)
        .controlSize(.large)
        .disabled(!enabled)
    }

    private var saveButton: some View {
        Button {
            if vm.needsReplaceConfirmation { confirmReplace = true } else { Task { await vm.submit() } }
        } label: {
            HStack(spacing: Brand.Space.xs) {
                if vm.isSaving {
                    ProgressView().controlSize(.small)
                } else {
                    Image(systemName: "checkmark")
                }
                Text(vm.didSave ? "Saved" : "Done")
            }
            .font(.title3.weight(.semibold))
            .frame(minWidth: 200, minHeight: 52)
        }
        .buttonStyle(.borderedProminent)
        .tint(vm.didSave ? Color.statusText(.green) : Color.brandPrimary)
        .controlSize(.large)
        .keyboardShortcut("s", modifiers: .command)
        .disabled(!vm.canSave || isReadOnly)
    }

    /// The drawing box is the recorder's logical canvas, scaled to fit. The
    /// surface, margin, signing line, and border are drawn in that same space
    /// so they line up with the ink at any size. The surface stays light in
    /// both appearances so the configured (usually dark) ink stays legible.
    private func canvas(_ settings: SignatureCaptureSettings) -> some View {
        GeometryReader { proxy in
            let available = proxy.size
            ZStack {
                if let recorder = vm.recorder {
                    let size = recorder.logicalSize
                    let scale = min(1, available.width / size.width, available.height / size.height)
                    ZStack {
                        SignatureGuides(isClipped: vm.isClipped && !vm.isReplaying, showsLine: !vm.didSave)
                        TimelineView(.animation(paused: !vm.isReplaying)) { timeline in
                            let strokes = vm.displayedStrokes(at: timeline.date)
                            SignatureCanvasView(
                                strokes: strokes,
                                clippedStrokes: vm.isReplaying ? [] : vm.clippedStrokeIndices(in: strokes),
                                inkColor: UIColor(hex: settings.strokeColor),
                                lineWidth: settings.strokeWidth,
                                isEnabled: !vm.isSaving && !vm.didSave,
                                hasLiveStroke: vm.recorder?.isDrawing == true,
                                onBegin: vm.begin,
                                onAppend: vm.append,
                                onEnd: vm.end,
                                onPencilUndo: vm.undo
                            )
                        }
                        if vm.didSave {
                            SignatureSavedCard(strokes: recorder.strokes, settings: settings, canvasSize: size)
                                .transition(.scale(scale: 0.92).combined(with: .opacity))
                        }
                    }
                    .frame(width: size.width, height: size.height)
                    .clipShape(RoundedRectangle(cornerRadius: Brand.Radius.sm, style: .continuous))
                    .scaleEffect(scale)
                    .animation(.snappy, value: vm.didSave)
                }
            }
            .frame(width: available.width, height: available.height)
            .onAppear { vm.prepareCanvas(available: available) }
            .onChange(of: available) { _, size in vm.prepareCanvas(available: size) }
        }
        .frame(minHeight: 280)
    }
}

/// Light signing surface with a faint edge margin, a signing line with an X,
/// and a dashed border that turns red when a stroke reaches the edge. Nothing
/// here is saved; it only helps the signer size and place the signature.
private struct SignatureGuides: View {
    let isClipped: Bool
    let showsLine: Bool

    var body: some View {
        Canvas { context, size in
            let rect = CGRect(origin: .zero, size: size)
            context.fill(Path(rect), with: .color(Color(white: 0.93)))
            let margin = min(32, min(size.width, size.height) * 0.06)
            context.fill(
                Path(roundedRect: rect.insetBy(dx: margin, dy: margin), cornerRadius: 8),
                with: .color(Color(white: 0.975))
            )
            guard showsLine else { return }
            let lineY = (size.height * 0.72).rounded()
            let lineStart = margin + 24
            var line = Path()
            line.move(to: CGPoint(x: lineStart, y: lineY))
            line.addLine(to: CGPoint(x: size.width - margin - 24, y: lineY))
            context.stroke(line, with: .color(Color.black.opacity(0.28)), lineWidth: 1.5)
            context.draw(
                Text("X").font(.system(size: 30, weight: .semibold)).foregroundStyle(Color.black.opacity(0.3)),
                at: CGPoint(x: lineStart + 14, y: lineY - 24)
            )
        }
        .overlay(
            RoundedRectangle(cornerRadius: Brand.Radius.sm, style: .continuous)
                .strokeBorder(
                    isClipped ? Color.statusText(.red) : Color.black.opacity(0.18),
                    style: StrokeStyle(lineWidth: isClipped ? 4 : 2, dash: isClipped ? [] : [8, 6])
                )
        )
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// After a save: the ink cropped close to the server's crop (ink bounds plus
/// half the stroke width plus the configured padding), with a Saved check, so
/// the signer sees the ink that was kept.
private struct SignatureSavedCard: View {
    let strokes: [[SignatureSample]]
    let settings: SignatureCaptureSettings
    let canvasSize: CGSize

    private var crop: CGRect {
        let points = strokes.flatMap { $0 }
        guard let first = points.first else { return CGRect(x: 0, y: 0, width: 1, height: 1) }
        var minX = first.x, minY = first.y, maxX = first.x, maxY = first.y
        for point in points {
            minX = min(minX, point.x); minY = min(minY, point.y)
            maxX = max(maxX, point.x); maxY = max(maxY, point.y)
        }
        let pad = settings.strokeWidth / 2 + settings.cropPadding
        let x = (minX - pad).rounded(.down), y = (minY - pad).rounded(.down)
        return CGRect(x: x, y: y, width: max(1, (maxX + pad).rounded(.up) - x), height: max(1, (maxY + pad).rounded(.up) - y))
    }

    var body: some View {
        let crop = crop
        VStack(spacing: Brand.Space.md) {
            Canvas { context, size in
                let scale = min(size.width / crop.width, size.height / crop.height)
                context.translateBy(x: (size.width - crop.width * scale) / 2, y: (size.height - crop.height * scale) / 2)
                context.scaleBy(x: scale, y: scale)
                context.translateBy(x: -crop.minX, y: -crop.minY)
                let path = CGMutablePath()
                for stroke in strokes { path.addPath(SignatureCaptureGeometry.path(for: stroke)) }
                context.stroke(
                    Path(path),
                    with: .color(Color(UIColor(hex: settings.strokeColor))),
                    style: StrokeStyle(lineWidth: settings.strokeWidth, lineCap: .round, lineJoin: .round)
                )
            }
            .aspectRatio(crop.width / crop.height, contentMode: .fit)
            .frame(maxWidth: canvasSize.width * 0.6, maxHeight: canvasSize.height * 0.45)
            .background(Color.white)
            .overlay(Rectangle().strokeBorder(Color.black.opacity(0.08)))
            Label("Saved", systemImage: "checkmark.circle.fill")
                .font(.title2.weight(.semibold))
                .foregroundStyle(Color.statusText(.green))
        }
        .padding(Brand.Space.xl)
        .background(Color(white: 0.99), in: RoundedRectangle(cornerRadius: Brand.Radius.md, style: .continuous))
        .shadow(color: .black.opacity(0.15), radius: 18, y: 6)
        .environment(\.colorScheme, .light)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Signature saved")
    }
}

private extension UIColor {
    /// `#rrggbb` from the server's pen settings; black when malformed.
    convenience init(hex: String) {
        let digits = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        guard digits.count == 6, let value = UInt32(digits, radix: 16) else {
            self.init(white: 0, alpha: 1)
            return
        }
        self.init(
            red: CGFloat((value >> 16) & 0xFF) / 255,
            green: CGFloat((value >> 8) & 0xFF) / 255,
            blue: CGFloat(value & 0xFF) / 255,
            alpha: 1
        )
    }
}
