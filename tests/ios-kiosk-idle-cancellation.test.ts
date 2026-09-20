import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("iOS kiosk idle cancellation handling", () => {
  it("does not report cancelled dashboard refreshes as offline failures", () => {
    const idle = source("ios/Wisconsin/Kiosk/KioskIdleView.swift");

    expect(idle).toContain("var sawCancellation = false");
    expect(idle).toContain("case .failure(let error) where isCancellation(error):");
    expect(idle).toContain("loadFailedAt = Date()");
    expect(idle).toContain("} else if loadedAnyData || !sawCancellation {");
    expect(idle).toContain("private func isCancellation(_ error: Error) -> Bool");
    expect(idle).toContain("error is CancellationError");
    expect(idle).toContain("case .networkError(let underlying) = apiError");
    expect(idle).toContain("urlError.code == .cancelled");
    expect(idle).toContain("NSURLErrorCancelled");
  });
});
