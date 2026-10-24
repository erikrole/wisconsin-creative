#!/usr/bin/env node
// Writes the vitest coverage totals to the GitHub job summary.
import { appendFileSync, readFileSync } from "node:fs";

let total;
try {
  total = JSON.parse(readFileSync("coverage/coverage-summary.json", "utf8")).total;
} catch {
  console.log("No coverage summary was written; the test step failed first.");
  process.exit(0);
}
const rows = ["statements", "branches", "functions", "lines"].map(
  (key) => `| ${key} | ${total[key].pct}% | ${total[key].covered} / ${total[key].total} |`,
);
const text = ["### Server coverage (src/lib and src/app/api)", "", "| Metric | Covered | Count |", "| --- | --- | --- |", ...rows, ""].join("\n");
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
console.log(text);
