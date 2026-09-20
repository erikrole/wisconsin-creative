import { readFileSync } from "node:fs";
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
