import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const cache = new Map<string, string>();

/**
 * Read a repository file as UTF-8 for source-contract tests.
 * Accepts a path relative to the repo root (or an absolute path) and memoizes
 * the read so a file inspected by many assertions is loaded once per worker.
 */
export function source(relativeFile: string): string {
  const absolute = path.isAbsolute(relativeFile) ? relativeFile : path.join(process.cwd(), relativeFile);
  const cached = cache.get(absolute);
  if (cached !== undefined) return cached;
  const text = readFileSync(absolute, "utf8");
  cache.set(absolute, text);
  return text;
}

/**
 * The native Schedule surface as one text: `ScheduleView.swift` plus every
 * file under `Views/Schedule/`. Schedule is split across those files, so a
 * contract about "the Schedule" should not depend on which file a view lives
 * in.
 */
export function scheduleSurfaceSource(): string {
  const dir = path.join(process.cwd(), "ios/Wisconsin/Views/Schedule");
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".swift"))
    .sort()
    .map((name) => `ios/Wisconsin/Views/Schedule/${name}`);
  return ["ios/Wisconsin/Views/ScheduleView.swift", ...files].map((file) => source(file)).join("\n");
}
