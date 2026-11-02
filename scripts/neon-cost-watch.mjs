#!/usr/bin/env node
// Weekly: read branch counts and compute wake history from Neon, then open (or update) one
// GitHub issue when something is about to cost money. Read-only toward Neon.
import { NeonPreviewApi } from "./lib/neon-preview-api.mjs";
import { awakeHoursByDay, evaluateProject } from "./lib/neon-cost-watch.mjs";
import { readInfrastructureConfig } from "./lib/migration-baseline.mjs";

const config = readInfrastructureConfig(), watch = config.costWatch;
const token = process.env.NEON_COST_WATCH_API_KEY;
if (!token) {
  console.error("Neon cost watch did not run: NEON_COST_WATCH_API_KEY is missing. Configure a dedicated credential with access to the configured projects; do not reuse the preview infrastructure key.");
  process.exit(1);
}
const api = new NeonPreviewApi(token);
const since = Date.now() - (watch.windowDays + 1) * 86_400_000;

async function operations(project) {
  const rows = []; let cursor;
  do {
    const page = await api.request(`/projects/${project}/operations?limit=500${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    rows.push(...page.operations); cursor = page.pagination?.cursor;
    if (page.operations.length && Date.parse(page.operations.at(-1).created_at) < since) break;
  } while (cursor);
  return rows;
}

const findings = [];
for (const { id, name } of watch.projects) {
  const [branches, ops, { endpoints }] = await Promise.all([api.branches(id), operations(id), api.request(`/projects/${id}/endpoints`)]);
  const activeEndpoints = endpoints.filter((endpoint) => endpoint.current_state === "active").map((endpoint) => endpoint.id);
  const awakeByDay = awakeHoursByDay(ops.filter((op) => op.endpoint_id || op.branch_id), { days: watch.windowDays, activeEndpoints });
  findings.push(...evaluateProject({ name, branches, awakeByDay }, watch));
  console.log({ project: name, branches: branches.length, computes: Object.keys(awakeByDay).length });
}
console.log(findings.length ? findings.join("\n") : "No cost findings.");

const title = "Neon cost watch";
const headers = { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json" };
const base = `https://api.github.com/repos/${config.repository}/issues`;
async function gh(url, init = {}) {
  const response = await fetch(url, { ...init, headers: { ...headers, ...init.headers }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`GitHub ${init.method ?? "GET"} failed (${response.status})`);
  return response.json();
}
const open = (await gh(`${base}?state=open&per_page=100`)).find((issue) => issue.title === title && !issue.pull_request);
const body = `${findings.map((line) => `- ${line}`).join("\n")}\n\nWhat to check: delete branches for closed PRs, confirm the Preview cleanup workflow is enabled, and look at what keeps the production compute awake overnight (Neon console, Monitoring).`;
if (findings.length && open) await gh(`${base}/${open.number}/comments`, { method: "POST", body: JSON.stringify({ body }) });
else if (findings.length) await gh(base, { method: "POST", body: JSON.stringify({ title, body }) });
else if (open) {
  await gh(`${base}/${open.number}/comments`, { method: "POST", body: JSON.stringify({ body: "Back under the limits this week." }) });
  await gh(`${base}/${open.number}`, { method: "PATCH", body: JSON.stringify({ state: "closed", state_reason: "completed" }) });
}
