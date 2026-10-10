import { describe, expect, it } from "vitest";

import {
  createPreview,
  loadPlaylists,
  loadPlaylistVideoIds,
  loadUploadIds,
  PlaylistCoordinator,
  PublishingCoordinator,
  type PlaylistAddition,
  type PlaylistJournal,
  type PlaylistTransport,
  type PublishJournal,
  type PublishOperation,
  type PublishRecord,
  type YouTubeTransport,
} from "@/lib/youtube/publishing";
import { assembleDescription } from "@/lib/youtube/rules";
import type { LiveVideo, PlaylistMembership, VideoSnapshot, VideoStatus, YouTubePlaylist } from "@/lib/youtube/types";
import {
  editedReview,
  isApproved,
  prepareDescription,
  prepareMetadata,
  prepareRollback,
  prepareVisibility,
  updateBody,
  verifyReadBack,
  visibilityBody,
  type DescriptionReview,
} from "@/lib/youtube/write-guard";

const CHANNEL = "WisconsinTestChannel";
const approved = (text = assembleDescription(["Wisconsin won 3-0."])): DescriptionReview => ({ text, approvedText: text, reviewedFacts: true });
const video = (over: Partial<VideoSnapshot> = {}): VideoSnapshot => ({
  id: "video", title: "Original title", description: "Original description", tags: ["Badgers"], categoryId: "17",
  defaultLanguage: "en", defaultAudioLanguage: "en", isPublic: true, channelId: CHANNEL, isLive: false, ...over,
});
const launchSnapshot = (privacy = "private", publishAt: string | null = null, uploadStatus = "processed"): VideoSnapshot => ({
  id: "video", title: "Original title", description: "", tags: ["Badgers"], categoryId: "17", isPublic: false, channelId: CHANNEL, isLive: false,
  status: { privacyStatus: privacy, license: "youtube", embeddable: true, publicStatsViewable: false, selfDeclaredMadeForKids: false, containsSyntheticMedia: false, publishAt, uploadStatus },
});
const approvedLaunch = (before: VideoSnapshot) =>
  prepareDescription({ baseline: before, live: before, review: approved(assembleDescription(["Wisconsin won."])), makePublic: true });

class FakeYouTube implements YouTubeTransport {
  readCount = 0; updateCount = 0; receivedETag: string | null = null;
  beforeUpdate?: () => void;
  throwAfterApply = false; throwBeforeApply = false;
  overrideAfterApply: VideoSnapshot | null = null;
  staleReadsAfterApply = 0;
  previous: LiveVideo | null = null;
  constructor(public current: LiveVideo) {}
  async read() {
    this.readCount += 1;
    if (this.staleReadsAfterApply > 0 && this.previous) { this.staleReadsAfterApply -= 1; return this.previous; }
    return this.current;
  }
  async update(snapshot: VideoSnapshot, etag: string) {
    this.beforeUpdate?.(); this.updateCount += 1; this.receivedETag = etag;
    if (this.throwBeforeApply) throw new Error("Simulated timeout");
    this.previous = this.current;
    this.current = { snapshot: this.overrideAfterApply ?? snapshot, etag: `new-revision-${this.updateCount}` };
    if (this.throwAfterApply) throw new Error("Simulated timeout after write");
  }
  publish(snapshot: VideoSnapshot, etag: string) { return this.update(snapshot, etag); }
  changeVisibility(snapshot: VideoSnapshot, etag: string) { return this.update(snapshot, etag); }
}

class FakeJournal implements PublishJournal {
  saved: PublishRecord[] = []; failSave = false;
  get latest() {
    const record = this.saved[0];
    if (!record) throw new Error("No journal record");
    return record;
  }
  async records() { return this.saved; }
  async record(id: string) { return this.saved.find((r) => r.id === id) ?? null; }
  async save(record: PublishRecord) {
    if (this.failSave) throw new Error("Disk full");
    this.saved = [structuredClone(record), ...this.saved.filter((r) => r.id !== record.id)];
  }
}

const coordinator = (api: FakeYouTube, journal: FakeJournal, channelId = CHANNEL) =>
  new PublishingCoordinator(api, journal, { allowedVideoIds: new Set(["video"]), channelId, waitForPropagation: async () => {} });
const preview = (before: LiveVideo, operation: PublishOperation = "send", expected?: VideoSnapshot, undoOf: string | null = null) =>
  createPreview({ before, expected: expected ?? video({ description: assembleDescription(["Wisconsin won 3-0."]) }), sourceUrl: "https://uwbadgers.com/news/recap", sourceSha256: "source-sha", operation, undoOf });

describe("write guard", () => {
  it("preserves title, tags and languages exactly", () => {
    const before = video({ title: "Original title  " });
    const expected = prepareDescription({ baseline: before, live: before, review: approved() });
    expect(expected).toMatchObject({ title: before.title, tags: before.tags, defaultLanguage: "en", defaultAudioLanguage: "en", categoryId: "17" });
  });
  it("blocks writes when the live title or description changed", () => {
    for (const live of [video({ title: "Original title " }), video({ description: "new" })]) {
      expect(() => prepareDescription({ baseline: video(), live, review: approved() })).toThrow();
    }
  });
  it("clears approval and the fact check on any edit", () => {
    expect(isApproved(approved())).toBe(true);
    const edited = editedReview(approved().text + " changed");
    expect(isApproved(edited)).toBe(false);
    expect(edited.reviewedFacts).toBe(false);
  });
  it("always blocks excluded and nonpublic description sends", () => {
    expect(() => prepareDescription({ baseline: video(), live: video(), review: approved(), excluded: true })).toThrow();
    const hidden = video({ isPublic: false });
    expect(() => prepareDescription({ baseline: hidden, live: hidden, review: approved() })).toThrow();
  });
  it("rolls back only when nothing newer is present", () => {
    const before = video({ description: "old" });
    const written = prepareDescription({ baseline: before, live: before, review: approved() });
    expect(() => prepareRollback({ before, written, live: { ...written, title: "new title" } })).toThrow();
    expect(prepareRollback({ before, written, live: written })).toEqual(before);
  });
  it("verifies unchanged fields on read-back too", () => {
    expect(() => verifyReadBack(video({ tags: ["one"] }), video({ tags: [] }))).toThrow();
  });
  it("edits title and description while keeping status and other metadata", () => {
    const base = launchSnapshot("unlisted");
    const result = prepareMetadata({ baseline: base, live: base, title: "Postgame Media Conference", description: assembleDescription(["Coaches meet with the media."]) });
    expect(result.status).toEqual(base.status);
    expect(result.tags).toEqual(base.tags);
    expect(result.isPublic).toBe(false);
  });
  it("rejects stale revisions and invalid titles", () => {
    const base = launchSnapshot("unlisted");
    expect(() => prepareMetadata({ baseline: base, live: base, title: "x".repeat(101), description: "" })).toThrow();
    expect(() => prepareMetadata({ baseline: base, live: base, title: "<bad>", description: "" })).toThrow();
    expect(() => prepareMetadata({ baseline: base, live: { ...base, title: "Different" }, title: "Ours", description: "" })).toThrow();
  });
  it("allows a title-only edit while the description stays empty", () => {
    const base = launchSnapshot("unlisted");
    expect(prepareMetadata({ baseline: base, live: base, title: "Checked title", description: "" }).description).toBe("");
    expect(() => prepareMetadata({ baseline: base, live: base, title: "Checked title", description: "Missing required attribution" })).toThrow();
  });
  it("sends only mutable snippet fields", () => {
    const body = updateBody(video());
    expect(Object.keys(body).sort()).toEqual(["id", "snippet"]);
    expect(Object.keys(body.snippet as object).sort()).toEqual(["categoryId", "defaultAudioLanguage", "defaultLanguage", "description", "tags", "title"]);
  });
  it("preserves every mutable status field when launching", () => {
    const status = updateBody(approvedLaunch(launchSnapshot()), true).status as Record<string, unknown>;
    expect(status).toEqual({ privacyStatus: "public", license: "youtube", embeddable: true, publicStatsViewable: false, selfDeclaredMadeForKids: false, containsSyntheticMedia: false });
  });
  it("rejects scheduled, processing and plain private launches", () => {
    expect(() => approvedLaunch(launchSnapshot("private", "2026-10-04T01:00:00Z"))).toThrow();
    expect(() => approvedLaunch(launchSnapshot("private", null, "uploaded"))).toThrow();
    const before = launchSnapshot();
    expect(() => prepareDescription({ baseline: before, live: before, review: approved() })).toThrow();
  });
  it("moves between all three visibility settings and preserves everything else", () => {
    const before = launchSnapshot("unlisted");
    for (const target of ["private", "unlisted", "public"]) {
      const after = prepareVisibility({ baseline: before, live: before, target });
      expect(after.status?.privacyStatus).toBe(target);
      expect(after.isPublic).toBe(target === "public");
      expect(after).toMatchObject({ description: before.description, tags: before.tags });
      expect(after.status?.license).toBe("youtube");
    }
    expect(() => prepareVisibility({ baseline: before, live: before, target: "invalid" })).toThrow();
    const scheduled = launchSnapshot("private", "2026-10-04T01:00:00Z");
    expect(() => prepareVisibility({ baseline: scheduled, live: scheduled, target: "public" })).toThrow();
  });
});

describe("publishing coordinator", () => {
  it("journals before writing, uses the etag and verifies", async () => {
    const api = new FakeYouTube({ snapshot: video(), etag: "rev-1" });
    const journal = new FakeJournal();
    api.beforeUpdate = () => expect(journal.saved[0]?.phase).toBe("pending");
    const result = await coordinator(api, journal).send(preview(api.current));
    expect(result.phase).toBe("verified");
    expect(result.verifiedAt).not.toBeNull();
    expect([api.updateCount, api.readCount, api.receivedETag]).toEqual([1, 2, "rev-1"]);
    expect(api.current.snapshot).toMatchObject({ title: "Original title", tags: ["Badgers"] });
  });
  it("never writes when the journal cannot save", async () => {
    const api = new FakeYouTube({ snapshot: video(), etag: "rev-1" });
    const journal = new FakeJournal(); journal.failSave = true;
    await expect(coordinator(api, journal).send(preview(api.current))).rejects.toThrow();
    expect(api.updateCount).toBe(0);
  });
  it("stops before writing when the revision changed", async () => {
    const api = new FakeYouTube({ snapshot: video(), etag: "rev-2" });
    const journal = new FakeJournal();
    await expect(coordinator(api, journal).send(preview({ snapshot: video(), etag: "rev-1" }))).rejects.toThrow();
    expect(api.updateCount).toBe(0);
    expect(journal.saved).toHaveLength(0);
  });
  it("never retries after a timeout and reconciles read-only", async () => {
    const api = new FakeYouTube({ snapshot: video(), etag: "rev-1" }); api.throwAfterApply = true;
    const journal = new FakeJournal(); const engine = coordinator(api, journal);
    await expect(engine.send(preview(api.current))).rejects.toThrow();
    expect(journal.latest.phase).toBe("uncertain");
    await expect(engine.send(preview(api.current))).rejects.toThrow(/needs verification/);
    expect(api.updateCount).toBe(1);
    expect((await engine.reconcile(journal.latest)).phase).toBe("verified");
    expect(api.updateCount).toBe(1);
  });
  it("reconciles a failure before apply as not applied", async () => {
    const api = new FakeYouTube({ snapshot: video(), etag: "rev-1" }); api.throwBeforeApply = true;
    const journal = new FakeJournal(); const engine = coordinator(api, journal);
    await expect(engine.send(preview(api.current))).rejects.toThrow();
    expect((await engine.reconcile(journal.latest)).phase).toBe("notApplied");
  });
  it("records a read-back mismatch as a conflict, not success", async () => {
    const api = new FakeYouTube({ snapshot: video(), etag: "rev-1" }); api.overrideAfterApply = video({ description: "A newer edit" });
    const journal = new FakeJournal();
    await expect(coordinator(api, journal).send(preview(api.current))).rejects.toThrow();
    expect(journal.latest).toMatchObject({ phase: "conflict" });
    expect(journal.latest.readBack?.snapshot.description).toBe("A newer edit");
    expect(journal.latest.failureMessage).not.toBeNull();
    expect([api.updateCount, api.readCount]).toEqual([1, 2]);
  });
  it("re-reads a delayed read-back without repeating the update", async () => {
    const api = new FakeYouTube({ snapshot: video(), etag: "rev-1" }); api.staleReadsAfterApply = 2;
    const result = await coordinator(api, new FakeJournal()).send(preview(api.current));
    expect(result.phase).toBe("verified");
    expect([api.updateCount, api.readCount]).toEqual([1, 4]);
  });
  it("keeps a persistently old read-back uncertain with bounded reads", async () => {
    const api = new FakeYouTube({ snapshot: video(), etag: "rev-1" }); api.staleReadsAfterApply = 99;
    const journal = new FakeJournal(); const engine = coordinator(api, journal);
    await expect(engine.send(preview(api.current))).rejects.toThrow(/previous version/);
    expect(journal.latest.phase).toBe("uncertain");
    expect([api.updateCount, api.readCount]).toEqual([1, 5]);
    api.staleReadsAfterApply = 0;
    const recovered = await engine.reconcile(journal.latest);
    expect(recovered.phase).toBe("verified");
    expect(recovered.failureMessage).toBeNull();
  });
  it("cannot reuse a consumed preview", async () => {
    const api = new FakeYouTube({ snapshot: video(), etag: "rev-1" });
    const engine = coordinator(api, new FakeJournal()); const frozen = preview(api.current);
    await engine.send(frozen);
    await expect(engine.send(frozen)).rejects.toThrow();
    expect(api.updateCount).toBe(1);
  });
  it("rejects a title change smuggled into a description send", async () => {
    const api = new FakeYouTube({ snapshot: video(), etag: "rev-1" });
    await expect(coordinator(api, new FakeJournal()).send(preview(api.current, "send", video({ description: assembleDescription(["Text"]), title: "New title" })))).rejects.toThrow();
    expect(api.updateCount).toBe(0);
  });
  it("rejects another channel and expired previews", async () => {
    const api = new FakeYouTube({ snapshot: video(), etag: "rev-1" });
    await expect(coordinator(api, new FakeJournal(), "other").send(preview(api.current))).rejects.toThrow();
    const stale = { ...preview(api.current), createdAt: new Date(Date.now() - 6 * 60_000).toISOString() };
    await expect(coordinator(api, new FakeJournal()).send(stale)).rejects.toThrow(/expired/);
    expect(api.updateCount).toBe(0);
  });
  it("undoes only a verified send and never over newer edits", async () => {
    const original = video();
    const api = new FakeYouTube({ snapshot: original, etag: "rev-1" }); const journal = new FakeJournal(); const engine = coordinator(api, journal);
    const sent = await engine.send(preview(api.current));
    const restored = await engine.send(preview(api.current, "undo", original, sent.id));
    expect(restored.phase).toBe("verified");
    expect(api.current.snapshot).toEqual(original);

    const api2 = new FakeYouTube({ snapshot: original, etag: "rev-1" }); const engine2 = coordinator(api2, new FakeJournal());
    const sent2 = await engine2.send(preview(api2.current));
    api2.current = { snapshot: video({ description: "New edit" }), etag: "rev-3" };
    await expect(engine2.send(preview(api2.current, "undo", original, sent2.id))).rejects.toThrow();
    expect(api2.updateCount).toBe(1);
  });
  it("launches with verified visibility and never repeats after a timeout", async () => {
    const before = launchSnapshot("unlisted");
    const api = new FakeYouTube({ snapshot: before, etag: "private-1" }); api.throwAfterApply = true;
    const journal = new FakeJournal(); const engine = coordinator(api, journal);
    await expect(engine.send(preview(api.current, "launch", approvedLaunch(before)))).rejects.toThrow();
    expect(journal.latest.phase).toBe("uncertain");
    expect((await engine.reconcile(journal.latest)).phase).toBe("verified");
    expect(api.updateCount).toBe(1);
  });
  it("rejects a private read-back and a tampered audience setting on launch", async () => {
    const before = launchSnapshot(); const expected = approvedLaunch(before);
    const api = new FakeYouTube({ snapshot: before, etag: "private-1" });
    api.overrideAfterApply = { ...expected, isPublic: false, status: before.status };
    const journal = new FakeJournal();
    await expect(coordinator(api, journal).send(preview(api.current, "launch", expected))).rejects.toThrow();
    expect(journal.latest.phase).toBe("conflict");

    const tampered = { ...expected, status: { ...(expected.status as VideoStatus), selfDeclaredMadeForKids: true } };
    const clean = new FakeYouTube({ snapshot: before, etag: "private-1" }); const cleanJournal = new FakeJournal();
    await expect(coordinator(clean, cleanJournal).send(preview(clean.current, "launch", tampered))).rejects.toThrow();
    expect(clean.updateCount).toBe(0);
    expect(cleanJournal.saved).toHaveLength(0);
  });
  it("publishes an empty description by visibility alone without touching the snippet", async () => {
    const before = launchSnapshot("unlisted");
    const expected = prepareVisibility({ baseline: before, live: before, target: "public" });
    expect(Object.keys(visibilityBody(expected)).sort()).toEqual(["id", "status"]);
    const api = new FakeYouTube({ snapshot: before, etag: "rev" });
    const result = await coordinator(api, new FakeJournal()).send(preview(api.current, "visibility", expected));
    expect(result.phase).toBe("verified");
    expect(api.current.snapshot).toMatchObject({ description: "", isPublic: true });
  });
  it("cannot sneak a description change into a visibility send", async () => {
    const before = launchSnapshot();
    const allowed = prepareVisibility({ baseline: before, live: before, target: "public" });
    const api = new FakeYouTube({ snapshot: before, etag: "rev" }); const journal = new FakeJournal();
    await expect(coordinator(api, journal).send(preview(api.current, "visibility", { ...allowed, description: "Unapproved description" }))).rejects.toThrow();
    expect(api.updateCount).toBe(0);
    expect(journal.saved).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- playlists

const PLAYLIST_VIDEO: VideoSnapshot = { id: "video", title: "Highlights", description: "Keep this", tags: ["UW"], categoryId: "17", isPublic: true, channelId: "channel", isLive: false };

class PlaylistAPI implements PlaylistTransport {
  current: LiveVideo = { snapshot: PLAYLIST_VIDEO, etag: "1" };
  playlist: YouTubePlaylist = { id: "playlist", title: "Volleyball", channelId: "channel", privacy: "public", itemCount: 1 };
  applied = false; timeout = false; wrongMembership = false; multiplePages = false; repeatPages = false; failSecondPage = false;
  inserts = 0; membershipReads = 0; staleReads = 0;
  pageTokens: Array<string | null> = []; videoPageTokens: Array<string | null> = [];
  beforeInsert?: () => void;
  async read() { return this.current; }
  async readPlaylist() { return this.playlist; }
  async playlistPage(token: string | null) {
    this.pageTokens.push(token);
    return { items: [this.playlist], nextToken: this.multiplePages && token == null ? "next" : null };
  }
  async playlistVideoPage(_id: string, token: string | null) {
    this.videoPageTokens.push(token);
    if (token != null && this.failSecondPage) throw new Error("Offline");
    return { ids: token == null ? ["first"] : ["first", "second"], nextToken: this.multiplePages && (token == null || this.repeatPages) ? "next" : null };
  }
  async membership(videoId: string, playlistId: string): Promise<PlaylistMembership | null> {
    this.membershipReads += 1;
    if (!this.applied) return null;
    if (this.staleReads > 0) { this.staleReads -= 1; return null; }
    return { id: "item", playlistId, videoId: this.wrongMembership ? "other" : videoId };
  }
  async insert(videoId: string, playlistId: string) {
    this.beforeInsert?.(); this.inserts += 1; this.applied = true;
    if (this.timeout) throw new Error("Timed out after insert");
    return { id: "item", playlistId, videoId: this.wrongMembership ? "other" : videoId };
  }
}

class PlaylistMemoryJournal implements PlaylistJournal {
  saved: PlaylistAddition[] = []; fail = false;
  get latest() {
    const record = this.saved[0];
    if (!record) throw new Error("No journal record");
    return record;
  }
  async records() { return this.saved; }
  async save(record: PlaylistAddition) {
    if (this.fail) throw new Error("Disk full");
    this.saved = [structuredClone(record), ...this.saved.filter((r) => r.id !== record.id)];
  }
}

const playlistEngine = (api: PlaylistAPI, journal: PlaylistMemoryJournal) =>
  new PlaylistCoordinator(api, journal, { channelId: "channel", waitForPropagation: async () => {} });
const ALLOWED = new Set(["video"]);

describe("playlist coordinator", () => {
  it("journals, then verifies the addition without touching video metadata", async () => {
    const api = new PlaylistAPI(); const journal = new PlaylistMemoryJournal();
    api.beforeInsert = () => expect(journal.saved[0]?.phase).toBe("pending");
    await playlistEngine(api, journal).add(PLAYLIST_VIDEO, api.playlist, ALLOWED);
    expect(api.inserts).toBe(1);
    expect(journal.latest).toMatchObject({ phase: "verified", membership: { videoId: "video" } });
    expect(api.current.snapshot).toEqual(PLAYLIST_VIDEO);
  });
  it("skips insertion when the membership already exists", async () => {
    const api = new PlaylistAPI(); api.applied = true; const journal = new PlaylistMemoryJournal();
    await playlistEngine(api, journal).add(PLAYLIST_VIDEO, api.playlist, ALLOWED);
    expect(api.inserts).toBe(0);
    expect(journal.saved).toHaveLength(0);
  });
  it("cannot insert without a durable journal", async () => {
    const api = new PlaylistAPI(); const journal = new PlaylistMemoryJournal(); journal.fail = true;
    await expect(playlistEngine(api, journal).add(PLAYLIST_VIDEO, api.playlist, ALLOWED)).rejects.toThrow();
    expect(api.inserts).toBe(0);
  });
  it("blocks a retry after a timeout and reconciles without writing", async () => {
    const api = new PlaylistAPI(); api.timeout = true; const journal = new PlaylistMemoryJournal(); const engine = playlistEngine(api, journal);
    await expect(engine.add(PLAYLIST_VIDEO, api.playlist, ALLOWED)).rejects.toThrow();
    expect(journal.latest.phase).toBe("uncertain");
    await expect(engine.add(PLAYLIST_VIDEO, api.playlist, ALLOWED)).rejects.toThrow();
    expect(api.inserts).toBe(1);
    expect((await engine.reconcile(journal.latest)).phase).toBe("verified");
    expect(api.inserts).toBe(1);
  });
  it("retries only reads for a delayed membership, with a bound", async () => {
    const api = new PlaylistAPI(); api.staleReads = 2;
    await playlistEngine(api, new PlaylistMemoryJournal()).add(PLAYLIST_VIDEO, api.playlist, ALLOWED);
    expect([api.membershipReads, api.inserts]).toEqual([4, 1]);
    const delayed = new PlaylistAPI(); delayed.staleReads = 20; const journal = new PlaylistMemoryJournal();
    await expect(playlistEngine(delayed, journal).add(PLAYLIST_VIDEO, delayed.playlist, ALLOWED)).rejects.toThrow();
    expect([delayed.membershipReads, delayed.inserts]).toEqual([5, 1]);
    expect(journal.latest.phase).toBe("uncertain");
  });
  it("refuses a changed destination, changed video or out-of-scope video", async () => {
    for (const change of ["channel", "title", "privacy", "video", "scope"]) {
      const api = new PlaylistAPI(); const original = api.playlist;
      if (change === "channel") api.playlist = { ...original, channelId: "other" };
      if (change === "title") api.playlist = { ...original, title: "Renamed" };
      if (change === "privacy") api.playlist = { ...original, privacy: "private" };
      if (change === "video") api.current = { snapshot: { ...PLAYLIST_VIDEO, title: "Renamed video" }, etag: "2" };
      await expect(playlistEngine(api, new PlaylistMemoryJournal()).add(PLAYLIST_VIDEO, original, change === "scope" ? new Set() : ALLOWED), change).rejects.toThrow();
      expect(api.inserts, change).toBe(0);
    }
  });
  it("cannot report an unexpected membership as success", async () => {
    const api = new PlaylistAPI(); api.wrongMembership = true; const journal = new PlaylistMemoryJournal();
    await expect(playlistEngine(api, journal).add(PLAYLIST_VIDEO, api.playlist, ALLOWED)).rejects.toThrow();
    expect(journal.latest.phase).toBe("uncertain");
  });
});

describe("pagination", () => {
  it("loads playlists and their videos completely and deduplicated", async () => {
    const api = new PlaylistAPI(); api.multiplePages = true;
    expect((await loadPlaylists(api, "channel")).map((p) => p.id)).toEqual(["playlist"]);
    expect([...(await loadPlaylistVideoIds(api, "playlist"))]).toEqual(["first", "second"]);
    expect(api.pageTokens).toEqual([null, "next"]);
    expect(api.videoPageTokens).toEqual([null, "next"]);
  });
  it("fails rather than looking empty when pages are incomplete or repeat", async () => {
    for (const mode of ["limit", "repeat", "offline"]) {
      const api = new PlaylistAPI(); api.multiplePages = true; api.repeatPages = mode === "repeat"; api.failSecondPage = mode === "offline";
      await expect(loadPlaylistVideoIds(api, "playlist", mode === "limit" ? 1 : 5), mode).rejects.toThrow();
    }
  });
  it("deduplicates uploads across pages and reports the coverage limit", async () => {
    const pages = [{ ids: ["one", "old"], nextToken: "page2" }, { ids: ["one", "two"], nextToken: null }];
    expect(await loadUploadIds({ uploadPage: async () => pages.shift()! })).toEqual({ ids: ["one", "old", "two"], reachedLimit: false });
    expect(await loadUploadIds({ uploadPage: async () => ({ ids: ["one"], nextToken: "second" }) }, 1)).toEqual({ ids: ["one"], reachedLimit: true });
    const repeating = [{ ids: ["one"], nextToken: "repeated" }, { ids: [], nextToken: "repeated" }];
    await expect(loadUploadIds({ uploadPage: async () => repeating.shift()! })).rejects.toThrow();
    const failing = [{ ids: ["one"], nextToken: "second" }];
    await expect(loadUploadIds({ uploadPage: async () => { const page = failing.shift(); if (!page) throw new Error("Network"); return page; } })).rejects.toThrow();
  });
});
