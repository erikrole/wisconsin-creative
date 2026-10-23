import Foundation

// Sign-in, passkeys, push registration, and the signed-in user.

extension APIClient {
    // MARK: - Auth

    func discoverAuth(email: String) async throws -> AuthDiscoveryResult {
        struct Body: Encodable {
            let email: String
        }

        let normalizedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        prepareAuthHost(for: normalizedEmail)
        var req = request(path: "/api/auth/discover", method: "POST")
        req.httpBody = try JSONEncoder().encode(Body(email: normalizedEmail))
        return try await perform(req, broadcastsSessionExpiry: false)
    }

    func login(email: String, password: String) async throws -> CurrentUser {
        struct Body: Encodable {
            let email: String
            let password: String
            let rememberMe: Bool
        }
        prepareAuthHost(for: email)
        var req = request(path: "/api/auth/login", method: "POST")
        req.httpBody = try JSONEncoder().encode(Body(email: email, password: password, rememberMe: true))
        let resp: LoginResponse = try await perform(req, broadcastsSessionExpiry: false)
        return resp.user
    }

    func register(name: String, email: String, password: String) async throws -> CurrentUser {
        struct Body: Encodable {
            let name: String
            let email: String
            let password: String
        }

        let normalizedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        prepareAuthHost(for: normalizedEmail)
        var req = request(path: "/api/auth/register", method: "POST")
        req.httpBody = try JSONEncoder().encode(Body(
            name: name.trimmingCharacters(in: .whitespacesAndNewlines),
            email: normalizedEmail,
            password: password
        ))
        let response: LoginResponse = try await perform(req, broadcastsSessionExpiry: false)
        return response.user
    }

    func requestPasswordReset(email: String) async throws -> PasswordResetRequestResult {
        struct Body: Encodable {
            let email: String
        }

        let normalizedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        prepareAuthHost(for: normalizedEmail)
        var req = request(path: "/api/auth/forgot-password", method: "POST")
        req.httpBody = try JSONEncoder().encode(Body(email: normalizedEmail))
        return try await perform(req, broadcastsSessionExpiry: false)
    }

    func passkeyAuthenticationOptions(rememberMe: Bool = true) async throws -> PasskeyAuthenticationOptions {
        struct Body: Encodable {
            let rememberMe: Bool
        }

        var req = request(path: "/api/auth/passkey/login/options", method: "POST")
        req.httpBody = try JSONEncoder().encode(Body(rememberMe: rememberMe))
        let response: PasskeyOptionsResponse<PasskeyAuthenticationOptions> = try await perform(
            req,
            broadcastsSessionExpiry: false
        )
        return response.options
    }

    func verifyPasskeyAuthentication(_ assertion: PasskeyAssertionPayload) async throws -> CurrentUser {
        struct Body: Encodable {
            let response: PasskeyAssertionPayload
        }

        var req = request(path: "/api/auth/passkey/login/verify", method: "POST")
        req.httpBody = try JSONEncoder().encode(Body(response: assertion))
        let response: LoginResponse = try await perform(req, broadcastsSessionExpiry: false)
        return response.user
    }

    func passkeyRegistrationOptions(currentPassword: String) async throws -> PasskeyRegistrationOptions {
        struct Body: Encodable {
            let currentPassword: String
        }

        var req = request(path: "/api/auth/passkey/registration/options", method: "POST")
        req.httpBody = try JSONEncoder().encode(Body(currentPassword: currentPassword))
        let response: PasskeyOptionsResponse<PasskeyRegistrationOptions> = try await perform(req)
        return response.options
    }

    /// Options for a prompt-free passkey upgrade straight after a password
    /// sign-in, re-authenticated by that password. Nil when the account already
    /// has a passkey, so the upgrade does nothing.
    func automaticPasskeyRegistrationOptions(currentPassword: String) async throws -> PasskeyRegistrationOptions? {
        struct Body: Encodable {
            let currentPassword: String
            let automatic = true
        }
        struct Response: Decodable {
            let options: PasskeyRegistrationOptions?
        }

        var req = request(path: "/api/auth/passkey/registration/options", method: "POST")
        req.httpBody = try JSONEncoder().encode(Body(currentPassword: currentPassword))
        let response: Response = try await perform(req)
        return response.options
    }

    func verifyPasskeyRegistration(
        _ registration: PasskeyRegistrationPayload,
        name: String?
    ) async throws -> PasskeyRegistrationConfirmation {
        struct Body: Encodable {
            let response: PasskeyRegistrationPayload
            let name: String?
        }

        var req = request(path: "/api/auth/passkey/registration/verify", method: "POST")
        let trimmedName = name?.trimmingCharacters(in: .whitespacesAndNewlines)
        req.httpBody = try JSONEncoder().encode(Body(
            response: registration,
            name: trimmedName?.isEmpty == true ? nil : trimmedName
        ))
        let response: DataWrapper<PasskeyRegistrationConfirmation> = try await perform(req)
        return response.data
    }

    func passkeys() async throws -> [PasskeyCredentialSummary] {
        let response: DataWrapper<[PasskeyCredentialSummary]> = try await perform(
            request(path: "/api/me/passkeys")
        )
        return response.data
    }

    func revokePasskey(id: String, currentPassword: String) async throws {
        struct Body: Encodable {
            let currentPassword: String
        }

        var req = request(path: "/api/me/passkeys/\(id)", method: "DELETE")
        req.httpBody = try JSONEncoder().encode(Body(currentPassword: currentPassword))
        let _: SuccessResponse = try await perform(req)
    }

    func logout() async throws {
        let req = request(path: "/api/auth/logout", method: "POST")
        _ = try? await session.data(for: req)
        HTTPCookieStorage.shared.removeCookies(since: .distantPast)
        AppEnvironment.resetActiveAPIHost()
    }

    func registerDeviceToken(_ hexToken: String) async throws {
        struct Body: Encodable { let token: String; let platform: String; let appVersion: String? }
        var req = request(path: "/api/devices", method: "POST")
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String
        req.httpBody = try JSONEncoder().encode(Body(token: hexToken, platform: "IOS", appVersion: version))
        let _: SuccessResponse = try await perform(req)
    }

    func revokeAllDeviceTokens() async throws {
        let req = request(path: "/api/devices", method: "DELETE")
        let _: SuccessResponse = try await perform(req)
    }

    func sendTestPush(deviceToken: String) async throws -> TestPushResult {
        struct Body: Encodable { let token: String }
        var req = request(path: "/api/devices/test", method: "POST")
        req.httpBody = try JSONEncoder().encode(Body(token: deviceToken))
        return try await perform(req)
    }

    func registerCheckoutReturnLiveActivity(bookingId: String, token: String) async throws {
        struct Body: Encodable {
            let bookingId: String
            let token: String
        }
        var req = request(path: "/api/live-activities/checkout-return", method: "POST")
        req.httpBody = try JSONEncoder().encode(Body(bookingId: bookingId, token: token))
        let _: SuccessResponse = try await perform(req)
    }

    func registerCheckoutReturnLiveActivityStartToken(_ token: String) async throws {
        struct Body: Encodable { let token: String }
        var req = request(path: "/api/live-activities/checkout-return/start-token", method: "POST")
        req.httpBody = try JSONEncoder().encode(Body(token: token))
        let _: SuccessResponse = try await perform(req)
    }

    func revokeCheckoutReturnLiveActivityStartTokens() async throws {
        let req = request(path: "/api/live-activities/checkout-return/start-token", method: "DELETE")
        let _: SuccessResponse = try await perform(req)
    }

    func me() async throws -> CurrentUser {
        let req = request(path: "/api/me")
        let resp: MeResponse = try await perform(req)
        return resp.user
    }

    /// The native presentation control intentionally exposes only the Student
    /// preset. Authorization and the signed read-only cookie remain owned by
    /// the shared server route; `/api/me` is refreshed by `SessionStore` after
    /// this request so the native shell never invents an effective role.
    func startStudentRolePreview() async throws {
        struct Body: Encodable { let role: String }
        var req = request(path: "/api/admin/role-preview", method: "POST")
        req.httpBody = try JSONEncoder().encode(Body(role: "STUDENT"))
        let _: DataWrapper<RolePreviewMutationResponse> = try await perform(req)
    }

    func stopRolePreview() async throws {
        let req = request(path: "/api/admin/role-preview", method: "DELETE")
        let _: DataWrapper<RolePreviewMutationResponse> = try await perform(req)
    }

    func changePassword(currentPassword: String, newPassword: String, revokeOtherSessions: Bool = true) async throws {
        struct Body: Encodable {
            let currentPassword: String
            let newPassword: String
            let revokeOtherSessions: Bool
        }

        var req = request(path: "/api/me/change-password", method: "POST")
        req.httpBody = try JSONEncoder().encode(Body(
            currentPassword: currentPassword,
            newPassword: newPassword,
            revokeOtherSessions: revokeOtherSessions
        ))
        let _: ChangePasswordResponse = try await perform(req)
    }

    func deleteAccount(currentPassword: String) async throws {
        struct Body: Encodable {
            let currentPassword: String
            let confirmation: String
        }

        var req = request(path: "/api/me/account", method: "DELETE")
        req.httpBody = try JSONEncoder().encode(Body(currentPassword: currentPassword, confirmation: "DELETE"))
        let _: SuccessResponse = try await perform(req)
    }
}
