import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const { mockDb, mockAudit, reader, publishing, review } = vi.hoisted(() => ({
  mockDb: {
    youTubeLibraryVideo: { findUnique: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn(), upsert: vi.fn() },
    youTubeReviewDraft: { findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
    youTubeLibraryState: { findUnique: vi.fn(), upsert: vi.fn() },
    youTubePublishRecord: { findMany: vi.fn() },
    youTubePlaylistAddition: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
  mockAudit: vi.fn(),
  reader: { openReader: vi.fn(), importLibrary: vi.fn(), libraryNow: vi.fn() },
  publishing: { loadPlaylists: vi.fn(), loadPlaylistVideoIds: vi.fn() },
  review: { prepareDraft: vi.fn(), chooseGame: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/audit", () => ({ createAuditEntry: mockAudit }));
vi.mock("@/lib/youtube/connection", () => ({ channelAccessToken: vi.fn() }));
vi.mock("@/lib/youtube/reader", () => reader);
vi.mock("@/lib/youtube/publishing", () => publishing);
vi.mock("@/lib/youtube/uwbadgers", () => ({ createScheduleSource: () => ({ games: vi.fn(), recap: vi.fn() }) }));
vi.mock("@/lib/youtube/review", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/youtube/review")>()),
  prepareDraft: review.prepareDraft,
  chooseGame: review.chooseGame,
}));

import type { AuthUser } from "@/lib/auth";
import { BADGERS_CHANNEL_ID } from "@/lib/youtube/google";
import { chooseDraftGame, loadQueue, prepareOne, refreshLibrary } from "@/lib/youtube/queue";
import type { ReviewDraft } from "@/lib/youtube/review";
import { YouTubeToolError } from "@/lib/youtube/types";
import { HttpError } from "@/lib/http";

const admin = { id: "admin-1", role: "ADMIN", name: "Erik", email: "e@example.com", avatarUrl: null } as AuthUser;
const now = new Date("2026-09-28T17:00:00.000Z");
const RECENT = "2026-09-27T02:00:00.000Z";
const OLD = "2026-01-01T00:00:00.000Z";

function snapshot(id: string) {
  return {
    id,
    title: "Highlights at Penn State || Wisconsin Football || Sept. 26, 2026",
    description: "",
    categoryId: "17",
    isPublic: true,
    isLive: false,
    channelId: BADGERS_CHANNEL_ID,
    status: { privacyStatus: "public", uploadStatus: "processed" },
  };
}

function catalog(id: string, publishedAt = RECENT) {
  return { live: { etag: "e", snapshot: snapshot(id) }, publishedAt, thumbnailUrl: `https://i.ytimg.com/${id}.jpg` };
}

function libraryRow(id: string, publishedAt = RECENT) {
  const item = catalog(id, publishedAt);
  return { videoId: id, live: item.live, publishedAt: new Date(publishedAt), thumbnailUrl: item.thumbnailUrl, checkedAt: now };
}

function draftRow(videoId: string, overrides: Record<string, unknown> = {}) {
  return {
    videoId, version: 3, matchedTitle: snapshot(videoId).title, matchedGame: null, recap: null,
    selectedSentenceIds: [], editedTitle: null, editedDescription: null, manualSource: false, manualVideo: false, conferenceKind: null,
    speakerIds: [], plannedPlaylistIds: [], matchKind: "matched", gameChoices: [], hold: null, preparedAt: now,
    updatedById: null, createdAt: now, updatedAt: now, ...overrides,
  };
}

function prepared(videoId: string, hold: string | null = null): ReviewDraft {
  return {
    videoId, version: 0, matchedTitle: "Matched", matchedGame: null, recap: null, selectedSentenceIds: [], editedTitle: null,
    editedDescription: null, manualSource: false, manualVideo: false, conferenceKind: null, speakerIds: [], plannedPlaylistIds: [],
    matchKind: "matched", gameChoices: [], hold, preparedAt: now.toISOString(),
  };
}

const football = { id: "PL-FB", title: "2026 Football Highlights", channelId: BADGERS_CHANNEL_ID, privacy: "public", itemCount: 9 };
const hockey = { id: "PL-HK", title: "2026 Hockey", channelId: BADGERS_CHANNEL_ID, privacy: "public", itemCount: 4 };

function stateUpdate() {
  return mockDb.youTubeLibraryState.upsert.mock.calls.at(-1)?.[0]?.update;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  reader.openReader.mockResolvedValue({ now: () => now, replay: false });
  reader.libraryNow.mockReturnValue(now);
  reader.importLibrary.mockResolvedValue({ videos: [catalog("new"), catalog("edited"), catalog("old", OLD)], reachedLimit: false });
  publishing.loadPlaylists.mockResolvedValue([football, hockey]);
  publishing.loadPlaylistVideoIds.mockResolvedValue(new Set(["edited"]));
  review.prepareDraft.mockImplementation(async (video: { id: string }) => prepared(video.id));
  mockDb.$transaction.mockResolvedValue([]);
  mockDb.youTubeReviewDraft.findMany.mockResolvedValue([draftRow("edited")]);
  mockDb.youTubeReviewDraft.create.mockResolvedValue({});
  mockDb.youTubeReviewDraft.updateMany.mockResolvedValue({ count: 1 });
  mockDb.youTubeLibraryState.upsert.mockResolvedValue({});
});

describe("refreshLibrary", () => {
  it("stores the library and prepares only videos still open for review", async () => {
    const summary = await refreshLibrary(admin);

    expect(mockDb.youTubeLibraryVideo.deleteMany).toHaveBeenCalledWith({ where: { videoId: { notIn: ["new", "edited", "old"] } } });
    expect(mockDb.youTubeLibraryVideo.upsert).toHaveBeenCalledTimes(3);
    expect(review.prepareDraft.mock.calls.map(([video]) => video.id).sort()).toEqual(["edited", "new"]);

    // A new draft is created; an existing one is updated only at the version that was read.
    expect(mockDb.youTubeReviewDraft.create.mock.calls[0]?.[0]?.data).toMatchObject({ videoId: "new", matchedTitle: "Matched", updatedById: "admin-1" });
    expect(mockDb.youTubeReviewDraft.updateMany.mock.calls[0]?.[0]).toMatchObject({
      where: { videoId: "edited", version: 3 },
      data: { version: { increment: 1 }, matchedGame: Prisma.DbNull, recap: Prisma.DbNull },
    });
    expect(mockDb.youTubeReviewDraft.updateMany.mock.calls[0]?.[0]?.data).not.toHaveProperty("editedTitle");

    expect(summary).toEqual({ videos: 3, prepared: 2, held: 0, skipped: 0, reachedLimit: false, playlistFailure: null, replay: false });
    // Only the suggested football playlist is checked for membership.
    expect(publishing.loadPlaylistVideoIds).toHaveBeenCalledTimes(1);
    expect(stateUpdate()).toMatchObject({ lastFailure: null, playlistMembers: { "PL-FB": ["edited"] }, playlistFailure: null });
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ entityType: "YouTubeLibrary", action: "REFRESH", after: summary }));
  });

  it("counts held drafts, and leaves out drafts someone edited meanwhile", async () => {
    review.prepareDraft.mockImplementation(async (video: { id: string }) => prepared(video.id, video.id === "new" ? "No official recap yet." : null));
    mockDb.youTubeReviewDraft.updateMany.mockResolvedValue({ count: 0 });

    const summary = await refreshLibrary(admin);

    expect(summary).toMatchObject({ prepared: 0, held: 1 });
  });

  it("treats a draft created by a parallel refresh as not prepared", async () => {
    mockDb.youTubeReviewDraft.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "7" }));

    expect((await refreshLibrary(admin)).prepared).toBe(1);
  });

  it("keeps the saved library and records why when the channel read fails", async () => {
    reader.importLibrary.mockRejectedValue(new Error("Quota exceeded."));

    const error = await refreshLibrary(admin).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ status: 502, message: "Quota exceeded. The saved library was kept." });
    expect(mockDb.youTubeLibraryState.upsert.mock.calls[0]?.[0]?.update).toEqual({ lastFailure: "Quota exceeded." });
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("passes an HTTP error from the read through unchanged", async () => {
    reader.importLibrary.mockRejectedValue(new HttpError(401, "Reconnect the channel."));

    await expect(refreshLibrary(admin)).rejects.toMatchObject({ status: 401, message: "Reconnect the channel." });
  });

  it("reports a playlist failure and skips the membership checks", async () => {
    publishing.loadPlaylists.mockRejectedValue(new Error("Playlists unavailable."));

    const summary = await refreshLibrary(admin);

    expect(summary.playlistFailure).toBe("Playlists unavailable.");
    expect(publishing.loadPlaylistVideoIds).not.toHaveBeenCalled();
    expect(stateUpdate()).toMatchObject({ playlists: [], playlistMembers: {}, playlistFailure: "Playlists unavailable." });
  });

  it("skips preparing once the time budget is spent and says membership checks ran out of time", async () => {
    let clock = 0;
    vi.spyOn(Date, "now").mockImplementation(() => {
      const value = clock;
      clock = 60_000;
      return value;
    });

    const summary = await refreshLibrary(admin);

    expect(summary).toMatchObject({ prepared: 0, skipped: 2, playlistFailure: "Playlist checks ran out of time. Refresh again to finish them." });
    expect(review.prepareDraft).not.toHaveBeenCalled();
  });

  it("leaves no audit entry and no editor for the scheduled sweep", async () => {
    await refreshLibrary(null);

    expect(mockAudit).not.toHaveBeenCalled();
    expect(mockDb.youTubeReviewDraft.create.mock.calls[0]?.[0]?.data?.updatedById).toBeNull();
  });
});

describe("loadQueue", () => {
  beforeEach(() => {
    mockDb.youTubeLibraryVideo.findMany.mockResolvedValue([libraryRow("new"), libraryRow("edited")]);
    mockDb.youTubeReviewDraft.findMany.mockResolvedValue([draftRow("edited")]);
    mockDb.youTubeLibraryState.findUnique.mockResolvedValue({
      checkedAt: now, reachedLimit: true, lastFailure: null, playlistFailure: null,
      playlists: [football], playlistMembers: { "PL-FB": ["edited"] },
    });
    mockDb.youTubePublishRecord.findMany.mockResolvedValue([
      { id: "send-2", videoId: "edited", phase: "verified", failureMessage: null, verifiedAt: new Date("2026-09-28T16:00:00.000Z"), updatedAt: now },
      { id: "send-1", videoId: "edited", phase: "conflict", failureMessage: "Changed on YouTube.", verifiedAt: null, updatedAt: new Date("2026-09-27T16:00:00.000Z") },
    ]);
    mockDb.youTubePlaylistAddition.findMany.mockResolvedValue([{ videoId: "new", failureMessage: null }]);
  });

  it("shows each video with its draft, newest send and any unverified playlist addition", async () => {
    const queue = await loadQueue();

    expect(queue).toMatchObject({ checkedAt: now.toISOString(), reachedLimit: true, lastFailure: null, playlists: [football] });
    const [fresh, edited] = queue.items;
    expect(fresh).toMatchObject({ id: "new", draft: null, publish: null, playlistOpen: "A playlist addition has not been verified yet." });
    expect(edited).toMatchObject({
      id: "edited",
      draft: { version: 3 },
      publish: { id: "send-2", phase: "verified", at: "2026-09-28T16:00:00.000Z" },
      playlistOpen: null,
      existingPlaylists: [football],
      suggestedPlaylists: [football],
    });
    expect(edited!.checks.find((check) => check.id === "playlists")).toMatchObject({ complete: true, detail: "2026 Football Highlights" });
    expect(fresh!.checks.find((check) => check.id === "playlists")?.detail).toBe("Not in a suggested playlist");
    expect(mockDb.youTubePlaylistAddition.findMany.mock.calls[0]?.[0]?.where?.phase).toEqual({ in: ["pending", "uncertain"] });
  });

  it("never reads a failed playlist check as \"not in a playlist\"", async () => {
    mockDb.youTubeLibraryState.findUnique.mockResolvedValue({
      checkedAt: now, reachedLimit: false, lastFailure: null, playlistFailure: "Playlists unavailable.",
      playlists: [football], playlistMembers: { "PL-FB": ["edited"] },
    });

    const queue = await loadQueue();

    expect(queue.items[0]!.checks.find((check) => check.id === "playlists")?.detail).toBe("Playlist check incomplete");
  });

  it("answers an empty queue before the first refresh", async () => {
    mockDb.youTubeLibraryState.findUnique.mockResolvedValue(null);
    mockDb.youTubeLibraryVideo.findMany.mockResolvedValue([]);
    mockDb.youTubeReviewDraft.findMany.mockResolvedValue([]);
    mockDb.youTubePublishRecord.findMany.mockResolvedValue([]);
    mockDb.youTubePlaylistAddition.findMany.mockResolvedValue([]);

    expect(await loadQueue()).toEqual({ checkedAt: null, reachedLimit: false, lastFailure: null, playlistFailure: null, playlists: [], items: [] });
  });
});

describe("re-preparing one draft", () => {
  const game = { id: "g1", sport: "Football", date: "2026-09-26", opponent: "Penn State" };

  beforeEach(() => {
    mockDb.youTubeLibraryVideo.findUnique.mockResolvedValue(libraryRow("edited"));
    mockDb.youTubeReviewDraft.findUnique
      .mockReset()
      .mockResolvedValueOnce(draftRow("edited", { gameChoices: [game] }))
      .mockResolvedValueOnce(draftRow("edited", { version: 4 }));
    mockDb.youTubeLibraryState.findUnique.mockResolvedValue({ playlists: [] });
  });

  it("saves a chosen official game with an audit entry", async () => {
    review.chooseGame.mockResolvedValue({ ...prepared("edited"), matchedGame: game });

    const saved = await chooseDraftGame(admin, "edited", 3, "g1");

    expect(saved.version).toBe(4);
    expect(mockDb.youTubeReviewDraft.updateMany.mock.calls[0]?.[0]).toMatchObject({
      where: { videoId: "edited", version: 3 },
      data: { matchedGame: game, version: { increment: 1 }, updatedById: "admin-1" },
    });
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "CHOOSE_GAME", entityId: "edited" }));
  });

  it("refuses a game that was not offered, and a stale version", async () => {
    await expect(chooseDraftGame(admin, "edited", 3, "other")).rejects.toMatchObject({ status: 400 });
    mockDb.youTubeReviewDraft.findUnique.mockResolvedValue(draftRow("edited"));
    await expect(chooseDraftGame(admin, "edited", 2, "g1")).rejects.toMatchObject({ status: 409 });
    expect(review.chooseGame).not.toHaveBeenCalled();
  });

  it("turns an official-source failure into a 502", async () => {
    review.chooseGame.mockRejectedValue(new YouTubeToolError("UWBadgers.com did not answer."));

    await expect(chooseDraftGame(admin, "edited", 3, "g1")).rejects.toMatchObject({ status: 502, message: "UWBadgers.com did not answer." });
    expect(mockDb.youTubeReviewDraft.updateMany).not.toHaveBeenCalled();
  });

  it("matches one video again and records it", async () => {
    await prepareOne(admin, "edited", 3);

    expect(review.prepareDraft.mock.calls[0]?.[1]).toMatchObject({ videoId: "edited", version: 3 });
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "PREPARE_DRAFT" }));
  });

  it("refuses to re-prepare a stale version", async () => {
    await expect(prepareOne(admin, "edited", 1)).rejects.toMatchObject({ status: 409 });
    expect(review.prepareDraft).not.toHaveBeenCalled();
  });
});
