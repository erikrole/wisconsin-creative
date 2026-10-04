import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb, mockAudit, mockTransport, mockReplay } = vi.hoisted(() => ({
  mockDb: {
    youTubeLibraryVideo: { findUnique: vi.fn(), updateMany: vi.fn() },
    youTubeReviewDraft: { findUnique: vi.fn() },
    youTubeLibraryState: { findUnique: vi.fn() },
    youTubePublishRecord: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() },
  },
  mockAudit: vi.fn(),
  mockTransport: { read: vi.fn(), update: vi.fn(), publish: vi.fn(), changeVisibility: vi.fn() },
  mockReplay: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/audit", () => ({ createAuditEntry: mockAudit }));
vi.mock("@/lib/youtube/connection", () => ({ channelAccessToken: vi.fn().mockResolvedValue("token") }));
vi.mock("@/lib/youtube/transport", () => ({ createTransport: () => mockTransport }));
vi.mock("@/lib/youtube/reader", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/youtube/reader")>()), replayDirectory: mockReplay }));

import type { AuthUser } from "@/lib/auth";
import { HttpError } from "@/lib/http";
import { BADGERS_CHANNEL_ID } from "@/lib/youtube/google";
import { publishDraft } from "@/lib/youtube/publish-service";

const admin = { id: "admin-1", role: "ADMIN", name: "Erik", email: "e@example.com", avatarUrl: null } as AuthUser;
const ID = "hl";
const TITLE = "Highlights at Penn State || Wisconsin Football || Sept. 26, 2026";

const snapshot = (over: Record<string, unknown> = {}) => ({
  id: ID, title: TITLE, description: "Old description.", categoryId: "17", isPublic: true, isLive: false, channelId: BADGERS_CHANNEL_ID,
  status: { privacyStatus: "public", uploadStatus: "processed" }, ...over,
});
const live = (over: Record<string, unknown> = {}) => ({ etag: "e1", snapshot: snapshot(over) });

const libraryRow = () => ({ videoId: ID, publishedAt: new Date(), thumbnailUrl: null, checkedAt: new Date(), live: live() });
const draftRow = (over: Record<string, unknown> = {}) => ({
  videoId: ID, version: 3, matchedTitle: TITLE, matchedGame: null, recap: null, selectedSentenceIds: [], editedTitle: null,
  editedDescription: "New description about the game.\n\nMore from Wisconsin Athletics: uwbadgers.com\n#Badgers #OnWisconsin", manualSource: true, manualVideo: false,
  conferenceKind: null, speakerIds: [], plannedPlaylistIds: [], matchKind: null, gameChoices: [], hold: null, preparedAt: new Date(),
  updatedById: null, createdAt: new Date(), updatedAt: new Date(), ...over,
});

async function rejection(promise: Promise<unknown>): Promise<HttpError> {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(HttpError);
  return error as HttpError;
}

describe("publishing a reviewed draft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReplay.mockReturnValue("");
    mockDb.youTubeLibraryVideo.findUnique.mockResolvedValue(libraryRow());
    mockDb.youTubeReviewDraft.findUnique.mockResolvedValue(draftRow());
    mockDb.youTubeLibraryState.findUnique.mockResolvedValue({ playlists: [], playlistMembers: {} });
    mockDb.youTubePublishRecord.findMany.mockResolvedValue([]);
    mockDb.youTubePublishRecord.upsert.mockResolvedValue({});
    mockTransport.read.mockResolvedValue(live());
  });

  it("refuses while the preview shows recorded data, before reading or writing anything", async () => {
    mockReplay.mockReturnValue("/recordings");
    expect((await rejection(publishDraft(admin, ID, 3, true))).status).toBe(409);
    expect(mockTransport.read).not.toHaveBeenCalled();
    expect(mockTransport.update).not.toHaveBeenCalled();
  });

  it("refuses a draft that changed since the admin approved it", async () => {
    expect((await rejection(publishDraft(admin, ID, 2, true))).status).toBe(409);
    expect(mockTransport.update).not.toHaveBeenCalled();
  });

  it("needs the facts check when the description changes, but not for a title-only change", async () => {
    expect((await rejection(publishDraft(admin, ID, 3, false))).message).toMatch(/facts/);
    expect(mockTransport.update).not.toHaveBeenCalled();
    mockDb.youTubeReviewDraft.findUnique.mockResolvedValue(draftRow({ editedDescription: "Old description.", editedTitle: "Highlights at Penn State || Wisconsin Football || Sept. 27, 2026" }));
    mockTransport.read.mockResolvedValueOnce(live()).mockResolvedValueOnce({ etag: "e2", snapshot: snapshot({ title: "Highlights at Penn State || Wisconsin Football || Sept. 27, 2026" }) });
    expect((await publishDraft(admin, ID, 3, false)).phase).toBe("verified");
  });

  it("refuses when YouTube already has the draft", async () => {
    mockDb.youTubeReviewDraft.findUnique.mockResolvedValue(draftRow({ editedDescription: "Old description." }));
    expect((await rejection(publishDraft(admin, ID, 3, true))).message).toMatch(/already has/);
    expect(mockTransport.update).not.toHaveBeenCalled();
  });

  it("refuses when the live video changed since the library was checked", async () => {
    mockTransport.read.mockResolvedValue({ etag: "e2", snapshot: snapshot({ description: "Someone edited this." }) });
    expect((await rejection(publishDraft(admin, ID, 3, true))).message).toMatch(/changed after the preview/);
    expect(mockTransport.update).not.toHaveBeenCalled();
  });

  it("journals the intent before sending, verifies by read-back and adopts the new live copy", async () => {
    const description = draftRow().editedDescription;
    const calls: string[] = [];
    mockDb.youTubePublishRecord.upsert.mockImplementation(async ({ create }: { create: { phase: string } }) => {
      calls.push(`save:${create.phase}`);
      return {};
    });
    mockTransport.update.mockImplementation(async () => {
      calls.push("update");
    });
    mockTransport.read
      .mockResolvedValueOnce(live())
      .mockResolvedValueOnce({ etag: "e2", snapshot: snapshot({ description }) });
    const record = await publishDraft(admin, ID, 3, true);
    expect(record.phase).toBe("verified");
    expect(calls.slice(0, 2)).toEqual(["save:pending", "update"]);
    expect(mockTransport.update).toHaveBeenCalledTimes(1);
    expect(mockDb.youTubeLibraryVideo.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { videoId: ID } }));
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "PUBLISH_METADATA", entityId: ID }));
  });

  it("sends nothing when the journal cannot be saved", async () => {
    mockDb.youTubePublishRecord.upsert.mockRejectedValue(new Error("database down"));
    await expect(publishDraft(admin, ID, 3, true)).rejects.toThrow();
    expect(mockTransport.update).not.toHaveBeenCalled();
  });
});
