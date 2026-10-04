// The review queue's rules: how a recent upload is matched to its official
// source, what its draft title and description are, and what still needs
// attention. Ported from the Mac app's ReviewStore. Pure and client-safe: the
// schedule and recap are injected, so the server prepares drafts and the
// editor re-evaluates them with the same code.

import {
  apDate,
  canonicalOpponent,
  canonicalSport,
  checkedTitle,
  conferenceDescription,
  conferenceKind as titleConferenceKind,
  CONFERENCE_COACHES,
  descriptionFromSelection,
  descriptionProblems,
  DESCRIPTION_FOOTER,
  identifyVideo,
  initialSelection,
  isConference,
  LibraryWindow,
  MATCH_LABELS,
  parseDay,
  chicagoDay,
  resolveGame,
  SPORTS,
  suggestPlaylists,
  titleProblems,
  UNASSIGNED,
  usesManualReview,
  type ConferenceKind,
  type MatchResult,
} from "./rules";
import type { CatalogVideo, Game, RecapDocument, VideoSnapshot, YouTubePlaylist } from "./types";

/** The saved review for one video. Mirrors the YouTubeReviewDraft row. */
export interface ReviewDraft {
  videoId: string;
  version: number;
  matchedTitle: string | null;
  matchedGame: Game | null;
  recap: RecapDocument | null;
  selectedSentenceIds: string[];
  editedTitle: string | null;
  editedDescription: string | null;
  manualSource: boolean;
  manualVideo: boolean;
  conferenceKind: ConferenceKind | null;
  speakerIds: string[];
  plannedPlaylistIds: string[];
  matchKind: MatchResult["kind"] | null;
  gameChoices: Game[];
  hold: string | null;
  preparedAt: string | null;
}

export function emptyDraft(videoId: string): ReviewDraft {
  return {
    videoId, version: 0, matchedTitle: null, matchedGame: null, recap: null, selectedSentenceIds: [], editedTitle: null,
    editedDescription: null, manualSource: false, manualVideo: false, conferenceKind: null, speakerIds: [], plannedPlaylistIds: [],
    matchKind: null, gameChoices: [], hold: null, preparedAt: null,
  };
}

export interface ReviewVideo {
  id: string;
  title: string;
  sport: string;
  opponent: string;
  gameDate: string | null;
  /** America/Chicago day of the video's publish time. */
  uploadDate: string;
  /** Set for videos the tool never edits (protected, live, scheduled, processing, outside the window). */
  protectedReason: string | null;
  /** Identity problem from the title that only an official game choice resolves. */
  identityHold: string | null;
}

/** The draft's matched source applies only while the YouTube title it was matched against is unchanged. */
const draftMatchesTitle = (video: { title: string }, draft: ReviewDraft | null) => draft?.matchedTitle === video.title;

export function reviewVideo(item: CatalogVideo, draft: ReviewDraft | null, now: Date): ReviewVideo {
  const snapshot = item.live.snapshot;
  const identity = identifyVideo({ snapshot, publishedAt: new Date(item.publishedAt) }, now);
  const matchedSport = draftMatchesTitle(snapshot, draft) ? draft?.matchedGame?.sport : undefined;
  const confirmed = draftMatchesTitle(snapshot, draft) && draft?.matchedGame != null;
  return {
    id: snapshot.id,
    title: snapshot.title,
    sport: matchedSport ? displaySport(matchedSport) : identity.sport,
    opponent: identity.opponent,
    gameDate: identity.gameDate,
    uploadDate: chicagoDay(new Date(item.publishedAt)),
    protectedReason: identity.excluded ? identity.hold : null,
    identityHold: !identity.excluded && identity.hold && !confirmed ? identity.hold : null,
  };
}

/** The tool's sport label for a schedule sport ("Women's Volleyball" reads as "Volleyball"). */
export function displaySport(scheduleSport: string): string {
  return SPORTS.find((sport) => canonicalSport(sport) === canonicalSport(scheduleSport)) ?? scheduleSport;
}

// ---------------------------------------------------------------- preparation

export interface ReviewSources {
  games(date: string): Promise<Game[]>;
  recap(url: string): Promise<RecapDocument>;
}

async function gamesAround(day: string, sources: ReviewSources, dates = LibraryWindow.datesAround(day)): Promise<Game[]> {
  const lists = await Promise.all(dates.map((date) => sources.games(date)));
  return uniqueGames(lists.flat());
}

function uniqueGames(games: Game[]): Game[] {
  return [...new Map(games.map((game) => [game.id, game])).values()].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

const withinTwoDays = (a: string, b: string) => {
  const left = parseDay(a), right = parseDay(b);
  return left != null && right != null && Math.abs(left.getTime() - right.getTime()) <= 2 * 86_400_000;
};

const sameGame = (a: Game, b: Game) => a.id === b.id && a.date === b.date && a.sport === b.sport;

/**
 * Matches the video to its official source and returns the updated draft.
 * Manual title and description edits always survive; a changed recap resets
 * only the sentence selection. Failures become the draft's hold, never a guess.
 */
export async function prepareDraft(video: ReviewVideo, current: ReviewDraft | null, sources: ReviewSources, now: Date): Promise<ReviewDraft> {
  const draft: ReviewDraft = { ...(current ?? emptyDraft(video.id)), hold: null, preparedAt: now.toISOString() };
  try {
    if (usesManualReview(video.title)) return await prepareTemplateVideo(video, draft, sources);

    const dates = video.gameDate ? [video.gameDate] : LibraryWindow.datesAround(video.uploadDate);
    const games = await gamesAround(video.uploadDate, sources, dates);
    if (video.sport === UNASSIGNED) {
      draft.gameChoices = games.filter((game) => canonicalOpponent(game.opponent) === canonicalOpponent(video.opponent) && withinTwoDays(game.date, video.uploadDate));
      draft.matchKind = null;
      draft.hold = "Choose the official game to confirm the sport and recap.";
      return draft;
    }
    if (video.identityHold) {
      draft.hold = video.identityHold;
      return draft;
    }
    const savedGame = draftMatchesTitle(video, current) ? current?.matchedGame : null;
    const result = resolveGame({ sport: video.sport, opponent: video.opponent, gameDate: savedGame?.date ?? video.gameDate, uploadDate: video.uploadDate, games });
    draft.matchKind = result.kind;
    draft.gameChoices = result.kind === "ambiguous" ? result.games : [];
    if (result.kind === "missingRecap" && current?.manualSource && savedGame) {
      return { ...draft, matchedGame: result.game, matchedTitle: video.title };
    }
    if (result.kind !== "matched" || !result.game.recapUrl) {
      draft.hold = `${MATCH_LABELS[result.kind]}. Refresh after the official schedule or recap is updated.`;
      return draft;
    }
    return { ...draft, ...(await sourceFor(result.game, result.game.recapUrl, current, sources)), matchedTitle: video.title, matchedGame: result.game, manualSource: false };
  } catch (error) {
    draft.hold = error instanceof Error ? error.message : String(error);
    return draft;
  }
}

async function sourceFor(game: Game, url: string, current: ReviewDraft | null, sources: ReviewSources): Promise<Pick<ReviewDraft, "recap" | "selectedSentenceIds">> {
  const recap = await sources.recap(url);
  const unchanged = current?.recap && current.recap.sha256 === recap.sha256 && current.recap.url === recap.url;
  return { recap, selectedSentenceIds: unchanged ? current.selectedSentenceIds : initialSelection(recap) };
}

async function prepareTemplateVideo(video: ReviewVideo, draft: ReviewDraft, sources: ReviewSources): Promise<ReviewDraft> {
  draft.manualVideo = true;
  draft.matchedTitle = video.title;
  draft.matchKind = null;
  draft.gameChoices = [];
  if (!isConference(video.title)) return draft;
  const games = await gamesAround(video.uploadDate, sources);
  draft.gameChoices = games.filter(
    (game) => (video.sport === UNASSIGNED || canonicalSport(game.sport) === canonicalSport(video.sport)) && withinTwoDays(game.date, video.uploadDate),
  );
  const chosen = draft.matchedGame;
  const fresh = chosen ? draft.gameChoices.find((game) => sameGame(game, chosen)) : undefined;
  draft.matchedGame = fresh ?? null;
  draft.matchKind = fresh ? "matched" : null;
  return draft;
}

/** Confirms one of the offered official games. Highlights then load that game's recap. */
export async function chooseGame(video: ReviewVideo, current: ReviewDraft, gameId: string, sources: ReviewSources): Promise<ReviewDraft> {
  const game = current.gameChoices.find((choice) => choice.id === gameId);
  if (!game) throw new Error("That game is not one of the official choices for this video.");
  if (current.manualVideo) return { ...current, matchedGame: game, matchKind: "matched", hold: null };
  if (game.recapUrl) {
    return { ...current, ...(await sourceFor(game, game.recapUrl, current, sources)), matchedTitle: video.title, matchedGame: game, matchKind: "matched", manualSource: false, hold: null };
  }
  return { ...current, recap: null, selectedSentenceIds: [], matchedTitle: video.title, matchedGame: game, matchKind: "missingRecap", manualSource: true, hold: null };
}

// ---------------------------------------------------------------- evaluation

export const draftTitle = (video: ReviewVideo, draft: ReviewDraft | null) => draft?.editedTitle ?? video.title;

export function draftDescription(draft: ReviewDraft | null, live: VideoSnapshot | null): string {
  if (!draft) return "";
  if (draft.editedDescription != null) return draft.editedDescription;
  if (draft.recap) return descriptionFromSelection(draft.recap, draft.selectedSentenceIds);
  // Template videos and manual sources start from what YouTube has now.
  return draft.manualVideo || draft.manualSource ? live?.description ?? "" : "";
}

export function draftConferenceKind(video: ReviewVideo, draft: ReviewDraft | null): ConferenceKind {
  return draft?.conferenceKind ?? titleConferenceKind(video.title);
}

/** Template description for the chosen coaches, or null until it can be written without guessing. */
export function conferenceTemplate(video: ReviewVideo, draft: ReviewDraft | null): string | null {
  return conferenceDescription(draft?.speakerIds ?? [], draftConferenceKind(video, draft), draft?.matchedGame ?? null);
}

/** Highlights follow FORMATS.md; every other title only gets mechanical cleanup. */
export function suggestedTitle(video: ReviewVideo, draft: ReviewDraft | null): string {
  const game = draft?.matchedGame;
  if (!usesManualReview(video.title) && game && draftMatchesTitle(video, draft)) {
    const date = apDate(game.date);
    if (date) {
      const direction = game.atVs ?? (/\bat\s/i.test(video.title) ? "at" : "vs");
      return `Highlights ${direction} ${video.opponent || game.opponent} || Wisconsin ${displaySport(game.sport)} || ${date}`;
    }
  }
  return checkedTitle(draftTitle(video, draft));
}

export function playlistSuggestions(video: ReviewVideo, playlists: YouTubePlaylist[]): YouTubePlaylist[] {
  return suggestPlaylists(playlists, video.sport, video.uploadDate, isConference(video.title));
}

export interface ReviewCheck {
  id: "game" | "title" | "description" | "playlists" | "visibility";
  title: string;
  detail: string;
  complete: boolean;
}

export interface PlaylistContext {
  /** Playlists that already contain the video, among those the tool checked. */
  existing: YouTubePlaylist[];
  /** False when the playlist check failed or has not run. */
  checked: boolean;
}

export function reviewChecks(video: ReviewVideo, draft: ReviewDraft | null, live: VideoSnapshot | null, playlists: PlaylistContext): ReviewCheck[] {
  const title = draftTitle(video, draft);
  const description = draftDescription(draft, live);
  const gameRequired = !usesManualReview(video.title) || (isConference(video.title) && draftConferenceKind(video, draft) === "Postgame");
  const game = draft?.matchedGame;
  const titleGood = suggestedTitle(video, draft) === title && titleProblems(title).length === 0;
  const body = description.replace(DESCRIPTION_FOOTER, "").trim();
  const problems = descriptionProblems(description);
  const planned = draft?.plannedPlaylistIds ?? [];
  const privacy = live?.status?.privacyStatus ?? (live?.isPublic ? "public" : "private");
  return [
    {
      id: "game",
      title: "Game, sport & date",
      detail: game ? `${displaySport(game.sport)} · ${game.opponent} · ${game.date}` : gameRequired ? "Match the official event" : `${video.sport} · ${video.uploadDate}`,
      complete: !gameRequired || game != null,
    },
    {
      id: "title",
      title: "Title",
      detail: titleGood ? (title === live?.title ? "Formatting checked" : "Title edit staged") : "Check title formatting",
      complete: titleGood,
    },
    {
      id: "description",
      title: "Description",
      detail: !body ? "Missing description" : problems.length ? "Description needs cleanup" : description === live?.description ? "Matches YouTube" : "Description edit staged",
      complete: Boolean(body) && problems.length === 0,
    },
    {
      id: "playlists",
      title: "Playlists",
      detail: playlists.existing.length
        ? playlists.existing.map((item) => item.title).join(", ")
        : planned.length ? "Playlist additions staged" : playlists.checked ? "Not in a suggested playlist" : "Playlist check incomplete",
      complete: playlists.existing.length > 0 || planned.length > 0,
    },
    { id: "visibility", title: "Visibility", detail: privacy.charAt(0).toUpperCase() + privacy.slice(1), complete: privacy === "public" },
  ];
}

export type ReviewStatus = "Needs source" | "Needs review" | "Published" | "Needs attention" | "Protected";
export const REVIEW_STATUSES: ReviewStatus[] = ["Needs review", "Needs source", "Needs attention", "Published", "Protected"];

export function holdReason(video: ReviewVideo, draft: ReviewDraft | null): string | null {
  if (video.protectedReason) return video.protectedReason;
  if (draft?.hold) return draft.hold;
  if (!draft?.preparedAt) return "Refresh the library to match this video to its official source.";
  if (video.identityHold) return video.identityHold;
  return null;
}

export function reviewStatus(video: ReviewVideo, draft: ReviewDraft | null, live: VideoSnapshot | null, checks: ReviewCheck[]): ReviewStatus {
  if (video.protectedReason) return "Protected";
  const hold = draft?.hold ?? video.identityHold;
  if (hold) return hold.startsWith(MATCH_LABELS.missingRecap) || hold.startsWith(MATCH_LABELS.missing) ? "Needs source" : "Needs attention";
  if (!draft?.preparedAt) return "Needs source";
  const description = draftDescription(draft, live);
  if (
    live?.isPublic &&
    description !== "" &&
    live.description === description &&
    live.title === draftTitle(video, draft) &&
    (draft.plannedPlaylistIds ?? []).length === 0 &&
    checks.every((check) => check.complete)
  ) {
    return "Published";
  }
  return "Needs review";
}

export function reviewReason(video: ReviewVideo, draft: ReviewDraft | null, checks: ReviewCheck[]): string {
  return holdReason(video, draft) ?? checks.find((check) => !check.complete)?.detail ?? "Ready to review";
}

/** Coaches offered for a press conference, the video's sport first. */
export function conferenceCoaches(video: ReviewVideo) {
  return [...CONFERENCE_COACHES].sort((a, b) => Number(b.sport === video.sport) - Number(a.sport === video.sport));
}
