// Prints GitHub Release notes from src/lib/releases.json, the same entries the
// public /releases page shows. Usage: node scripts/release-notes.mjs --since 2026-10-01
import { readFileSync } from "node:fs";

const SECTIONS = [
  ["feature", "New"],
  ["improvement", "Improved"],
  ["fixes", "Fixed"],
];

export function buildReleaseNotes(entries, since, repo = "erikrole/wisconsin-creative") {
  const picked = entries.filter((e) => e.date > since);
  if (picked.length === 0) return null;
  const lines = [];
  for (const [type, heading] of SECTIONS) {
    const group = picked.filter((e) => e.type === type);
    if (group.length === 0) continue;
    lines.push(`## ${heading}`, "");
    for (const e of group) {
      const pr = e.pr ? ` ([#${e.pr}](https://github.com/${repo}/pull/${e.pr}))` : "";
      lines.push(`- **${e.title}**: ${e.summary}${pr}`);
    }
    lines.push("");
  }
  lines.push(`Full notes: https://wisconsincreative.com/releases`);
  return lines.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const i = process.argv.indexOf("--since");
  const since = i > 0 ? process.argv[i + 1] : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since ?? "")) {
    console.error("Usage: node scripts/release-notes.mjs --since YYYY-MM-DD");
    process.exit(2);
  }
  const entries = JSON.parse(readFileSync(new URL("../src/lib/releases.json", import.meta.url), "utf8"));
  const notes = buildReleaseNotes(entries, since, process.env.GITHUB_REPOSITORY);
  if (!notes) {
    console.error(`No /releases entries after ${since}.`);
    process.exit(1);
  }
  process.stdout.write(notes + "\n");
}
