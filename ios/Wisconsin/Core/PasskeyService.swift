import AuthenticationServices
import Foundation
import UIKit

enum PasskeyServiceError: LocalizedError {
    case unavailable
    case cancelled
    case invalidServerOptions
    case unsupportedCredential
    case associationUnavailable
    case authorizationFailed(Error)

    var errorDescription: String? {
        switch self {
        case .unavailable:
            "Passkeys are not available on this device. Use your password instead."
        case .cancelled:
            "Passkey request was canceled."
        case .invalidServerOptions, .unsupportedCredential:
            "The passkey request could not be completed. Try again."
        case .associationUnavailable:
            "Apple could not verify this app's website association. Passkey setup requires a real iPhone. On a device, reinstall the latest build and try again."
        case .authorizationFailed(let error):
            error.localizedDescription
        }
    }
}

/// How a passkey request reaches the person: a modal sheet they asked for, or a
/// passive QuickType suggestion over the keyboard.
enum PasskeyPresentation {
    case modal
    case autoFill
}

/// Owns the short-lived AuthenticationServices controller and converts Apple's
/// native credentials into the JSON shape consumed by the shared WebAuthn API.
/// The server remains responsible for challenge, origin, RP ID, user
/// verification, credential, and session validation.
@MainActor
final class PasskeyService: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    static let shared = PasskeyService()

    private var authorizationController: ASAuthorizationController?
    private var continuation: CheckedContinuation<ASAuthorization, Error>?
    private var presentationWindow: UIWindow?

    func register(options: PasskeyRegistrationOptions) async throws -> PasskeyRegistrationPayload {
        guard let challenge = Base64URL.decode(options.challenge),
              let userID = Base64URL.decode(options.user.id) else {
            throw PasskeyServiceError.invalidServerOptions
        }

        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(
            relyingPartyIdentifier: options.rp.id
        )
        let request = provider.createCredentialRegistrationRequest(
            challenge: challenge,
            name: options.user.name,
            userID: userID
        )
        // The server verifies with `requireUserVerification`, so ask for it
        // rather than relying on the platform default.
        request.userVerificationPreference = .required
        // Without the server's exclude list a second enrollment on a device
        // that already holds a passkey silently creates a duplicate row.
        let excluded = (options.excludeCredentials ?? []).compactMap { descriptor in
            Base64URL.decode(descriptor.id).map(
                ASAuthorizationPlatformPublicKeyCredentialDescriptor.init(credentialID:)
            )
        }
        if !excluded.isEmpty {
            request.excludedCredentials = excluded
        }
        let authorization = try await perform(request, presentation: .modal)
        guard let credential = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialRegistration else {
            throw PasskeyServiceError.unsupportedCredential
        }
        guard let attestationObject = credential.rawAttestationObject else {
            throw PasskeyServiceError.unsupportedCredential
        }

        let id = Base64URL.encode(credential.credentialID)
        return PasskeyRegistrationPayload(
            id: id,
            rawId: id,
            response: .init(
                clientDataJSON: Base64URL.encode(credential.rawClientDataJSON),
                attestationObject: Base64URL.encode(attestationObject)
            )
        )
    }

    func authenticate(
        options: PasskeyAuthenticationOptions,
        presentation: PasskeyPresentation = .modal
    ) async throws -> PasskeyAssertionPayload {
        guard let challenge = Base64URL.decode(options.challenge) else {
            throw PasskeyServiceError.invalidServerOptions
        }

        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(
            relyingPartyIdentifier: options.rpId
        )
        let request = provider.createCredentialAssertionRequest(challenge: challenge)
        request.userVerificationPreference = .required

        let authorization = try await perform(request, presentation: presentation)
        guard let credential = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialAssertion else {
            throw PasskeyServiceError.unsupportedCredential
        }

        let id = Base64URL.encode(credential.credentialID)
        let userHandle: String?
        if let userID = credential.userID, !userID.isEmpty {
            userHandle = Base64URL.encode(userID)
        } else {
            userHandle = nil
        }
        return PasskeyAssertionPayload(
            id: id,
            rawId: id,
            response: .init(
                clientDataJSON: Base64URL.encode(credential.rawClientDataJSON),
                authenticatorData: Base64URL.encode(credential.rawAuthenticatorData),
                signature: Base64URL.encode(credential.signature),
                userHandle: userHandle
            )
        )
    }

    /// Ends a request that is still waiting on the person — an armed AutoFill
    /// suggestion they never used, or a sheet being replaced by a new request.
    func cancelPendingRequest() {
        guard continuation != nil else { return }
        authorizationController?.cancel()
        finish(.failure(PasskeyServiceError.cancelled))
    }

    private func perform(
        _ request: ASAuthorizationRequest,
        presentation: PasskeyPresentation
    ) async throws -> ASAuthorization {
        // An armed AutoFill request outlives the keyboard, so a deliberate tap
        // on "Use a passkey" replaces it instead of failing as unavailable.
        cancelPendingRequest()
        guard let window = Self.activeWindow else {
            throw PasskeyServiceError.unavailable
        }

        let controller = ASAuthorizationController(authorizationRequests: [request])
        authorizationController = controller
        presentationWindow = window
        controller.delegate = self
        controller.presentationContextProvider = self

        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                self.continuation = continuation
                switch presentation {
                case .modal:
                    controller.performRequests()
                case .autoFill:
                    controller.performAutoFillAssistedRequests()
                }
            }
        } onCancel: {
            Task { @MainActor [weak self] in self?.cancelPendingRequest() }
        }
    }

    func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithAuthorization authorization: ASAuthorization
    ) {
        // A replaced controller can still report back; it must not resume the
        // request that took its place.
        guard controller === authorizationController else { return }
        finish(.success(authorization))
    }

    func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithError error: Error
    ) {
        guard controller === authorizationController else { return }
        if let authorizationError = error as? ASAuthorizationError,
           authorizationError.code == .canceled {
            finish(.failure(PasskeyServiceError.cancelled))
        } else if error.localizedDescription.localizedCaseInsensitiveContains("webcredentials association") {
            finish(.failure(PasskeyServiceError.associationUnavailable))
        } else {
            finish(.failure(PasskeyServiceError.authorizationFailed(error)))
        }
    }

    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        if let presentationWindow {
            return presentationWindow
        }
        if let activeWindow = Self.activeWindow {
            return activeWindow
        }
        guard let windowScene = Self.activeWindowScene else {
            preconditionFailure("Passkey authorization requires an active window scene")
        }
        return UIWindow(windowScene: windowScene)
    }

    private func finish(_ result: Result<ASAuthorization, Error>) {
        let continuation = continuation
        self.continuation = nil
        authorizationController = nil
        presentationWindow = nil
        continuation?.resume(with: result)
    }

    private static var activeWindowScene: UIWindowScene? {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first(where: { $0.activationState == .foregroundActive })
    }

    private static var activeWindow: UIWindow? {
        activeWindowScene?.windows.first(where: \.isKeyWindow)
    }
}

private enum Base64URL {
    static func encode(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .trimmingCharacters(in: CharacterSet(charactersIn: "="))
    }

    static func decode(_ string: String) -> Data? {
        var value = string
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        value += String(repeating: "=", count: (4 - value.count % 4) % 4)
        return Data(base64Encoded: value)
    }
}
