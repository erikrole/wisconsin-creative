import Foundation

// Profile completion and gear picks.

extension APIClient {
    // MARK: - Profile completion

    func gettingStarted() async throws -> GettingStartedEnvelope {
        try await perform(request(path: "/api/me/getting-started"))
    }

    func updateGettingStarted(_ progress: GettingStartedProgress, expectedUserId: String) async throws -> GettingStartedEnvelope {
        struct Payload: Encodable { let done: [String]; let dismissed: Bool?; let expectedUserId: String }
        var req = request(path: "/api/me/getting-started", method: "PATCH")
        req.httpBody = try JSONEncoder().encode(Payload(done: Array(progress.done), dismissed: progress.dismissed ? true : nil, expectedUserId: expectedUserId))
        return try await perform(req)
    }

    func profileCompletion() async throws -> ProfileCompletionResponse {
        let response: DataWrapper<ProfileCompletionResponse> = try await perform(
            request(path: "/api/me/profile-completion")
        )
        return response.data
    }

    func updateProfileCompletion(_ update: ProfileCompletionUpdate) async throws -> ProfileCompletionResponse {
        var req = request(path: "/api/me/profile-completion", method: "PATCH")
        req.httpBody = try JSONEncoder().encode(update)
        let response: DataWrapper<ProfileCompletionResponse> = try await perform(req)
        return response.data
    }

    func uploadProfileAvatar(userId: String, jpegData: Data, expectedAvatarURL: String?) async throws -> String {
        struct AvatarData: Decodable { let avatarUrl: String }
        let uploadId = UUID().uuidString.lowercased()

        let boundary = "WisconsinAvatar-\(UUID().uuidString)"
        var body = Data()
        body.append(Data("--\(boundary)\r\n".utf8))
        body.append(Data("Content-Disposition: form-data; name=\"uploadId\"\r\n\r\n\(uploadId)\r\n".utf8))
        body.append(Data("--\(boundary)\r\n".utf8))
        body.append(Data("Content-Disposition: form-data; name=\"file\"; filename=\"profile.jpg\"\r\n".utf8))
        body.append(Data("Content-Type: image/jpeg\r\n\r\n".utf8))
        body.append(jpegData)
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))

        var req = request(path: "/api/users/\(userId)/avatar", method: "POST")
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        req.setValue(expectedAvatarURL ?? "", forHTTPHeaderField: "x-avatar-url")
        req.setValue(userId, forHTTPHeaderField: "x-expected-actor-id")
        req.httpBody = body
        do {
            let response: DataWrapper<AvatarData> = try await perform(req)
            return response.data.avatarUrl
        } catch let error as APIError {
            switch error {
            case .networkError, .decodingError:
                struct Receipt: Decodable { let id: String; let avatarUrl: String? }
                if let receipt: DataWrapper<Receipt> = try? await perform(request(path: "/api/users/\(userId)/avatar")),
                   receipt.data.id == userId, let url = receipt.data.avatarUrl, url.contains("/\(uploadId)-") { return url }
                throw error
            default: throw error
            }
        }
    }

    func removeProfileAvatar(userId: String, expectedAvatarURL: String) async throws {
        struct AvatarData: Decodable { let avatarUrl: String? }
        var req = request(path: "/api/users/\(userId)/avatar", method: "DELETE")
        req.setValue(expectedAvatarURL, forHTTPHeaderField: "x-avatar-url")
        req.setValue(userId, forHTTPHeaderField: "x-expected-actor-id")
        do {
            let _: DataWrapper<AvatarData> = try await perform(req)
        } catch let error as APIError {
            switch error {
            case .networkError, .decodingError:
                struct Receipt: Decodable { let id: String; let avatarUrl: String? }
                if let receipt: DataWrapper<Receipt> = try? await perform(request(path: "/api/users/\(userId)/avatar")),
                   receipt.data.id == userId, receipt.data.avatarUrl == nil { return }
                throw error
            default: throw error
            }
        }
    }

    // MARK: - Gear picks

    /// The signed-in person's cycle, saved list, and the fit-filtered catalog.
    /// `catalog=1` is optional on the server so the website's banner stays small.
    func myGearPicks() async throws -> GearPicksMePayload {
        let req = request(path: "/api/gear-picks/me", queryItems: [.init(name: "catalog", value: "1")])
        let resp: DataWrapper<GearPicksMePayload> = try await perform(req)
        return resp.data
    }

    /// The signed-in person's own kit with handout state. Nil when they are not
    /// on this year's list or the cycle is not launched. A server without the
    /// route answers 404 and a role without gear access 403; both mean "no
    /// kit to show", not a failure, so the card simply stays hidden.
    func myGearKit() async throws -> GearMyKit? {
        struct Envelope: Decodable, Sendable { let kit: GearMyKit? }
        let req = request(path: "/api/gear-picks/me/kit")
        do {
            let resp: DataWrapper<Envelope> = try await perform(req)
            return resp.data.kit
        } catch APIError.notFound {
            return nil
        } catch APIError.httpError(let status, _) where status == 403 {
            return nil
        }
    }

    /// Replace the participant's whole list. The server prices every line and checks the allowance.
    func saveMyGearPicks(lines: [GearPickSaveLine], submit: Bool, version: Int) async throws -> GearPickSubmission {
        struct Body: Encodable {
            let lines: [GearPickSaveLine]
            let submit: Bool
            let version: Int
        }
        var req = request(path: "/api/gear-picks/me", method: "PUT")
        req.httpBody = try JSONEncoder().encode(Body(lines: lines, submit: submit, version: version))
        let resp: DataWrapper<GearPickSubmission> = try await perform(req)
        return resp.data
    }


    func wrapped(preview: Bool = false) async throws -> WrappedResponse {
        let items: [URLQueryItem] = preview ? [.init(name: "preview", value: "1")] : []
        let response: DataWrapper<WrappedResponse> = try await perform(
            request(path: "/api/wrapped", queryItems: items)
        )
        return response.data
    }
}
