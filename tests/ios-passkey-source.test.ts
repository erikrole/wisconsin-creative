import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

describe("iOS passkey source contract", () => {
  it("uses Apple's platform credential provider for the shared WebAuthn ceremonies", () => {
    const service = source("ios/Wisconsin/Core/PasskeyService.swift");
    const models = source("ios/Wisconsin/Models/PasskeyModels.swift");

    expect(service).toContain("ASAuthorizationPlatformPublicKeyCredentialProvider");
    expect(service).toContain("createCredentialRegistrationRequest");
    expect(service).toContain("createCredentialAssertionRequest");
    expect(service).toContain("ASAuthorizationController");
    expect(service).toContain("request.userVerificationPreference = .required");
    expect(service).toContain("rawClientDataJSON");
    expect(service).toContain("attestationObject");
    expect(service).toContain("rawAuthenticatorData");
    expect(service).toContain("signature");
    expect(service).toContain("associationUnavailable");
    expect(service).toContain("request.excludedCredentials = excluded");
    expect(service).toContain("performAutoFillAssistedRequests()");
    expect(service).toContain("withTaskCancellationHandler");
    expect(service).toContain("func cancelPendingRequest()");
    expect(service).toContain("guard controller === authorizationController else { return }");
    expect(service).toContain("Passkey setup requires a real iPhone.");
    expect(service).toContain("Passkey request was canceled.");
    expect(models).toContain("type = \"public-key\"");
    expect(models).toContain("clientExtensionResults: [String: String] = [:]");
    expect(models).toContain("struct PasskeyRegistrationConfirmation");
    expect(models).toContain("let excludeCredentials: [PasskeyCredentialDescriptor]?");
  });

  it("keeps native login, enrollment, and management on the existing API contract", () => {
    const api = source("ios/Wisconsin/Core/APIClient.swift");
    const session = source("ios/Wisconsin/Core/SessionStore.swift");
    const login = source("ios/Wisconsin/Views/LoginView.swift");
    const security = source("ios/Wisconsin/Views/AccountSecuritySettingsView.swift");

    expect(api).toContain("/api/auth/passkey/login/options");
    expect(api).toContain("/api/auth/passkey/login/verify");
    expect(api).toContain("/api/auth/passkey/registration/options");
    expect(api).toContain("/api/auth/passkey/registration/verify");
    expect(api).toContain("DataWrapper<PasskeyRegistrationConfirmation>");
    expect(api).toContain("/api/me/passkeys");
    expect(session).toContain("PasskeyService.shared.authenticate");
    expect(session).toContain("func armPasskeyAutoFill() async");
    expect(session).toContain("presentation: .autoFill");
    // A dismissed system sheet is a choice; it must not read as a failed login.
    expect(session).toContain("catch PasskeyServiceError.cancelled");
    expect(login).toContain("Use a passkey");
    expect(login).toContain("PasskeyAutoFillKey(step: loginStep, attempt: passkeyAutoFillAttempt)");
    expect(login).toContain("await session.armPasskeyAutoFill()");
    expect(login).toMatch(/if loginStep == \.identity \{[\s\S]*?submitPasskey\(\)/);
    expect(security).toContain('Text("Passkeys")');
    expect(security).toContain("PasskeyService.shared.register");
    expect(security).toContain("revokePasskey");
    expect(security).toContain("catch APIError.notFound");
    expect(security).toContain("Passkey setup is not available on this server yet.");
    expect(security).toContain('TextField("Passkey name (optional)"');
    expect(security).toContain(".textContentType(nil)");
    expect(security).toContain("String(value.prefix(80))");
    expect(security).toContain('passkeySuccessMessage = "Passkey added."');
    expect(security).toContain("Passkey added, but the list could not refresh.");
    expect(security).toContain('passkeyCurrentPassword = ""');
    expect(security).toContain("catch PasskeyServiceError.cancelled");
    expect(security).toContain("private func passkeyStorageLabel");
  });

  it("publishes the webcredentials association for the shipped bundle", () => {
    const project = source("ios/project.yml");
    const entitlements = source("ios/Wisconsin/Wisconsin.entitlements");
    const association = source("src/app/.well-known/apple-app-site-association/route.ts");

    for (const file of [project, entitlements]) {
      expect(file).toContain("webcredentials:wisconsincreative.com");
    }
    expect(association).toContain("T26T3G8C7Q.com.erikrole.Wisconsin");
    expect(association).toContain("webcredentials");
    expect(association).toContain('export const dynamic = "force-static"');
  });
});
