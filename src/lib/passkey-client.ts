import { WebAuthnError } from "@simplewebauthn/browser";

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
        return "Passkeys are not available on this address. Open Gear Tracker at its usual web address.";
      case "ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT":
      case "ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT":
        return "This security key cannot store a Gear Tracker passkey. Use Face ID, Touch ID, or your device unlock instead.";
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
      return "Passkeys are not available on this address. Open Gear Tracker at its usual web address.";
    case "NotSupportedError":
      return "This device cannot create a Gear Tracker passkey. Use your password instead.";
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
