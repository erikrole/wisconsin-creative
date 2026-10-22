import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const coreDir = "ios/Wisconsin/Core";

/**
 * The iOS APIClient is split by domain across `APIClient.swift`,
 * `APIClient+<Domain>.swift`, and `APIClientResponseShapes.swift`. Source
 * contract tests read it as one document, with the core file first.
 */
export function apiClientSource(): string {
  const files = readdirSync(coreDir)
    .filter((name) => /^APIClient(\+[A-Za-z]+|ResponseShapes)?\.swift$/.test(name))
    .sort((a, b) => (a === "APIClient.swift" ? -1 : b === "APIClient.swift" ? 1 : a.localeCompare(b)));
  return files.map((name) => readFileSync(join(coreDir, name), "utf8")).join("\n");
}
