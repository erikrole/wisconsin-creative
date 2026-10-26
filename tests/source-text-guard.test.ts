import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import KNOWN_SOURCE_TEXT_TESTS from "./_helpers/source-text-tests.json";

// Testing policy (docs/TESTING.md, "Source-text tests"): a test that greps web
// source for a string breaks on harmless refactors and passes on broken
// behavior. These files predate the guard. A new test should call the code
// (route, service, render) instead. When a file stops reading web source,
// remove it from the JSON list; never add one. A genuine architecture or
// cross-language contract may opt out with a `// source-contract: <why>` line.

const WEB_SOURCE_PATH = /["'`]src\/[^"'`\n]*["'`]|(?:join|resolve)\([^)]*["'`]src["'`]/;
const READS_TEXT = /\b(?:source|splitSource|readFileSync|readSource|read)\s*\(/;
const OPT_OUT = /\/\/ source-contract: \S/;

function testFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "browser" || entry.name === "postgres" ? [] : testFiles(full);
    return /\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe("source-text test guard", () => {
  const known = new Set<string>(KNOWN_SOURCE_TEXT_TESTS);
  const found = new Set<string>();
  for (const file of testFiles("tests")) {
    const text = readFileSync(file, "utf8");
    if (WEB_SOURCE_PATH.test(text) && READS_TEXT.test(text) && !OPT_OUT.test(text)) {
      found.add(file.split(path.sep).join("/"));
    }
  }

  it("adds no new test that only reads web source text; test the behavior instead", () => {
    expect([...found].filter((file) => !known.has(file))).toEqual([]);
  });

  it("keeps the list honest by dropping files that no longer read web source", () => {
    expect([...known].filter((file) => !found.has(file))).toEqual([]);
  });
});
