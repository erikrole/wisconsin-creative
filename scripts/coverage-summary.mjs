#!/usr/bin/env node
// Writes the vitest coverage totals to the GitHub job summary.
import { appendFileSync, readFileSync } from "node:fs";

const total = JSON.parse(readFileSync("coverage/coverage-summary.json", "utf8")).total;
const rows = ["statements", "branches", "functions", "lines"].map(
  (key) => `| ${key} | ${total[key].pct}% | ${total[key].covered} / ${total[key].total} |`,
);
const text = ["### Server coverage (src/lib and src/app/api)", "", "| Metric | Covered | Count |", "| --- | --- | --- |", ...rows, ""].join("\n");
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
console.log(text);
