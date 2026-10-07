import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

const canvas = () => source("ios/Wisconsin/Views/Signatures/SignatureCanvasView.swift");
const capture = () => source("ios/Wisconsin/Views/Signatures/SignatureCaptureView.swift");
const roster = () => source("ios/Wisconsin/Views/Signatures/SignaturesView.swift");
const recorder = () => source("ios/Wisconsin/Core/SignatureStrokeRecorder.swift");
const browse = () => source("ios/Wisconsin/Views/BrowseView.swift");

describe("iOS native signature capture", () => {
  it("is offered from Browse on iPad to staff and admins only", () => {
    expect(roster()).toContain('UIDevice.current.userInterfaceIdiom == .pad && (role == "STAFF" || role == "ADMIN")');
    expect(browse()).toContain("SignatureCaptureAvailability.isAvailable(role: session.currentUser?.role) ? [.signatures] : []");
    expect(browse()).toContain("SignaturesView(wrapsInNavigationStack: false)");
  });

  it("draws with Apple Pencil only and records every coalesced sample, never predictions", () => {
    const view = canvas();
    expect(view).toContain("if touch.type == .pencil { return true }");
    // Direct touch is a simulator-only development allowance.
    expect(view).toMatch(/#if targetEnvironment\(simulator\)\s+return touch\.type == \.direct\s+#else\s+return false/);
    expect(view).toContain("event?.coalescedTouches(for: touch)");
    expect(view).toContain("touch.preciseLocation(in: self)");
    const predicted = view.slice(view.indexOf("let predicted = event?.predictedTouches"));
    expect(predicted.slice(0, predicted.indexOf("override func touchesEnded"))).not.toContain("onAppend");
  });

  it("drops repeated Pencil sample runs with the same rule as the web capture page", () => {
    expect(recorder()).toContain("static let maxRepeatedRun = 64");
    expect(source("src/lib/signatures/capture.ts")).toContain("const SIGNATURE_MAX_REPEATED_RUN = 64;");
    expect(recorder()).toContain("static let maxStrokes = 128");
    expect(recorder()).toContain("static let maxSamplesPerStroke = 10_000");
  });

  it("keeps the request ID only for the failures the server can replay", () => {
    expect(recorder()).toContain("return statusCode == 425 || statusCode == 429 || statusCode >= 500");
    // The same rule the retired web capture page used (shouldRetainSignatureSaveRequestId).
  });

  it("gives the capture surface iPad controls and returns to the roster after a brief confirmation", () => {
    const view = capture();
    expect(view).toContain('.keyboardShortcut("z", modifiers: .command)');
    expect(view).toContain('.keyboardShortcut("s", modifiers: .command)');
    expect(view).toContain(".keyboardShortcut(.cancelAction)");
    expect(view).toContain('.keyboardShortcut("z", modifiers: [.command, .shift])');
    expect(view).toContain(".defersSystemGestures(on: .all)");
    expect(view).toContain("UIApplication.shared.isIdleTimerDisabled = true");
    expect(view).toContain(".interactiveDismissDisabled(vm.hasInk && !vm.didSave)");
    expect(view).toContain("onPencilUndo: vm.undo");
    expect(canvas()).toContain("UIPencilInteraction.preferredTapAction != .ignore");
    // Signers arrive in no particular order: no next-signer auto-advance.
    expect(view).not.toMatch(/nextSigner|onNext/);
    expect(roster()).not.toMatch(/nextUnsigned|pendingNext/);
    expect(view).toContain("dismiss()");
  });

  it("mirrors the web roster and capture surfaces", () => {
    const list = roster();
    expect(list).toContain('.searchable(text: $vm.searchText, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search name, number, or title")');
    // Group headers stay pinned; the grid uses fixed column counts.
    expect(list).toContain("pinnedViews: [.sectionHeaders]");
    expect(list).toContain("let count = gridWidth >= 1_000 ? 4 : gridWidth >= 640 ? 3 : 2");
    expect(list).toContain('case .all: "All"');
    // iPad cards: the whole card is the target, signed cards keep the green tint.
    expect(list).toContain("Button(action: member.isSigned ? onPreview : onCapture)");
    expect(list).toContain('Label("Tap to sign", systemImage: "pencil.and.scribble")');
    expect(list).toContain(".background(member.isSigned ? Color.statusBackground(.green) : Color.cardSurface)");
    expect(list).toContain(".font(.wisconsinJersey(size: 40, relativeTo: .largeTitle))");
    // Saved previews follow the text color, like the web's `brightness-0 dark:invert`.
    expect(list).toContain(".renderingMode(.template)");
    expect(source("ios/Wisconsin/Core/APIClient.swift")).toContain('"/api/signatures/artifacts/\\(revisionId)/png"');
  });

  it("shows the signer who they are signing for, a signing line, and the signing controls", () => {
    const view = capture();
    expect(view).toContain(".font(.wisconsinJersey(size: 56, relativeTo: .largeTitle))");
    expect(view).toContain(".font(.gothamBlack(size: 32, relativeTo: .title))");
    expect(view).toContain("SignatureGuides(isClipped: vm.isClipped && !vm.isReplaying, showsLine: !vm.didSave)");
    expect(view).toContain('Text(vm.didSave ? "Saved" : "Done")');
    // Cancel left the signer bar; the Roster button still leaves (with the discard confirmation).
    expect(view).not.toContain('Button("Cancel", action: leave)');
  });

  it("caches saved previews by revision on disk and prefetches the roster", () => {
    const list = roster();
    expect(list).toContain('.appendingPathComponent("SignaturePreviews", isDirectory: true)');
    expect(list).toContain("if let running = inFlight[revisionId] { return await running.value }");
    expect(list).toContain(".task(id: vm.artifactIds) { await SignaturePreviewStore.prefetch(vm.artifactIds) }");
  });

  it("finds signers by jersey number without choosing the next signer", () => {
    const list = roster();
    expect(list).toContain("SignatureJerseyPad(isOpen: isOpen, lookup: vm.members(withJersey:))");
    expect(list).toContain("(detail?.members ?? []).filter { $0.active && $0.jerseyNumber == number }");
    // The pad hands its pick to the same capture cover the cards use.
    expect(list).toContain("capturing = member");
  });

  it("blocks clipped signatures, marks the clipped stroke, and shows the kept ink after a save", () => {
    const view = capture();
    expect(view).toContain("hasInk && !isClipped && isEditable");
    expect(view).toContain("clippedStrokes: vm.isReplaying ? [] : vm.clippedStrokeIndices(in: strokes)");
    expect(canvas()).toContain("clippedLayer.strokeColor = UIColor.systemRed.cgColor");
    expect(recorder()).toContain("var isClipped: Bool { strokes.contains(where: touchesEdge) }");
    expect(view).toContain("SignatureSavedCard(strokes: recorder.strokes, settings: settings, canvasSize: size)");
    // Same crop as computeSignatureCropBounds: half the stroke width plus the padding.
    expect(view).toContain("let pad = settings.strokeWidth / 2 + settings.cropPadding");
  });

  it("keeps undo, redo, clear, and replay together, with Clear undoable", () => {
    const view = capture();
    for (const control of ['historyButton("Undo"', 'historyButton("Redo"', 'historyButton("Clear"', 'vm.isReplaying ? "Stop" : "Replay"']) {
      expect(view).toContain(control);
    }
    expect(view).toContain('.keyboardShortcut("r", modifiers: .command)');
    expect(view).toContain("} else if let cleared = clearedStrokes {");
    expect(view).not.toContain('confirmationDialog("Clear the canvas?"');
    expect(recorder()).toContain("static let maxLift: TimeInterval = 0.5");
  });

  it("captures in landscape and asks for a rotation in portrait", () => {
    expect(capture()).toContain("if proxy.size.width >= proxy.size.height {");
    expect(capture()).toContain('Label("Rotate iPad to landscape", systemImage: "rectangle.landscape.rotate")');
    // iPadOS refuses programmatic rotation for a multitasking app; nothing may try.
    expect(roster() + capture()).not.toContain("requestGeometryUpdate");
  });

  it("does not save from a read-only role preview", () => {
    expect(capture()).toContain("session.currentUser?.isReadOnlyRolePreview == true");
    expect(capture()).toContain(".disabled(!vm.canSave || isReadOnly)");
  });
});
