import { startRegistration, WebAuthnError } from "@simplewebauthn/browser";
import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/server";
import { parseJsonSafely } from "@/lib/errors";

/** Shared browser-side passkey helpers for the login screen and Settings Security. */

type PasskeyContext = "login" | "register";

function errorName(error: unknown): string | null {
  if (error instanceof WebAuthnError) {
    // simplewebauthn preserves the spec error on `cause` and mirrors its name.
    return error.name || (error.cause instanceof Error ? error.cause.name : null);
  }
  if (error instanceof DOMException || error instanceof Error) return error.name;
  return null;
}

/**
 * True when the ceremony ended because the person dismissed the system sheet or
 * let it time out. Callers should return quietly instead of showing a failure.
 */
export function isPasskeyCancellation(error: unknown): boolean {
  const name = errorName(error);
  if (name === "AbortError") return true;
  if (error instanceof WebAuthnError && error.code === "ERROR_CEREMONY_ABORTED") return true;
  return false;
}

/** Product-language message for a failed passkey ceremony. */
export function passkeyErrorMessage(error: unknown, context: PasskeyContext): string {
  const fallback = context === "login"
    ? "Passkey sign-in did not finish. Use your password instead."
    : "Passkey setup did not finish. Try again.";

  if (error instanceof WebAuthnError) {
    switch (error.code) {
      case "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED":
        return "This device already has a passkey for your account.";
      case "ERROR_INVALID_DOMAIN":
      case "ERROR_INVALID_RP_ID":
        return "Passkeys are not available on this address. Open Wisconsin Creative at its usual web address.";
      case "ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT":
      case "ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT":
        return "This security key cannot store a Wisconsin Creative passkey. Use Face ID, Touch ID, or your device unlock instead.";
      default:
        break;
    }
  }

  switch (errorName(error)) {
    case "NotAllowedError":
      return context === "login"
        ? "Passkey sign-in was canceled or timed out."
        : "Passkey setup was canceled or timed out.";
    case "InvalidStateError":
      return "This device already has a passkey for your account.";
    case "SecurityError":
      return "Passkeys are not available on this address. Open Wisconsin Creative at its usual web address.";
    case "NotSupportedError":
      return "This device cannot create a Wisconsin Creative passkey. Use your password instead.";
    default:
      break;
  }

  const message = error instanceof Error ? error.message : "";
  return message && !message.includes("Error:") ? message : fallback;
}

/** "Synced" passkeys survive device loss; device-bound ones do not. */
export function passkeyStorageLabel(deviceType: string | null | undefined, backedUp: boolean): string | null {
  if (backedUp || deviceType === "multiDevice") return "Synced";
  if (deviceType === "singleDevice") return "This device only";
  return null;
}

type ClientCapabilities = Record<string, boolean | undefined>;
type PublicKeyCredentialWithCapabilities = {
  getClientCapabilities?: () => Promise<ClientCapabilities>;
};

/** WebAuthn conditional create: the browser's password manager can save a passkey without a prompt. */
export async function supportsAutomaticPasskeyUpgrade(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const credential = window.PublicKeyCredential as unknown as PublicKeyCredentialWithCapabilities | undefined;
  if (typeof credential?.getClientCapabilities !== "function") return false;
  try {
    return (await credential.getClientCapabilities()).conditionalCreate === true;
  } catch {
    return false;
  }
}

/**
 * Right after a password sign-in, ask the password manager that just filled
 * the password to also save a passkey (WebAuthn conditional create). There is
 * no prompt, and every failure is silent: a manager that declines, an account
 * that already has a passkey, or an unsupported browser all leave sign-in
 * exactly as it was. The password re-authenticates the enrollment (D-043).
 *
 * Fire and forget. Sign-in navigates client-side, so the ceremony keeps
 * running after the login form unmounts.
 */
export async function upgradeToPasskeyAfterSignIn(currentPassword: string): Promise<boolean> {
  if (!currentPassword || !(await supportsAutomaticPasskeyUpgrade())) return false;
  try {
    const optionsResponse = await fetch("/api/auth/passkey/registration/options", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, automatic: true }),
    });
    if (!optionsResponse.ok) return false;
    const body = await parseJsonSafely<{ options?: PublicKeyCredentialCreationOptionsJSON | null }>(optionsResponse);
    if (!body?.options) return false;

    const response = await startRegistration({ optionsJSON: body.options, useAutoRegister: true });
    const verifyResponse = await fetch("/api/auth/passkey/registration/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response }),
    });
    return verifyResponse.ok;
  } catch {
    return false;
  }
}
