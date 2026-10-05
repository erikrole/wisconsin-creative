// Pure preparation of YouTube writes. No HTTP here: every function returns the
// exact snapshot that may be sent, or throws. Callers re-read the live video
// first; any difference from the reviewed baseline blocks the write.

import { descriptionProblems, titleProblems } from "./rules";
import { snapshotsEqual, YouTubeToolError, type VideoSnapshot, type VideoStatus } from "./types";

export type GuardFailure = "conflict" | "excluded" | "unapproved" | "invalid" | "verificationMismatch";

export class GuardError extends YouTubeToolError {
  constructor(readonly reason: GuardFailure) {
    super(
      {
        conflict: "The video changed on YouTube since it was reviewed.",
        excluded: "This video is outside the channel's editable scope.",
        unapproved: "The description has not been approved.",
        invalid: "The title or description does not meet YouTube's rules.",
        verificationMismatch: "YouTube returned something other than the approved change.",
      }[reason],
    );
    this.name = "GuardError";
  }
}

/** A reviewed description. Any edit clears approval and the fact check. */
export interface DescriptionReview {
  text: string;
  approvedText: string | null;
  reviewedFacts: boolean;
}

export const isApproved = (review: DescriptionReview) => review.text !== "" && review.approvedText === review.text && review.reviewedFacts;

export const editedReview = (text: string): DescriptionReview => ({ text, approvedText: null, reviewedFacts: false });

const PRIVACY = ["private", "unlisted", "public"];

const withChanges = (live: VideoSnapshot, changes: Partial<VideoSnapshot>): VideoSnapshot => ({ ...live, ...changes });

export function prepareDescription(input: {
  baseline: VideoSnapshot;
  live: VideoSnapshot;
  review: DescriptionReview;
  excluded?: boolean;
  makePublic?: boolean;
}): VideoSnapshot {
  const { baseline, live, review, excluded = false, makePublic = false } = input;
  if (excluded || !(live.isPublic || makePublic) || live.isLive === true) throw new GuardError("excluded");
  if (!snapshotsEqual(baseline, live)) throw new GuardError("conflict");
  if (!isApproved(review)) throw new GuardError("unapproved");
  if (descriptionProblems(review.text).length) throw new GuardError("invalid");
  if (makePublic) {
    const status = live.status;
    if (live.isPublic || !status || !["private", "unlisted"].includes(status.privacyStatus) || status.uploadStatus !== "processed" || status.publishAt != null) {
      throw new GuardError("excluded");
    }
    return withChanges(live, { description: review.text, isPublic: true, status: { ...status, privacyStatus: "public" } });
  }
  return withChanges(live, { description: review.text });
}

/** Title and description edit. Status and every other field are preserved exactly. */
export function prepareMetadata(input: { baseline: VideoSnapshot; live: VideoSnapshot; title: string; description: string }): VideoSnapshot {
  const { baseline, live, title, description } = input;
  if (!snapshotsEqual(baseline, live)) throw new GuardError("conflict");
  if (live.isLive !== false || live.status?.publishAt != null || (live.status != null && live.status.uploadStatus !== "processed")) {
    throw new GuardError("excluded");
  }
  if (titleProblems(title).length || (description !== live.description && descriptionProblems(description).length)) {
    throw new GuardError("invalid");
  }
  return withChanges(live, { title, description });
}

export function prepareVisibility(input: { baseline: VideoSnapshot; live: VideoSnapshot; target: string }): VideoSnapshot {
  const { baseline, live, target } = input;
  if (!snapshotsEqual(baseline, live)) throw new GuardError("conflict");
  const status = live.status;
  if (live.isLive !== false || !status || status.uploadStatus !== "processed" || status.publishAt != null || !PRIVACY.includes(target) || !PRIVACY.includes(status.privacyStatus)) {
    throw new GuardError("excluded");
  }
  return withChanges(live, { isPublic: target === "public", status: { ...status, privacyStatus: target } });
}

/** Restores the prior description only if nothing else changed since our verified write. */
export function prepareRollback(input: { before: VideoSnapshot; written: VideoSnapshot; live: VideoSnapshot }): VideoSnapshot {
  const { before, written, live } = input;
  if (before.id !== written.id || !snapshotsEqual(written, live) || before.title !== written.title) throw new GuardError("conflict");
  if (!live.isPublic || live.isLive === true) throw new GuardError("excluded");
  return withChanges(live, { description: before.description });
}

export function verifyReadBack(expected: VideoSnapshot, readBack: VideoSnapshot): void {
  if (!snapshotsEqual(expected, readBack)) throw new GuardError("verificationMismatch");
}

// ---------------------------------------------------------------- request bodies

function mutableStatus(status: VideoStatus): Record<string, unknown> {
  // uploadStatus is read-only processing state and must never be sent.
  return Object.fromEntries(Object.entries(status).filter(([key, value]) => key !== "uploadStatus" && value !== undefined && value !== null));
}

/** `videos.update` body with `part=snippet` (plus `status` when launching). */
export function updateBody(video: VideoSnapshot, includeStatus = false): Record<string, unknown> {
  const snippet: Record<string, unknown> = { title: video.title, description: video.description, categoryId: video.categoryId };
  if (video.tags != null) snippet.tags = video.tags;
  if (video.defaultLanguage != null) snippet.defaultLanguage = video.defaultLanguage;
  if (video.defaultAudioLanguage != null) snippet.defaultAudioLanguage = video.defaultAudioLanguage;
  const body: Record<string, unknown> = { id: video.id, snippet };
  if (includeStatus) {
    const status = video.status;
    if (!status || status.privacyStatus !== "public" || status.publishAt != null) {
      throw new YouTubeToolError("A verified public status is required to launch this video.");
    }
    body.status = mutableStatus(status);
  }
  return body;
}

/** `videos.update` body with `part=status` only. The snippet is never sent. */
export function visibilityBody(video: VideoSnapshot): Record<string, unknown> {
  const status = video.status;
  if (!status || !PRIVACY.includes(status.privacyStatus) || status.publishAt != null) {
    throw new YouTubeToolError("A current visibility setting is required.");
  }
  return { id: video.id, status: mutableStatus(status) };
}
