import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildRecapDocument, extractRecap } from "@/lib/youtube/recap";
import {
  assembleDescription,
  chaptersValid,
  checkedTitle,
  chicagoDay,
  conferenceDescription,
  conferenceKind,
  DESCRIPTION_FOOTER,
  descriptionFromSelection,
  descriptionProblems,
  identifyVideo,
  initialSelection,
  LibraryWindow,
  removeOpeningDateline,
  resolveGame,
  suggestPlaylists,
  usesManualReview,
} from "@/lib/youtube/rules";
import type { Game, VideoSnapshot } from "@/lib/youtube/types";

const FIXTURES = path.join(__dirname, "fixtures/youtube");

describe("schedule matching", () => {
  const game: Game = { id: "17249", date: "2026-09-27", sport: "Volleyball", opponent: "Purdue", recapUrl: "https://uwbadgers.com/news/2026/9/27/recap" };
  const resolve = (games: Game[], gameDate: string | null = "2026-09-27", uploadDate = "2026-09-28") =>
    resolveGame({ sport: "Wisconsin Volleyball", opponent: "Purdue", gameDate, uploadDate, games });

  it("matches a late upload to its game date", () => expect(resolve([game])).toEqual({ kind: "matched", game }));
  it("never falls back across sports", () => expect(resolve([{ ...game, sport: "Women's Soccer" }])).toEqual({ kind: "missing" }));
  it("holds a same-day doubleheader as ambiguous", () => {
    const result = resolve([game, { ...game, id: "other" }]);
    expect(result.kind).toBe("ambiguous");
    expect(result.kind === "ambiguous" && result.games).toHaveLength(2);
  });
  it("holds out-of-window and impossible dates", () => {
    expect(resolve([game], "2026-09-27", "2026-10-01")).toEqual({ kind: "dateConflict" });
    expect(resolve([game], "2026-02-30")).toEqual({ kind: "dateConflict" });
  });
  it("holds a game without a recap", () => {
    const noRecap = { ...game, recapUrl: null };
    expect(resolve([noRecap])).toEqual({ kind: "missingRecap", game: noRecap });
  });
  it("cannot guess a repeated opponent without a date", () => {
    expect(resolve([game, { ...game, id: "other", date: "2026-09-28" }], null).kind).toBe("ambiguous");
  });
});

describe("recap excerpts", () => {
  const doc = (paragraphs: string[]) => buildRecapDocument("https://uwbadgers.com/news/a", paragraphs);

  it("keeps selected sentences verbatim with the footer", () => {
    const recap = doc(["Wisconsin won 3-0. Eva Travis had seven kills.", "Lynney Tarnow added four blocks."]);
    expect(recap.sentences).toHaveLength(3);
    expect(descriptionFromSelection(recap, [recap.sentences[0]!.id, recap.sentences[2]!.id])).toBe(
      `Wisconsin won 3-0.\n\nLynney Tarnow added four blocks.\n\n${DESCRIPTION_FOOTER}`,
    );
    expect(descriptionFromSelection(recap, [])).toBe("");
  });

  it("never includes Up Next copy", () => {
    const recap = doc(["Wisconsin won 3-0.", "Up Next: Wisconsin hosts Auburn.", "First serve is at 7 p.m."]);
    const all = descriptionFromSelection(recap, recap.sentences.map((s) => s.id));
    expect(all).not.toContain("Auburn");
    expect(all).not.toContain("First serve");
  });

  it("keeps rankings and datelines in their sentence", () => {
    const opening = "WEST LAFAYETTE, Ind. — The No. 6 Wisconsin volleyball team swept the No. 10 Purdue Boilermakers in three sets.";
    expect(doc([opening]).sentences.map((s) => s.text)).toEqual([opening]);
  });

  it("omits only the opening dateline and leaves the source untouched", () => {
    const opening = "MADISON, Wis. — The No. 6 Wisconsin volleyball team won in five sets.";
    const recap = doc([opening, "The match was played in MADISON, Wis. — the team's home city."]);
    const ids = recap.sentences.map((s) => s.id);
    const excerpt = descriptionFromSelection(recap, ids);
    expect(excerpt.startsWith("The No. 6 Wisconsin volleyball team won in five sets.")).toBe(true);
    expect(excerpt).toContain("in MADISON, Wis. — the team's home city.");
    expect(recap.paragraphs[0]).toBe(opening);
    expect(recap.sentences[0]!.text).toBe(opening);
    expect(excerpt.endsWith(DESCRIPTION_FOOTER)).toBe(true);
  });

  it("recognizes dateline formats and leaves ordinary openings alone", () => {
    for (const prefix of ["MADISON, Wis. — ", "WEST LAFAYETTE, Ind. – ", "ANN ARBOR, Mich. - ", "STATE COLLEGE, Pa. -- "]) {
      expect(removeOpeningDateline(`${prefix}Wisconsin won 3-0.`)).toBe("Wisconsin won 3-0.");
    }
    for (const text of ["Wisconsin won in Madison, Wis. — its home court.", "The Badgers — led by Flanagan — won.", "MADISON, Wis. hosted the match."]) {
      expect(removeOpeningDateline(text)).toBe(text);
    }
  });

  it("keeps coach quotes with their attribution", () => {
    const quote = 'Head Coach Kelly Sheffield: "We battled. We fought."';
    expect(doc([quote]).sentences.map((s) => s.text)).toEqual([quote]);
  });

  it("produces stable sentence ids", () => {
    expect(doc(["Wisconsin won 3-0."]).sentences[0]!.id).toBe(doc(["Wisconsin won 3-0."]).sentences[0]!.id);
  });

  it("extracts and matches the six real recaps", () => {
    const videos = JSON.parse(readFileSync(path.join(FIXTURES, "examples.json"), "utf8")) as Array<{
      id: string; sport: string; opponent: string; gameDate: string; uploadDate: string; recapURL: string | null;
      protectedReason: string | null; games: Array<Game & { recapURL?: string }>;
    }>;
    expect(videos).toHaveLength(8);
    expect(videos.filter((v) => v.protectedReason)).toHaveLength(2);
    for (const video of videos.filter((v) => !v.protectedReason)) {
      const html = readFileSync(path.join(FIXTURES, "Recaps", `${video.id}.html`), "utf8");
      const recap = extractRecap(html, video.recapURL!);
      expect(recap.sentences.length, video.opponent).toBeGreaterThan(8);
      const text = recap.paragraphs.join("");
      expect(text).not.toContain("pic.twitter.com");
      expect(text).not.toContain("<script");
      const selection = initialSelection(recap);
      expect(selection.length).toBeGreaterThan(0);
      for (const sentence of recap.sentences) expect(recap.paragraphs[sentence.paragraph]).toContain(sentence.text);
      expect(descriptionProblems(descriptionFromSelection(recap, selection)), video.opponent).toEqual([]);
      const games = video.games.map((g) => ({ ...g, recapUrl: g.recapURL ?? null }));
      const match = resolveGame({ sport: video.sport, opponent: video.opponent, gameDate: video.gameDate, uploadDate: video.uploadDate, games });
      expect(match.kind, video.opponent).toBe("matched");
      expect(match.kind === "matched" && match.game.recapUrl).toBe(video.recapURL);
    }
  });

  it("builds a two-sentence synopsis from every real recap: the result plus one standout", () => {
    const videos = JSON.parse(readFileSync(path.join(FIXTURES, "examples.json"), "utf8")) as Array<{ id: string; opponent: string; recapURL: string | null; protectedReason: string | null }>;
    for (const video of videos.filter((v) => !v.protectedReason)) {
      const recap = extractRecap(readFileSync(path.join(FIXTURES, "Recaps", `${video.id}.html`), "utf8"), video.recapURL!);
      const ids = initialSelection(recap);
      expect(ids.length, video.opponent).toBeGreaterThanOrEqual(1);
      expect(ids.length, video.opponent).toBeLessThanOrEqual(2);
      expect(ids[0], video.opponent).toBe(recap.sentences[0]?.id);
      expect(recap.sentences.filter((s) => ids.includes(s.id)).reduce((n, s) => n + s.text.split(/\s+/).length, 0), video.opponent).toBeLessThanOrEqual(75);
    }
  });

  it("prefers a curated notes stat over play-by-play, and never the opponent's goal", () => {
    const body = [
      "MADISON, Wis. — The Wisconsin men's hockey team bested the Colonials 4-2 on Friday at the Kohl Center.",
      "Halfway through the second period, Bruno Idzan received a pass from Osburn and backhanded a goal to put the Badgers up 2-0.",
      "In the last 12 seconds, Robert Morris was able to tally one last goal for a final score of 4-2.",
      "NOTES TO KNOW",
      "Badgers have won 3 out of 4 season openers under Mike Hastings",
      "Career high 3 assists and 3 points for Vasily Zelenov",
      "STRAIGHT FROM THE RINK",
      "Photo gallery and more from the game.",
    ];
    const recap = buildRecapDocument("https://uwbadgers.com/news/a", body);
    const text = descriptionFromSelection(recap, initialSelection(recap));
    expect(text).toContain("Career high 3 assists");
    expect(text).not.toContain("Robert Morris");
    expect(text).not.toContain("Photo gallery");
  });

  it("keeps the opening excerpt short and stops before a notes section", () => {
    const body = [
      "MADISON, Wis. — The Badgers beat the Colonials 4-2 on Friday night at the Kohl Center.",
      "Vasily Zelenov had three assists and Luke Osburn scored twice in the win.",
      "NOTES TO KNOW",
      "Wisconsin has won three of four openers under its coach.",
      "Follow the Badgers on social media #Badgers",
    ];
    const recap = buildRecapDocument("https://uwbadgers.com/news/a", body);
    const text = descriptionFromSelection(recap, initialSelection(recap));
    expect(text).toContain("Zelenov");
    expect(text).not.toContain("NOTES TO KNOW");
    expect(text).not.toContain("three of four");
    expect(text).not.toContain("Follow the Badgers");
  });

  it("writes vs. with a period in titles, except Cinematic Recap titles", () => {
    expect(checkedTitle("Highlights vs Robert Morris || Wisconsin Men's Hockey || Oct. 3, 2026")).toBe(
      "Highlights vs. Robert Morris || Wisconsin Men's Hockey || Oct. 3, 2026",
    );
    expect(checkedTitle("Highlights vs. Robert Morris || Wisconsin Men's Hockey || Oct. 3, 2026")).toBe(
      "Highlights vs. Robert Morris || Wisconsin Men's Hockey || Oct. 3, 2026",
    );
    expect(checkedTitle("2026 Wisconsin Football || Cinematic Recap vs Penn State")).toBe("2026 Wisconsin Football || Cinematic Recap vs Penn State");
  });

  it("refuses markup without a recognized story body", () => {
    expect(() => extractRecap("<html><p>Access denied</p></html>", "https://uwbadgers.com/news/a")).toThrow();
  });
});

describe("press conference templates", () => {
  it("produces deterministic grammar for weekly coach tiles", () => {
    expect(conferenceDescription(["volleyball", "football"], "Weekly", null)).toBe(
      assembleDescription(["Head football coach Luke Fickell and head volleyball coach Kelly Sheffield meet with the media."]),
    );
    expect(conferenceDescription(["mhockey"], "Weekly", null)).toContain("Mike Hastings meets");
    expect(conferenceDescription([], "Weekly", null)).toBeNull();
  });

  it("needs a valid official game for postgame and never invents an outcome", () => {
    expect(conferenceDescription(["mhockey"], "Postgame", null)).toBeNull();
    const text = conferenceDescription(["mhockey"], "Postgame", { id: "17348", date: "2026-10-02", sport: "Men's Hockey", opponent: "Robert Morris" })!;
    expect(text).toContain("following Wisconsin's game against Robert Morris on October 2, 2026.");
    expect(text).not.toMatch(/ (victory|win) /);
    expect(descriptionProblems(text)).toEqual([]);
    expect(conferenceDescription(["mhockey"], "Postgame", { id: "bad", date: "bad", sport: "Men's Hockey", opponent: "Robert Morris" })).toBeNull();
  });

  it("detects the format and cleans the title", () => {
    expect(conferenceKind("Post Game Media Conference")).toBe("Postgame");
    expect(conferenceKind("Weekly Media Conference")).toBe("Weekly");
    expect(checkedTitle("Mike Hastings Post Game Media Conference ||Wisconsin Men's Hockey")).toBe(
      "Mike Hastings Postgame Media Conference || Wisconsin Men's Hockey",
    );
  });
});

describe("video library", () => {
  const now = new Date("2026-10-02T18:00:00Z");
  const video = (title = "Highlights vs Indiana || Wisconsin Volleyball || Oct. 1, 2026", over: Partial<VideoSnapshot> = {}, publishedAt = "2026-10-02T02:00:00Z") => ({
    snapshot: { id: "indiana", title, description: "Existing", categoryId: "17", isPublic: true, channelId: "wisconsin", isLive: false, ...over },
    publishedAt: new Date(publishedAt),
  });

  it("recognizes exact sport, opponent and game date", () => {
    expect(identifyVideo(video(), now)).toMatchObject({ sport: "Volleyball", opponent: "Indiana", gameDate: "2026-10-01", hold: null });
    expect(identifyVideo(video("Highlights at Purdue || Wisconsin Volleyball || Sept. 27, 2026"), now).gameDate).toBe("2026-09-27");
  });

  it("does not guess a sport from the opponent", () => {
    const identity = identifyVideo(video("Wisconsin Highlights vs. Oregon"), now);
    expect(identity.sport).toBe("Unassigned");
    expect(identity.hold).not.toBeNull();
    expect(identity.excluded).toBe(false);
  });

  it("keeps men's and women's sports separate", () => {
    expect(identifyVideo(video("Highlights vs Michigan || Wisconsin Women's Hockey || Oct. 1, 2026"), now).sport).toBe("Women's Hockey");
  });

  it("makes the date optional but requires opponent and sport", () => {
    const identity = identifyVideo(video("Wisconsin Volleyball vs UW-Milwaukee | Highlights"), now);
    expect(identity).toMatchObject({ gameDate: null, opponent: "UW-Milwaukee", hold: null });
    expect(identifyVideo(video("Wisconsin Volleyball Highlights"), now).hold).not.toBeNull();
  });

  it("excludes protected, nonpublic and live videos and routes other formats to manual review", () => {
    for (const item of [video(undefined, { id: "Bge051LX6DM" }), video(undefined, { id: "Dj6ZKiRqx5w" }), video(undefined, { isPublic: false }), video(undefined, { isLive: true })]) {
      expect(identifyVideo(item, now).excluded).toBe(true);
    }
    for (const title of ["Wisconsin Football || Cinematic highlights vs Indiana", "Wisconsin Volleyball Media Day Highlights",
      "Wisconsin Volleyball Exhibition Highlights vs Indiana", "Post-match press conference || Wisconsin Volleyball"]) {
      expect(identifyVideo(video(title), now).excluded).toBe(false);
      expect(usesManualReview(title)).toBe(true);
    }
  });

  it("uses the Chicago day and excludes future uploads and backfill", () => {
    expect(chicagoDay(new Date("2026-10-02T02:00:00Z"))).toBe("2026-10-01");
    expect(LibraryWindow.contains(new Date("2026-09-03T04:59:59Z"), now)).toBe(false);
    expect(LibraryWindow.contains(new Date("2026-09-03T05:00:00Z"), now)).toBe(true);
    expect(LibraryWindow.contains(new Date(now.getTime() + 1000), now)).toBe(false);
    expect(identifyVideo(video(undefined, {}, "2026-08-15T12:00:00Z"), now).excluded).toBe(true);
  });

  it("builds a schedule window across a month boundary", () => {
    expect(LibraryWindow.datesAround("2026-10-01")).toEqual(["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03"]);
  });
});

describe("playlist suggestions", () => {
  const lists = ["2026-27 Men's Hockey", "2026-27 Women's Hockey", "Men's Hockey Press Conferences", "2025-26 Men's Hockey", "2026 Volleyball"].map((title) => ({ title }));

  it("keeps men's and women's playlists apart and prefers conference lists for conferences", () => {
    expect(suggestPlaylists(lists, "Men's Hockey", "2026-10-02", false).map((l) => l.title)).toEqual(["2026-27 Men's Hockey"]);
    expect(suggestPlaylists(lists, "Men's Hockey", "2026-10-02", true).map((l) => l.title)).toEqual(["Men's Hockey Press Conferences", "2026-27 Men's Hockey"]);
    expect(suggestPlaylists(lists, "Unassigned", "2026-10-02", false)).toEqual([]);
  });
});

describe("chapters", () => {
  it("enforces three chapters from 0:00, each at least ten seconds", () => {
    const chapters = [{ seconds: 0, label: "Opening" }, { seconds: 10, label: "Coach" }, { seconds: 20, label: "Questions" }];
    expect(chaptersValid(chapters, 29)).toBe(false);
    expect(chaptersValid(chapters, 30)).toBe(true);
    expect(chaptersValid(chapters.slice(0, 2), 100)).toBe(false);
  });
});
