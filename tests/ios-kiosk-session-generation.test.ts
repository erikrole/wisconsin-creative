import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("iOS kiosk credential generation", () => {
  it("tags every request and rejects responses from a replaced credential", () => {
    const api = source("ios/Wisconsin/Kiosk/KioskAPIClient.swift");
    const perform = api.slice(
      api.indexOf("private func performWithResponse"),
      api.indexOf("private func kioskSessionToken"),
    );

    expect(api).toContain("final class KioskCredentialBoundary");
    expect(api).toContain("let kioskCredentialBoundary = KioskCredentialBoundary()");
    expect(perform).toContain("let requestGeneration = kioskCredentialBoundary.capture()");
    expect(perform.match(/guard kioskCredentialBoundary\.owns\(requestGeneration\)/g)).toHaveLength(3);
    expect(perform).toMatch(
      /decoded = try decoder\.decode\(T\.self, from: data\)[\s\S]*?guard kioskCredentialBoundary\.owns\(requestGeneration\)[\s\S]*?return \(decoded, http\)/,
    );
    expect(perform).toContain("throw CancellationError()");
  });

  it("binds unauthorized notifications to the request generation", () => {
    const api = source("ios/Wisconsin/Kiosk/KioskAPIClient.swift");
    const store = source("ios/Wisconsin/Kiosk/KioskStore.swift");

    expect(api).toContain("object: requestGeneration");
    expect(api).not.toContain(
      "NotificationCenter.default.post(name: .kioskSessionUnauthorized, object: nil)",
    );
    expect(api).toContain("The generation-bound observer is the sole owner of session");
    expect(store).toContain("let requestGeneration = notification.object as? UUID");
    expect(store).toContain("handleUnauthorizedSession(requestGeneration: requestGeneration)");
    expect(store).toContain("kioskCredentialBoundary.owns(requestGeneration)");
  });

  it("advances ownership for activation attempts, installed credentials, and deactivation", () => {
    const api = source("ios/Wisconsin/Kiosk/KioskAPIClient.swift");
    const store = source("ios/Wisconsin/Kiosk/KioskStore.swift");
    const activation = api.slice(
      api.indexOf("func kioskActivate"),
      api.indexOf("func kioskHeartbeat"),
    );
    const install = store.slice(
      store.indexOf("func activate(response:"),
      store.indexOf("func deactivate()"),
    );
    const deactivate = store.slice(
      store.indexOf("func deactivate()"),
      store.indexOf("private func handleUnauthorizedSession"),
    );

    expect(activation).toContain("kioskCredentialBoundary.advance()");
    expect(activation).toContain("broadcastsUnauthorizedSession: false");
    expect(install).toContain("kioskCredentialBoundary.advance()");
    expect(deactivate).toContain("kioskCredentialBoundary.advance()");
  });
});
