import { readdirSync } from "node:fs";
import path from "node:path";

import { source } from "./source";

const walkCache = new Map<string, string[]>();

/**
 * Recursively list files under `root` (repo-relative) whose name matches `match`.
 * Skips dot-directories and node_modules. Results are memoized per worker so the
 * repository-wide contract tests share one directory walk.
 */
export function walkFiles(root: string, match: (name: string) => boolean, cacheKey = `${root}:${match.toString()}`): string[] {
  const cached = walkCache.get(cacheKey);
  if (cached) return cached;
  const found: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (match(entry.name)) found.push(full);
    }
  };
  visit(path.isAbsolute(root) ? root : path.join(process.cwd(), root));
  found.sort();
  walkCache.set(cacheKey, found);
  return found;
}

/** Every Next.js API route handler under src/app/api, as absolute paths. */
export function apiRouteFiles(): string[] {
  return walkFiles("src/app/api", (name) => name === "route.ts", "api-routes");
}

/** Absolute path plus memoized contents for each API route. */
export function apiRouteSources(): Array<{ file: string; relative: string; text: string }> {
  return apiRouteFiles().map((file) => ({ file, relative: path.relative(process.cwd(), file), text: source(file) }));
}
