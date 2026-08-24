import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WebAuthnError } from "@simplewebauthn/browser";
import { isPasskeyCancellation, passkeyErrorMessage, passkeyStorageLabel } from "@/lib/passkey-client";
import { describeEnrollingClient } from "@/lib/passkey";

const source = (path: string) => readFileSync(path, "utf8");

function webAuthnError(code: string, name: string) {
  const cause = new Error("underlying");
  cause.name = name;
  return new WebAuthnError({ message: "ceremony failed", code: code as never, cause });
}

describe("passkey ceremony feedback", () => {
  it("treats a dismissed ceremony as a choice, not a failure", () => {
    const aborted = new Error("aborted");
    aborted.name = "AbortError";

    expect(isPasskeyCancellation(aborted)).toBe(true);
    expect(isPasskeyCancellation(webAuthnError("ERROR_CEREMONY_ABORTED", "AbortError"))).toBe(true);
    expect(isPasskeyCancellation(new Error("network down"))).toBe(false);
  });

  it("explains the spec errors people actually hit in product language", () => {
    expect(passkeyErrorMessage(webAuthnError("ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY", "NotAllowedError"), "login"))
      .toBe("Passkey sign-in was canceled or timed out.");
    expect(passkeyErrorMessage(webAuthnError("ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY", "NotAllowedError"), "register"))
      .toBe("Passkey setup was canceled or timed out.");
    expect(passkeyErrorMessage(webAuthnError("ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED", "InvalidStateError"), "register"))
      .toBe("This device already has a passkey for your account.");
    expect(passkeyErrorMessage(webAuthnError("ERROR_INVALID_DOMAIN", "SecurityError"), "login"))
      .toContain("usual web address");
  });

  it("keeps a server message and falls back per ceremony", () => {
    expect(passkeyErrorMessage(new Error("Too many passkey sign-in attempts."), "login"))
      .toBe("Too many passkey sign-in attempts.");
    expect(passkeyErrorMessage({}, "login")).toBe("Passkey sign-in did not finish. Use your password instead.");
    expect(passkeyErrorMessage({}, "register")).toBe("Passkey setup did not finish. Try again.");
  });

  it("separates a synced passkey from one that dies with the device", () => {
    expect(passkeyStorageLabel("multiDevice", true)).toBe("Synced");
    expect(passkeyStorageLabel("singleDevice", false)).toBe("This device only");
    expect(passkeyStorageLabel(null, false)).toBeNull();
  });
});

describe("passkey naming", () => {
  it("names an unnamed credential after the client that enrolled it", () => {
    expect(describeEnrollingClient(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    )).toBe("Safari on macOS");
    expect(describeEnrollingClient(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    )).toBe("Chrome on Windows");
    expect(describeEnrollingClient(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0",
    )).toBe("Edge on Windows");
    expect(describeEnrollingClient("WisconsinApp/1.0 iOS")).toBe("iPhone");
  });

  it("falls back to the old generic name when the client says nothing useful", () => {
    expect(describeEnrollingClient(null)).toBe("This device");
    expect(describeEnrollingClient("   ")).toBe("This device");
    expect(describeEnrollingClient("curl/8.4.0")).toBe("This device");
  });
});

describe("web passkey sign-in contract", () => {
  const login = source("src/app/login/LoginForm.tsx");

  it("offers a saved passkey from the email field itself", () => {
    expect(login).toContain('autoComplete="email webauthn"');
    expect(login).toContain("browserSupportsWebAuthnAutofill");
    expect(login).toContain('useBrowserAutofill: mode === "autofill"');
    expect(login).toContain("WebAuthnAbortService.cancelCeremony()");
  });

  it("keeps an armed autofill ceremony silent until a passkey is chosen", () => {
    expect(login).toContain('if (mode === "autofill" && !assertionReceived) return assertionReceived;');
    expect(login).toContain("if (isPasskeyCancellation(error)) return assertionReceived;");
  });

  it("lets a passkey sign-in choose the 30-day session", () => {
    // The checkbox used to render only on the password step, so a passkey
    // sign-in could never be remembered.
    expect(login).toContain("{!isOnboarding && (");
    expect(login).toContain('body: JSON.stringify({ rememberMe }),');
  });

  it("hides the passkey button instead of failing after the tap", () => {
    expect(login).toContain("{isIdentity && passkeySupported && (");
  });
});

describe("web passkey management contract", () => {
  const security = source("src/app/(app)/settings/security/page.tsx");

  it("reauthenticates removal in its own dialog", () => {
    expect(security).toContain("openPasskeyRemoval");
    expect(security).toContain('id="passkey-removal-pw"');
    expect(security).toContain("removalPassword");
    // The old flow silently required the enrollment form's password field.
    expect(security).not.toContain("window.confirm");
    expect(security).not.toContain("Enter your current password before removing a passkey.");
  });

  it("shows whether a passkey survives losing the device", () => {
    expect(security).toContain("passkeyStorageLabel(passkey.deviceType, passkey.backedUp)");
  });
});
