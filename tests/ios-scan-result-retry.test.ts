import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

function sliceBetween(sourceText: string, start: string, end: string) {
  const startIndex = sourceText.indexOf(start);
  const endIndex = sourceText.indexOf(end, startIndex);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return sourceText.slice(startIndex, endIndex);
}

describe("iOS Scan result retry recovery", () => {
  it("keeps the camera pre-prompt copy multiline at accessibility text sizes", () => {
    const prompt = source("ios/Wisconsin/Views/ScanPrePromptView.swift");

    expect(prompt).toContain('Text("Point your camera at a barcode or QR code');
    expect(prompt.match(/\.fixedSize\(horizontal: false, vertical: true\)/g)).toHaveLength(2);
    expect(prompt).toContain('Text("Continue")');
    expect(prompt).toContain("ScrollView {");
    expect(prompt).toContain(".scrollBounceBehavior(.basedOnSize)");
  });

  it("wires lookup failures to a recoverable banner instead of a dead end", () => {
    const scanner = source("ios/Wisconsin/Views/Search/QRScannerSheet.swift");
    const lookUp = sliceBetween(scanner, "private func lookUp(rawScan: String) async {", "// MARK: - DataScannerViewController wrapper");

    expect(lookUp).toContain("Haptics.error()");
    expect(lookUp).toContain('showBanner(ScanBanner(message: error.localizedDescription, success: false))');
  });

  it("keeps the camera live on failure so re-presenting the same code retries the lookup", () => {
    const scanner = source("ios/Wisconsin/Views/Search/QRScannerSheet.swift");
    const handleScan = sliceBetween(scanner, "private func handleScan(rawScan: String) async {", "private func lookUp(rawScan: String) async {");

    // The same-code dedupe window is time-bounded, not permanent, so a
    // transient failure is retryable by pointing the camera at the code
    // again once the window elapses instead of requiring a sheet dismiss.
    expect(handleScan).toContain("guard now.timeIntervalSince(lastScanTime) > 2.0 else { return }");
    expect(handleScan).toContain("await lookUp(rawScan: rawScan)");
  });

  it("offers a manual-entry escape hatch alongside dismiss on lookup failure", () => {
    const scanner = source("ios/Wisconsin/Views/Search/QRScannerSheet.swift");
    const bannerView = sliceBetween(scanner, "private func bannerView(_ banner: ScanBanner) -> some View {", "private func showBanner(");

    const typeCodeIndex = bannerView.indexOf('Label("Type code", systemImage: "keyboard")');
    const dismissIndex = bannerView.indexOf('Button("Dismiss")', typeCodeIndex);

    expect(typeCodeIndex).toBeGreaterThanOrEqual(0);
    expect(dismissIndex).toBeGreaterThan(typeCodeIndex);
  });

  it("keeps typed lookup available when camera permission is denied", () => {
    const scanner = source("ios/Wisconsin/Views/Search/QRScannerSheet.swift");
    const prompt = source("ios/Wisconsin/Views/ScanPrePromptView.swift");

    expect(scanner).toContain("ScanDeniedView {");
    expect(scanner).toContain("showManualEntry = true");
    expect(prompt).toContain("let onTypeCode: () -> Void");
    expect(prompt).toContain('Label("Type code instead", systemImage: "keyboard")');
    expect(prompt).toContain('Label("Open Settings", systemImage: "gear")');
  });
});
