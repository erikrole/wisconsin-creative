import { requestJson } from "./cli.mjs";

export function decisionChange(value) {
  if (value === "Round 1") return { stage: "ROUND_1" };
  if (value === "Decline") return { stage: "PASSED" };
  if (value === "Maybe") return { note: true };
  throw new Error("Unsupported or blank sheet decision; no decision may be inferred.");
}
export async function syncDecisions(request, origin, cycleId, batch, apply) {
  if (batch?.version !== 1 || batch.source !== "google-sheet" || !/^[\w-]+$/.test(batch.spreadsheetId ?? "") || !Number.isSafeInteger(batch.sheetId) || batch.sheetId < 0 || typeof batch.sheetName !== "string" || !batch.sheetName.trim() || batch.sheetName.length > 200 || !Array.isArray(batch.rows) || !batch.rows.length || batch.rows.length > 500) throw new Error("Invalid decision synchronization batch.");
  const seen = new Set();
  for (const row of batch.rows) {
    decisionChange(row.decision);
    if (!/^\d+$/.test(row.externalApplicationId ?? "") || seen.has(row.externalApplicationId) || !["APPLIED", "ROUND_1", "HIRE", "PASSED", "WITHDRAWN"].includes(row.expectedStage)) throw new Error("Each decision requires a unique Application ID and expected current stage.");
    seen.add(row.externalApplicationId);
  }
  const current = await requestJson(request, origin, `/api/hiring/applications?cycleId=${encodeURIComponent(cycleId)}`);
  const plans = [];
  for (const row of batch.rows) {
    const matches = current.data.filter(a => a.externalApplicationId === row.externalApplicationId);
    if (matches.length !== 1) throw new Error(`Application ${row.externalApplicationId} has no unique site match.`);
    const record = matches[0];
    const change = decisionChange(row.decision);
    if (record.stage !== row.expectedStage && record.stage !== change.stage) throw new Error(`Application ${row.externalApplicationId} changed since preparation. Refresh before applying.`);
    plans.push({ id: record.id, externalApplicationId: row.externalApplicationId, before: record.stage, decision: row.decision, ...change });
  }
  const source = `https://docs.google.com/spreadsheets/d/${batch.spreadsheetId}/edit#gid=${batch.sheetId}`;
  for (const plan of plans) {
    plan.noteBody = `Decision from ${batch.sheetName}: ${plan.decision}. Source: ${source}`;
    if (!apply) continue;
    const path = `/api/hiring/applications/${encodeURIComponent(plan.id)}`;
    const detail = (await requestJson(request, origin, path)).data;
    if (detail.externalApplicationId !== plan.externalApplicationId || (detail.stage !== plan.before && detail.stage !== plan.stage)) throw new Error("A candidate changed during synchronization; stop and refresh the remaining decisions.");
    if (plan.stage && detail.stage !== plan.stage) await requestJson(request, origin, path, { method: "PATCH", data: { stage: plan.stage }, retries: 0 });
    if (plan.note && !detail.notes.some(n => n.body === plan.noteBody)) await requestJson(request, origin, path + "/notes", { method: "POST", data: { body: plan.noteBody }, retries: 0 });
    const saved = (await requestJson(request, origin, path)).data;
    if ((plan.stage && saved.stage !== plan.stage) || (plan.note && !saved.notes.some(n => n.body === plan.noteBody))) throw new Error("Decision read-back failed; reconcile before retrying.");
    plan.verified = true;
  }
  return { data: { applied: apply, counts: { round1: plans.filter(p => p.stage === "ROUND_1").length, passed: plans.filter(p => p.stage === "PASSED").length, maybeNotes: plans.filter(p => p.note).length }, plans } };
}
