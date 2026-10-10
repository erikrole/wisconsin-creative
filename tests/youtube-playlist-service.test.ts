import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb, mockAudit, mockApi, mockReplay } = vi.hoisted(() => ({
  mockDb: {
    youTubeLibraryVideo: { findUnique: vi.fn() },
    youTubeReviewDraft: { findUnique: vi.fn() },
    youTubeLibraryState: { findUnique: vi.fn(), update: vi.fn() },
    youTubePlaylistAddition: { findMany: vi.fn(), upsert: vi.fn() },
  },
  mockAudit: vi.fn(),
  mockApi: { read: vi.fn(), readPlaylist: vi.fn(), membership: vi.fn(), insert: vi.fn(), playlistPage: vi.fn(), playlistVideoPage: vi.fn() },
  mockReplay: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/audit", () => ({ createAuditEntry: mockAudit }));
vi.mock("@/lib/youtube/connection", () => ({ channelAccessToken: vi.fn().mockResolvedValue("token") }));
vi.mock("@/lib/youtube/transport", () => ({ createTransport: vi.fn(), createPlaylistTransport: () => mockApi }));
vi.mock("@/lib/youtube/reader", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/youtube/reader")>()), replayDirectory: mockReplay }));

import type { AuthUser } from "@/lib/auth";
import { HttpError } from "@/lib/http";
import { BADGERS_CHANNEL_ID } from "@/lib/youtube/google";
import { addToPlannedPlaylists } from "@/lib/youtube/publish-service";

const admin = { id: "admin-1", role: "ADMIN", name: "Erik", email: "e@example.com", avatarUrl: null } as AuthUser;
const TITLE = "Highlights at Penn State || Wisconsin Football || Sept. 26, 2026";
const PLAYLISTS = [
  { id: "PL1", title: "2026 Football", channelId: BADGERS_CHANNEL_ID, privacy: "public", itemCount: 3 },
  { id: "PL2", title: "Highlights", channelId: BADGERS_CHANNEL_ID, privacy: "public", itemCount: 9 },
];
const snapshot = { id: "hl", title: TITLE, description: "D", categoryId: "17", isPublic: true, isLive: false, channelId: BADGERS_CHANNEL_ID, status: { privacyStatus: "public", uploadStatus: "processed" } };
const draft = (planned: string[]) => ({
  videoId: "hl", version: 3, matchedTitle: TITLE, matchedGame: null, recap: null, selectedSentenceIds: [], editedTitle: null, editedDescription: null,
  manualSource: true, manualVideo: false, conferenceKind: null, speakerIds: [], plannedPlaylistIds: planned, matchKind: null, gameChoices: [], hold: null,
  preparedAt: new Date(), updatedById: null, createdAt: new Date(), updatedAt: new Date(),
});

describe("adding to planned playlists", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReplay.mockReturnValue("");
    mockDb.youTubeLibraryVideo.findUnique.mockResolvedValue({ videoId: "hl", publishedAt: new Date(), thumbnailUrl: null, checkedAt: new Date(), live: { etag: "e", snapshot } });
    mockDb.youTubeReviewDraft.findUnique.mockResolvedValue(draft(["PL1", "PL2"]));
    mockDb.youTubeLibraryState.findUnique.mockResolvedValue({ playlists: PLAYLISTS, playlistMembers: { PL2: ["hl"] } });
    mockDb.youTubePlaylistAddition.findMany.mockResolvedValue([]);
    mockDb.youTubePlaylistAddition.upsert.mockResolvedValue({});
    mockApi.read.mockResolvedValue({ etag: "e", snapshot });
    mockApi.readPlaylist.mockImplementation(async (id: string) => PLAYLISTS.find((p) => p.id === id));
    let added = false;
    mockApi.membership.mockImplementation(async (videoId: string, playlistId: string) => (added ? { id: "item", playlistId, videoId } : null));
    mockApi.insert.mockImplementation(async (videoId: string, playlistId: string) => {
      added = true;
      return { id: "item", playlistId, videoId };
    });
  });

  it("refuses on recorded data before touching YouTube", async () => {
    mockReplay.mockReturnValue("/recordings");
    await expect(addToPlannedPlaylists(admin, "hl", 3)).rejects.toBeInstanceOf(HttpError);
    expect(mockApi.insert).not.toHaveBeenCalled();
  });

  it("refuses a draft that changed since the admin saved it", async () => {
    await expect(addToPlannedPlaylists(admin, "hl", 2)).rejects.toBeInstanceOf(HttpError);
    expect(mockApi.insert).not.toHaveBeenCalled();
  });

  it("skips playlists the video is already in, inserts the rest once, and remembers the membership", async () => {
    const result = await addToPlannedPlaylists(admin, "hl", 3);
    expect(result.added).toEqual(["2026 Football"]);
    expect(mockApi.insert).toHaveBeenCalledTimes(1);
    expect(mockApi.insert).toHaveBeenCalledWith("hl", "PL1");
    expect(mockDb.youTubeLibraryState.update).toHaveBeenCalledWith(expect.objectContaining({ data: { playlistMembers: { PL2: ["hl"], PL1: ["hl"] } } }));
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "ADD_TO_PLAYLISTS" }));
  });

  it("says so when there is nothing new to add", async () => {
    mockDb.youTubeReviewDraft.findUnique.mockResolvedValue(draft(["PL2"]));
    await expect(addToPlannedPlaylists(admin, "hl", 3)).rejects.toThrow(/no new playlists/);
    expect(mockApi.insert).not.toHaveBeenCalled();
  });

  it("sends nothing when the journal cannot be saved", async () => {
    mockDb.youTubePlaylistAddition.upsert.mockRejectedValue(new Error("database down"));
    await expect(addToPlannedPlaylists(admin, "hl", 3)).rejects.toThrow();
    expect(mockApi.insert).not.toHaveBeenCalled();
  });
});
