import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    youTubeLibraryVideo: { updateMany: vi.fn() },
    youTubeLibraryState: { findUnique: vi.fn(), update: vi.fn() },
  },
  audit: vi.fn(),
  replay: vi.fn(),
  editableVideo: vi.fn(),
  publishRecords: vi.fn(),
  playlistRecords: vi.fn(),
  reconcile: vi.fn(),
  send: vi.fn(),
  playlistAdd: vi.fn(),
  playlistReconcile: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/audit", () => ({ createAuditEntry: mocks.audit }));
vi.mock("@/lib/youtube/connection", () => ({ channelAccessToken: vi.fn(async () => "token") }));
vi.mock("@/lib/youtube/transport", () => ({ createTransport: vi.fn(() => ({})), createPlaylistTransport: vi.fn(() => ({})) }));
vi.mock("@/lib/youtube/reader", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/youtube/reader")>()), replayDirectory: mocks.replay }));
vi.mock("@/lib/youtube/queue", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/youtube/queue")>()), editableVideo: mocks.editableVideo }));
vi.mock("@/lib/youtube/publish-journal", () => ({ createPublishJournal: () => ({ records: mocks.publishRecords }) }));
vi.mock("@/lib/youtube/playlist-journal", () => ({ createPlaylistJournal: () => ({ records: mocks.playlistRecords }) }));
vi.mock("@/lib/youtube/publishing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/youtube/publishing")>()),
  PublishingCoordinator: class {
    send = mocks.send;
    reconcile = mocks.reconcile;
  },
  PlaylistCoordinator: class {
    add = mocks.playlistAdd;
    reconcile = mocks.playlistReconcile;
  },
}));

import type { AuthUser } from "@/lib/auth";
import { BADGERS_CHANNEL_ID } from "@/lib/youtube/google";
import { addToPlannedPlaylists, checkLastSend, checkPlaylistAdditions, makePublic, publishDraft } from "@/lib/youtube/publish-service";
import { YouTubeToolError } from "@/lib/youtube/types";

const admin = { id: "admin-1", role: "ADMIN", name: "Erik", email: "e@example.com", avatarUrl: null } as AuthUser;
const highlights = { id: "PL-hl", title: "Highlights" };
const pressers = { id: "PL-pc", title: "Press conferences" };
const snapshot = { id: "hl", title: "Old", description: "Old.", isPublic: false, status: { privacyStatus: "unlisted" } };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.replay.mockReturnValue("");
  mocks.db.youTubeLibraryState.findUnique.mockResolvedValue({ playlistMembers: { "PL-hl": ["other"] } });
  mocks.editableVideo.mockResolvedValue({
    item: { live: { snapshot } },
    draft: { version: 3, hold: null, plannedPlaylistIds: ["PL-hl", "PL-pc", "PL-gone"] },
    video: {},
    playlists: [highlights, pressers],
  });
});

describe("draft holds", () => {
  it("refuses to send or make public a held draft", async () => {
    mocks.editableVideo.mockResolvedValue({ item: { live: { snapshot } }, draft: { version: 3, hold: "Waiting on the recap." }, video: {}, playlists: [] });

    await expect(publishDraft(admin, "hl", 3, true)).rejects.toMatchObject({ status: 409, message: "Waiting on the recap." });
    await expect(makePublic(admin, "hl", 3, true)).rejects.toMatchObject({ status: 409, message: "Waiting on the recap." });
  });

  it("refuses to make a public video public again or with a stale draft", async () => {
    await expect(makePublic(admin, "hl", 2, true)).rejects.toMatchObject({ status: 409 });

    mocks.editableVideo.mockResolvedValue({ item: { live: { snapshot: { ...snapshot, isPublic: true } } }, draft: { version: 3, hold: null }, video: {}, playlists: [] });
    await expect(makePublic(admin, "hl", 3, true)).rejects.toMatchObject({ status: 409, message: "This video is already public." });
  });
});

describe("checkLastSend", () => {
  it("returns 404 when no send is waiting to be checked", async () => {
    mocks.publishRecords.mockResolvedValue([{ id: "r1", phase: "verified" }]);

    await expect(checkLastSend(admin, "hl")).rejects.toMatchObject({ status: 404 });
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it("re-reads an unclear send, keeps a verified result and audits it", async () => {
    const readBack = { etag: "e2", snapshot: { ...snapshot, title: "New" } };
    mocks.publishRecords.mockResolvedValue([{ id: "r0", phase: "verified" }, { id: "r1", phase: "uncertain" }]);
    mocks.reconcile.mockResolvedValue({ id: "r1", phase: "verified", readBack, expected: { id: "hl" } });

    expect(await checkLastSend(admin, "hl")).toEqual(expect.objectContaining({ phase: "verified" }));
    expect(mocks.reconcile).toHaveBeenCalledWith({ id: "r1", phase: "uncertain" });
    expect(mocks.db.youTubeLibraryVideo.updateMany).toHaveBeenCalledWith({ where: { videoId: "hl" }, data: { live: readBack, checkedAt: expect.any(Date) } });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "CHECK_PUBLISH", after: { recordId: "r1", phase: "verified" } }));
  });

  it("does not adopt a result that is still unclear", async () => {
    mocks.publishRecords.mockResolvedValue([{ id: "r1", phase: "pending" }]);
    mocks.reconcile.mockResolvedValue({ id: "r1", phase: "uncertain", readBack: { etag: "e2", snapshot }, expected: { id: "hl" } });

    await checkLastSend(admin, "hl");

    expect(mocks.db.youTubeLibraryVideo.updateMany).not.toHaveBeenCalled();
  });

  it("turns a YouTube problem into a 409 and passes other errors through", async () => {
    mocks.publishRecords.mockResolvedValue([{ id: "r1", phase: "conflict" }]);
    mocks.reconcile.mockRejectedValueOnce(new YouTubeToolError("The video changed on YouTube."));
    await expect(checkLastSend(admin, "hl")).rejects.toMatchObject({ status: 409, message: "The video changed on YouTube." });

    mocks.reconcile.mockRejectedValueOnce(new Error("network"));
    await expect(checkLastSend(admin, "hl")).rejects.toThrow("network");
  });

  it("refuses while the preview shows recorded data", async () => {
    mocks.replay.mockReturnValue("/recordings");
    mocks.publishRecords.mockResolvedValue([{ id: "r1", phase: "pending" }]);

    await expect(checkLastSend(admin, "hl")).rejects.toMatchObject({ status: 409 });
  });
});

describe("addToPlannedPlaylists", () => {
  it("refuses a stale draft and a plan with nothing new", async () => {
    await expect(addToPlannedPlaylists(admin, "hl", 2)).rejects.toMatchObject({ status: 409 });

    mocks.db.youTubeLibraryState.findUnique.mockResolvedValue({ playlistMembers: { "PL-hl": ["hl"], "PL-pc": ["hl"] } });
    await expect(addToPlannedPlaylists(admin, "hl", 3)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/^There are no new playlists to add/) });
  });

  it("adds to each known planned playlist and remembers the membership", async () => {
    mocks.playlistAdd.mockResolvedValue({ phase: "verified" });

    expect(await addToPlannedPlaylists(admin, "hl", 3)).toEqual({ added: ["Highlights", "Press conferences"] });
    expect(mocks.playlistAdd).toHaveBeenCalledTimes(2);
    expect(mocks.db.youTubeLibraryState.update).toHaveBeenCalledWith({
      where: { channelId: BADGERS_CHANNEL_ID },
      data: { playlistMembers: { "PL-hl": ["other", "hl"] } },
    });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "ADD_TO_PLAYLISTS", after: { playlists: ["Highlights", "Press conferences"] } }));
  });

  it("audits the playlists already added when a later one fails", async () => {
    mocks.playlistAdd.mockResolvedValueOnce({ phase: "verified" }).mockRejectedValueOnce(new YouTubeToolError("Playlist is full."));

    await expect(addToPlannedPlaylists(admin, "hl", 3)).rejects.toMatchObject({ status: 409, message: "Playlist is full." });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ after: { playlists: ["Highlights"] } }));
  });

  it("audits nothing when the first playlist fails", async () => {
    mocks.playlistAdd.mockRejectedValueOnce(new YouTubeToolError("Playlist is full."));

    await expect(addToPlannedPlaylists(admin, "hl", 3)).rejects.toMatchObject({ status: 409 });
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});

describe("checkPlaylistAdditions", () => {
  it("returns 404 when nothing is waiting", async () => {
    mocks.playlistRecords.mockResolvedValue([{ phase: "verified" }]);

    await expect(checkPlaylistAdditions(admin, "hl")).rejects.toMatchObject({ status: 404 });
  });

  it("settles open additions and remembers the verified ones", async () => {
    mocks.playlistRecords.mockResolvedValue([{ id: "a1", phase: "pending" }, { id: "a2", phase: "uncertain" }, { id: "a3", phase: "verified" }]);
    mocks.playlistReconcile
      .mockResolvedValueOnce({ id: "a1", phase: "verified", playlist: highlights })
      .mockResolvedValueOnce({ id: "a2", phase: "uncertain", playlist: pressers });
    mocks.db.youTubeLibraryState.findUnique.mockResolvedValue(null);

    const settled = await checkPlaylistAdditions(admin, "hl");

    expect(settled.map((row) => row.phase)).toEqual(["verified", "uncertain"]);
    expect(mocks.db.youTubeLibraryState.findUnique).toHaveBeenCalledTimes(1);
    expect(mocks.db.youTubeLibraryState.update).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "CHECK_PLAYLISTS", after: { phases: ["verified", "uncertain"] } }));
  });

  it("does not record a membership twice", async () => {
    mocks.playlistRecords.mockResolvedValue([{ id: "a1", phase: "pending" }]);
    mocks.playlistReconcile.mockResolvedValue({ id: "a1", phase: "verified", playlist: highlights });
    mocks.db.youTubeLibraryState.findUnique.mockResolvedValue({ playlistMembers: { "PL-hl": ["hl"] } });

    await checkPlaylistAdditions(admin, "hl");

    expect(mocks.db.youTubeLibraryState.update).not.toHaveBeenCalled();
  });

  it("turns a YouTube problem into a 409", async () => {
    mocks.playlistRecords.mockResolvedValue([{ id: "a1", phase: "pending" }]);
    mocks.playlistReconcile.mockRejectedValue(new YouTubeToolError("Gone."));

    await expect(checkPlaylistAdditions(admin, "hl")).rejects.toMatchObject({ status: 409, message: "Gone." });
  });
});
