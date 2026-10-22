import Foundation

// Profile completion and gear picks.

extension APIClient {
    // MARK: - Profile completion

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

    func uploadProfileAvatar(userId: String, jpegData: Data) async throws -> String {
        struct AvatarData: Decodable { let avatarUrl: String }

        let boundary = "WisconsinAvatar-\(UUID().uuidString)"
        var body = Data()
        body.append(Data("--\(boundary)\r\n".utf8))
        body.append(Data("Content-Disposition: form-data; name=\"file\"; filename=\"profile.jpg\"\r\n".utf8))
        body.append(Data("Content-Type: image/jpeg\r\n\r\n".utf8))
        body.append(jpegData)
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))

        var req = request(path: "/api/users/\(userId)/avatar", method: "POST")
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        req.httpBody = body
        let response: DataWrapper<AvatarData> = try await perform(req)
        return response.data.avatarUrl
    }

    // MARK: - Gear picks

    /// The signed-in person's cycle, saved list, and the fit-filtered catalog.
    /// `catalog=1` is optional on the server so the website's banner stays small.
    func myGearPicks() async throws -> GearPicksMePayload {
        let req = request(path: "/api/gear-picks/me", queryItems: [.init(name: "catalog", value: "1")])
        let resp: DataWrapper<GearPicksMePayload> = try await perform(req)
        return resp.data
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
}
