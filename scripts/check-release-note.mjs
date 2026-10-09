#!/usr/bin/env node
// Every pull request to main must add or update an entry in the public release
// notes (src/lib/releases.json, rendered at /releases). Opt out with the
// `no-release-note` label for changes nobody outside the repo would notice
// (dependency bumps, CI, docs-only, internal refactors). Dependabot is exempt.
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
  const warnings = [];
  if (prNumber && !changed.some((entry) => entry.pr === prNumber)) {
    warnings.push(`Consider setting "pr": ${prNumber} on the new release entry.`);
  }
  return { ok: true, reason: `${changed.length} release entr${changed.length === 1 ? "y" : "ies"} added or updated`, warnings };
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
  for (const warning of result.warnings ?? []) console.log(`::warning file=${RELEASES_PATH}::${warning}`);
  if (!result.ok) {
    console.log(`::error file=${RELEASES_PATH}::${result.reason}`);
    process.exit(1);
  }
  console.log(`Release note check passed: ${result.reason}.`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
