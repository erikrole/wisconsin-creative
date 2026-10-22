import Foundation

// Response shapes shared by the APIClient extensions.

struct DataWrapper<T: Decodable & Sendable>: Decodable, Sendable {
    let data: T
}

struct WorkingScheduleCommand: Encodable {
    let type: String
    let area: String?
    let workerType: String?
    let delta: Int?
    let slotKey: String?
    let userId: String?
    let callStartsAt: String?
    let callEndsAt: String?

    init(
        type: String,
        area: String? = nil,
        workerType: String? = nil,
        delta: Int? = nil,
        slotKey: String? = nil,
        userId: String? = nil,
        callStartsAt: String? = nil,
        callEndsAt: String? = nil
    ) {
        self.type = type
        self.area = area
        self.workerType = workerType
        self.delta = delta
        self.slotKey = slotKey
        self.userId = userId
        self.callStartsAt = callStartsAt
        self.callEndsAt = callEndsAt
    }
}

struct LoginResponse: Decodable {
    let user: CurrentUser
}

struct PasskeyOptionsResponse<T: Decodable & Sendable>: Decodable, Sendable {
    let options: T
}

struct MeResponse: Decodable {
    let user: CurrentUser
    let canViewUsageAnalytics: Bool?
}

struct RolePreviewMutationResponse: Decodable {
    let preview: RolePreviewInfo?
    let success: Bool?
}

struct ChangePasswordResponse: Decodable {
    let success: Bool
}

struct SuccessResponse: Decodable {
    let success: Bool
}

struct AppBuildIdentity {
    let appVersion: String?
    let appBuild: String?
    let osVersion: String?
    let deviceModel: String?
    let releaseChannel: String

    static var current: AppBuildIdentity {
        let info = Bundle.main.infoDictionary
        let os = ProcessInfo.processInfo.operatingSystemVersion
        return AppBuildIdentity(
            appVersion: info?["CFBundleShortVersionString"] as? String,
            appBuild: info?["CFBundleVersion"] as? String,
            osVersion: "\(os.majorVersion).\(os.minorVersion).\(os.patchVersion)",
            deviceModel: hardwareModel,
            releaseChannel: releaseChannel
        )
    }

    private static var hardwareModel: String {
        var size = 0
        sysctlbyname("hw.machine", nil, &size, nil, 0)
        guard size > 0 else { return "unknown" }
        var machine = [CChar](repeating: 0, count: size)
        sysctlbyname("hw.machine", &machine, &size, nil, 0)
        let bytes = machine.prefix { $0 != 0 }.map { UInt8(bitPattern: $0) }
        return String(decoding: bytes, as: UTF8.self)
    }

    private static var releaseChannel: String {
        #if DEBUG
        return "development"
        #else
        guard let receipt = Bundle.main.appStoreReceiptURL else { return "unknown" }
        return receipt.lastPathComponent == "sandboxReceipt" ? "testflight" : "app_store"
        #endif
    }
}

struct ServerErrorBody: Decodable {
    let error: String
}

struct ConflictResponseBody: Decodable {
    let error: String?
    let data: ConflictData?

    struct ConflictData: Decodable {
        let conflicts: [ConflictItem]?
        let unavailableAssets: [UnavailableItem]?
        let shortages: [Shortage]?

        struct ConflictItem: Decodable {
            let assetId: String
            let conflictingBookingTitle: String?
        }
        struct UnavailableItem: Decodable {
            let assetId: String
            let status: String
        }
        struct Shortage: Decodable {
            let bulkSkuId: String
            let requested: Int
            let available: Int
        }
    }
}
