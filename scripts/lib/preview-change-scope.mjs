import { posix } from "node:path";

/** A Neon preview child exists to run app, schema, and provisioning changes. */
export const PREVIEW_APP_PREFIXES = ["prisma/", "src/", "scripts/"];

/**
 * Paths that cannot affect the app build, the test suite, or the database.
 * Workflow files stay heavy: a required check has to run the workflow it changed.
 */
const HEAVY_PREFIXES = ["prisma/", "src/", "scripts/", "tests/", "ios/", "macos/", ".github/workflows/"];

export function isDependabotPullRequest({ author = "", branch = "" } = {}) {
  const login = (typeof author === "string" ? author : author?.login ?? "").toLowerCase();
  if (login === "dependabot[bot]" || login === "dependabot") return true;
  return typeof branch === "string" && branch.startsWith("dependabot/");
}

/** Repo-relative path, or null when the path is absolute, empty, or escapes the repo. */
export function normalizeRepoPath(file) {
  if (typeof file !== "string" || file.length === 0 || file.includes("\0")) return null;
  const normalized = posix.normalize(file.replaceAll("\\", "/")).replace(/^\.\//, "");
  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized === ".." || normalized.startsWith("/")) return null;
  return normalized;
}

function matchesPrefix(path, prefixes) {
  return prefixes.some((prefix) => path === prefix.slice(0, -1) || path.startsWith(prefix));
}

/** Unclassifiable paths count as app changes so a bad name never skips a real preview. */
export function pathNeedsPreviewDatabase(file) {
  const path = normalizeRepoPath(file);
  if (!path) return true;
  return matchesPrefix(path, PREVIEW_APP_PREFIXES);
}

export function pathsFromPullRequestFiles(files) {
  if (!Array.isArray(files)) return null;
  const paths = [];
  for (const file of files) {
    if (typeof file === "string") paths.push(file);
    else if (file && typeof file === "object") {
      for (const key of ["filename", "previous_filename", "path"]) if (typeof file[key] === "string") paths.push(file[key]);
    } else paths.push(String(file));
  }
  return paths;
}

/**
 * Skip only when we positively know the pull request cannot need a database.
 * A missing file list does not skip, except for Dependabot, which never does.
 */
export function previewDatabaseDecision({ files, author, branch } = {}) {
  if (isDependabotPullRequest({ author, branch })) {
    return { skip: true, reason: "Dependabot pull requests do not get a Neon preview branch." };
  }
  const paths = pathsFromPullRequestFiles(files);
  if (!paths) return { skip: false, reason: "" };
  if (paths.some((file) => pathNeedsPreviewDatabase(file))) return { skip: false, reason: "" };
  return {
    skip: true,
    reason: "This pull request does not change prisma/, src/, or scripts/, so no Neon preview branch was created.",
  };
}

/** True for docs, markdown, task notes, and .github files that are not workflows. */
export function isDocsOnlyPath(file) {
  const path = normalizeRepoPath(file);
  if (!path) return false;
  if (matchesPrefix(path, HEAVY_PREFIXES)) return false;
  if (path.endsWith(".md") || path.endsWith(".mdx")) return true;
  if (path === "docs" || path.startsWith("docs/")) return true;
  if (path === "tasks" || path.startsWith("tasks/")) return true;
  if (path.startsWith(".github/")) return true;
  return false;
}

/** Empty or unreadable diffs run the heavy checks. Docs-only diffs do not. */
export function needsHeavyChecks(files) {
  if (!Array.isArray(files) || files.length === 0) return true;
  return files.some((file) => !isDocsOnlyPath(file));
}

/** `git diff --name-status` lines, including both sides of a rename or copy. */
export function pathsFromNameStatus(text) {
  const paths = [];
  for (const line of String(text ?? "").split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const status = parts[0];
    if ((status.startsWith("R") || status.startsWith("C")) && parts.length >= 3) paths.push(parts[1], parts[2]);
    else if (parts.length >= 2) paths.push(parts.slice(1).join("\t"));
    else paths.push(line.trim());
  }
  return paths;
}
