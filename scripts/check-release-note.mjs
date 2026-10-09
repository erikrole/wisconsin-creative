#!/usr/bin/env node
// Every pull request to main must add or update an entry in the public release
// notes (src/lib/releases.json, rendered at /releases). Opt out with the
// `no-release-note` label for changes nobody outside the repo would notice
// (dependency bumps, CI, docs-only, internal refactors). Dependabot is exempt.
// The changed entry must carry this PR's number. Runs inside the required CI
// `validate` job; labels are read when the job runs, so re-run CI after labeling.
import { execFileSync } from "node:child_process";

export const RELEASES_PATH = "src/lib/releases.json";
export const OPT_OUT_LABEL = "no-release-note";
const EXEMPT_AUTHORS = new Set(["dependabot[bot]"]);

function readAt(ref) {
  try {
    return JSON.parse(execFileSync("git", ["show", `${ref}:${RELEASES_PATH}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  } catch {
    return [];
  }
}

const TYPES = new Set(["feature", "improvement", "fixes"]);
const PLATFORMS = new Set(["Web", "iOS", "Kiosk", "macOS"]);

export function isRealIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Problems with a release entry against the AGENTS.md release-note contract. */
export function releaseEntryProblems(entry) {
  const problems = [];
  if (!isRealIsoDate(entry.date)) problems.push(`"date" must be a real YYYY-MM-DD date`);
  const titleWords = typeof entry.title === "string" ? entry.title.trim().split(/\s+/).filter(Boolean).length : 0;
  if (titleWords < 1 || titleWords > 7) problems.push(`"title" must be 1–7 words`);
  if (!TYPES.has(entry.type)) problems.push(`"type" must be feature, improvement, or fixes`);
  if (typeof entry.summary !== "string" || entry.summary.trim().length < 20) problems.push(`"summary" needs a sentence or two`);
  if (!Array.isArray(entry.platforms) || entry.platforms.length === 0 || !entry.platforms.every((p) => PLATFORMS.has(p))) {
    problems.push(`"platforms" must list Web, iOS, Kiosk, and/or macOS`);
  }
  const details = entry.details ?? [];
  const [min, max] = entry.type === "fixes" ? [1, 8] : [2, 6];
  if (!Array.isArray(details) || details.length < min || details.length > max || details.some((d) => typeof d !== "string" || !d.trim())) {
    problems.push(`"details" needs ${min}–${max} bullets`);
  }
  return problems;
}

export function changedReleases(before, after) {
  const seen = new Set(before.map((entry) => JSON.stringify(entry)));
  return after.filter((entry) => !seen.has(JSON.stringify(entry)));
}

export function evaluateReleaseNote({ before, after, labels = [], author = "", prNumber }) {
  if (labels.includes(OPT_OUT_LABEL)) return { ok: true, reason: `labeled ${OPT_OUT_LABEL}` };
  if (EXEMPT_AUTHORS.has(author)) return { ok: true, reason: `${author} is exempt` };
  const changed = changedReleases(before, after);
  if (changed.length === 0) {
    return {
      ok: false,
      reason: `No release note. Add or update an entry in ${RELEASES_PATH} (see docs/AREA_PUBLIC_SHOWROOM.md), or label the PR "${OPT_OUT_LABEL}" if nothing user-visible changed.`,
    };
  }
  const own = prNumber ? changed.filter((entry) => entry.pr === prNumber) : changed;
  if (own.length === 0) {
    return {
      ok: false,
      reason: `The new or updated release entry must set "pr": ${prNumber}.`,
    };
  }
  for (const entry of own) {
    const problems = releaseEntryProblems(entry);
    if (problems.length) {
      return { ok: false, reason: `Release entry "${entry.title ?? "(untitled)"}": ${problems.join("; ")}.` };
    }
  }
  return { ok: true, reason: `${changed.length} release entr${changed.length === 1 ? "y" : "ies"} added or updated` };
}

function main() {
  const base = process.env.BASE_SHA;
  const head = process.env.HEAD_SHA || "HEAD";
  if (!base) {
    console.error("BASE_SHA is required.");
    process.exit(2);
  }
  let labels = [];
  try {
    labels = JSON.parse(process.env.PR_LABELS || "[]");
  } catch {
    labels = [];
  }
  const result = evaluateReleaseNote({
    before: readAt(base),
    after: readAt(head),
    labels,
    author: process.env.PR_AUTHOR || "",
    prNumber: Number(process.env.PR_NUMBER) || undefined,
  });
  if (!result.ok) {
    console.log(`::error file=${RELEASES_PATH}::${result.reason}`);
    process.exit(1);
  }
  console.log(`Release note check passed: ${result.reason}.`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
