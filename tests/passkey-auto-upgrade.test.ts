import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const startRegistration = vi.hoisted(() => vi.fn());
vi.mock("@simplewebauthn/browser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@simplewebauthn/browser")>()),
  startRegistration,
}));

import { WebAuthnError } from "@simplewebauthn/browser";
import { passkeyErrorMessage, passkeyStorageLabel, upgradeToPasskeyAfterSignIn } from "@/lib/passkey-client";

const options = { challenge: "abc", rp: { name: "Wisconsin Creative" } };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function browser(capabilities: (() => Promise<Record<string, boolean>>) | undefined) {
  vi.stubGlobal("window", { PublicKeyCredential: capabilities ? { getClientCapabilities: capabilities } : {} });
}

let fetcher: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  browser(async () => ({ conditionalCreate: true }));
  fetcher = vi.fn(async (url: string) => (url.endsWith("/options") ? json({ options }) : json({ ok: true })));
  vi.stubGlobal("fetch", fetcher);
  startRegistration.mockResolvedValue({ id: "cred-1" });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("upgradeToPasskeyAfterSignIn", () => {
  it("asks for automatic options, registers silently and verifies", async () => {
    expect(await upgradeToPasskeyAfterSignIn("hunter2")).toBe(true);

    expect(fetcher).toHaveBeenNthCalledWith(1, "/api/auth/passkey/registration/options", expect.objectContaining({
      method: "POST", body: JSON.stringify({ currentPassword: "hunter2", automatic: true }),
    }));
    expect(startRegistration).toHaveBeenCalledWith({ optionsJSON: options, useAutoRegister: true });
    expect(fetcher).toHaveBeenNthCalledWith(2, "/api/auth/passkey/registration/verify", expect.objectContaining({
      body: JSON.stringify({ response: { id: "cred-1" } }),
    }));
  });

  it("does nothing without a password or without browser support", async () => {
    expect(await upgradeToPasskeyAfterSignIn("")).toBe(false);

    browser(undefined);
    expect(await upgradeToPasskeyAfterSignIn("hunter2")).toBe(false);

    browser(async () => ({ conditionalCreate: false }));
    expect(await upgradeToPasskeyAfterSignIn("hunter2")).toBe(false);

    browser(async () => { throw new Error("blocked"); });
    expect(await upgradeToPasskeyAfterSignIn("hunter2")).toBe(false);

    vi.stubGlobal("window", undefined);
    expect(await upgradeToPasskeyAfterSignIn("hunter2")).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("stops quietly when the server declines or has no options", async () => {
    // A refusal is a refusal even if its body happens to carry options.
    fetcher.mockResolvedValueOnce(json({ options }, 409));
    expect(await upgradeToPasskeyAfterSignIn("hunter2")).toBe(false);

    fetcher.mockResolvedValueOnce(json({ options: null }));
    expect(await upgradeToPasskeyAfterSignIn("hunter2")).toBe(false);
    expect(startRegistration).not.toHaveBeenCalled();
  });

  it("returns false when the password manager declines or verify fails", async () => {
    startRegistration.mockRejectedValueOnce(new Error("NotAllowedError"));
    expect(await upgradeToPasskeyAfterSignIn("hunter2")).toBe(false);

    fetcher.mockImplementation(async (url: string) => (url.endsWith("/options") ? json({ options }) : json({}, 400)));
    expect(await upgradeToPasskeyAfterSignIn("hunter2")).toBe(false);
  });
});

describe("passkey wording", () => {
  const webAuthn = (code: string, name = "Error") => {
    const cause = new Error("cause");
    cause.name = name;
    return new WebAuthnError({ message: "x", code: code as never, cause });
  };

  it("explains security keys that cannot hold a passkey", () => {
    expect(passkeyErrorMessage(webAuthn("ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT"), "register")).toMatch(/^This security key cannot store/);
    expect(passkeyErrorMessage(webAuthn("ERROR_INVALID_RP_ID"), "register")).toMatch(/^Passkeys are not available on this address/);
  });

  it("maps plain DOM errors by name", () => {
    const named = (name: string) => Object.assign(new Error("x"), { name });

    expect(passkeyErrorMessage(named("InvalidStateError"), "register")).toBe("This device already has a passkey for your account.");
    expect(passkeyErrorMessage(named("SecurityError"), "login")).toMatch(/^Passkeys are not available/);
    expect(passkeyErrorMessage(named("NotSupportedError"), "register")).toBe("This device cannot create a Wisconsin Creative passkey. Use your password instead.");
    expect(passkeyErrorMessage(new Error("TypeError: Failed"), "register")).toBe("Passkey setup did not finish. Try again.");
  });

  it("labels synced and device-only passkeys", () => {
    expect(passkeyStorageLabel("singleDevice", true)).toBe("Synced");
    expect(passkeyStorageLabel("multiDevice", false)).toBe("Synced");
    expect(passkeyStorageLabel("singleDevice", false)).toBe("This device only");
    expect(passkeyStorageLabel(null, false)).toBeNull();
  });
});
