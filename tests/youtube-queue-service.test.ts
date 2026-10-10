import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb, mockAudit } = vi.hoisted(() => ({
  mockDb: {
    youTubeLibraryVideo: { findUnique: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn(), upsert: vi.fn() },
    youTubeReviewDraft: { findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
    youTubeLibraryState: { findUnique: vi.fn(), upsert: vi.fn() },
    $transaction: vi.fn(),
  },
  mockAudit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/audit", () => ({ createAuditEntry: mockAudit }));
vi.mock("@/lib/youtube/connection", () => ({ channelAccessToken: vi.fn() }));

import type { AuthUser } from "@/lib/auth";
import { HttpError } from "@/lib/http";
import { BADGERS_CHANNEL_ID } from "@/lib/youtube/google";
import { saveDraft } from "@/lib/youtube/queue";
import { buildRecapDocument } from "@/lib/youtube/recap";

const admin = { id: "admin-1", role: "ADMIN", name: "Erik", email: "e@example.com", avatarUrl: null } as AuthUser;
const recap = buildRecapDocument("https://uwbadgers.com/news/x", ["MADISON, Wis. — One. Two.", "Up next: something on Saturday."]);

function libraryRow(publishedAt = new Date()) {
  return {
    videoId: "hl",
    publishedAt,
    thumbnailUrl: null,
    checkedAt: new Date(),
    live: {
      etag: "e",
      snapshot: {
        id: "hl", title: "Highlights at Penn State || Wisconsin Football || Sept. 26, 2026", description: "", categoryId: "17",
        isPublic: true, isLive: false, channelId: BADGERS_CHANNEL_ID, status: { privacyStatus: "public", uploadStatus: "processed" },
      },
    },
  };
}

function draftRow(overrides: Record<string, unknown> = {}) {
  return {
    videoId: "hl", version: 3, matchedTitle: "Highlights at Penn State || Wisconsin Football || Sept. 26, 2026", matchedGame: null, recap,
    selectedSentenceIds: [], editedTitle: null, editedDescription: null, manualSource: false, manualVideo: false, conferenceKind: null,
    speakerIds: [], plannedPlaylistIds: [], matchKind: "matched", gameChoices: [], hold: null, preparedAt: new Date(),
    updatedById: null, createdAt: new Date(), updatedAt: new Date(), ...overrides,
  };
}

const playlists = [{ id: "PL1", title: "2026 Football", channelId: BADGERS_CHANNEL_ID, privacy: "public", itemCount: 3 }];

async function rejection(promise: Promise<unknown>): Promise<HttpError> {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(HttpError);
  return error as HttpError;
}

describe("saving review drafts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.youTubeLibraryVideo.findUnique.mockResolvedValue(libraryRow());
    mockDb.youTubeReviewDraft.findUnique.mockResolvedValue(draftRow());
    mockDb.youTubeLibraryState.findUnique.mockResolvedValue({ playlists, playlistMembers: {} });
    mockDb.youTubeReviewDraft.updateMany.mockResolvedValue({ count: 1 });
  });

  it("saves checked choices with a version guard and an audit entry without the text itself", async () => {
    const opening = recap.sentences[0]!.id;
    mockDb.youTubeReviewDraft.findUnique
      .mockResolvedValueOnce(draftRow())
      .mockResolvedValueOnce(draftRow({ version: 4, selectedSentenceIds: [opening], editedDescription: "Edited", plannedPlaylistIds: ["PL1"] }));
    const saved = await saveDraft(admin, "hl", { version: 3, selectedSentenceIds: [opening, opening], editedDescription: "Edited", plannedPlaylistIds: ["PL1"] });
    expect(saved.version).toBe(4);
    expect(mockDb.youTubeReviewDraft.updateMany).toHaveBeenCalledWith({
      where: { videoId: "hl", version: 3 },
      data: { selectedSentenceIds: [opening], editedDescription: "Edited", plannedPlaylistIds: ["PL1"], version: { increment: 1 }, updatedById: "admin-1" },
    });
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ entityType: "YouTubeReviewDraft", entityId: "hl", action: "UPDATE_DRAFT" }));
    expect(JSON.stringify(mockAudit.mock.calls[0])).not.toContain("Edited");
  });

  it("refuses a stale version and a lost race", async () => {
    expect((await rejection(saveDraft(admin, "hl", { version: 2, editedTitle: "x" }))).status).toBe(409);
    mockDb.youTubeReviewDraft.updateMany.mockResolvedValue({ count: 0 });
    expect((await rejection(saveDraft(admin, "hl", { version: 3, editedTitle: "x" }))).status).toBe(409);
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("rejects time-sensitive sentences, unknown speakers and playlists from elsewhere", async () => {
    const upNext = recap.sentences.find((sentence) => sentence.isTimeSensitive)!.id;
    expect((await rejection(saveDraft(admin, "hl", { version: 3, selectedSentenceIds: [upNext] }))).status).toBe(400);
    expect((await rejection(saveDraft(admin, "hl", { version: 3, speakerIds: ["nobody"] }))).status).toBe(400);
    expect((await rejection(saveDraft(admin, "hl", { version: 3, plannedPlaylistIds: ["PLother"] }))).status).toBe(400);
    expect(mockDb.youTubeReviewDraft.updateMany).not.toHaveBeenCalled();
  });

  it("refuses edits to videos outside the editable library or not yet prepared", async () => {
    mockDb.youTubeLibraryVideo.findUnique.mockResolvedValueOnce(libraryRow(new Date("2026-01-01T00:00:00Z")));
    expect((await rejection(saveDraft(admin, "hl", { version: 3, editedTitle: "x" }))).message).toMatch(/30-day/);
    mockDb.youTubeReviewDraft.findUnique.mockResolvedValueOnce(null);
    expect((await rejection(saveDraft(admin, "hl", { version: 0, editedTitle: "x" }))).status).toBe(409);
    mockDb.youTubeLibraryVideo.findUnique.mockResolvedValueOnce(null);
    expect((await rejection(saveDraft(admin, "hl", { version: 3, editedTitle: "x" }))).status).toBe(404);
  });
});
