import { test } from "node:test";
import assert from "node:assert/strict";
import { decisionChange, syncDecisions } from "./decisions.mjs";
const batch = { version: 1, source: "google-sheet", spreadsheetId: "sheet-id", sheetName: "Prospects", sheetId: 123, rows: [{ externalApplicationId: "900001", expectedStage: "APPLIED", decision: "Round 1" }] };
function mock(records) {
  const writes = [];
  return { writes, fetch: async (url, options) => {
    const record = records[0];
    if (options.method === "PATCH") { writes.push(options.data); Object.assign(record, options.data); }
    if (options.method === "POST") { writes.push(options.data); record.notes.push(options.data); }
    const data = url.includes("?cycleId=") ? records : record;
    return { status: () => 200, headers: () => ({ "content-type": "application/json" }), ok: () => true, json: async () => ({ data }) };
  } };
}
test("only explicit sheet decisions map to changes; Maybe is not a rejection", () => {
  assert.deepEqual(decisionChange("Maybe"), { note: true });
  assert.deepEqual(decisionChange("Decline"), { stage: "PASSED" });
  for (const value of ["", "Strong candidate", "Hire", undefined]) assert.throws(() => decisionChange(value));
});
test("preview and unmatched or stale identities never write", async () => {
  for (const records of [[], [{ id: "a", externalApplicationId: "900001", stage: "HIRE" }]]) {
    const request = mock(records);
    await assert.rejects(() => syncDecisions(request, "https://example.com", "cycle", batch, true));
    assert.equal(request.writes.length, 0);
  }
  const request = mock([{ id: "a", externalApplicationId: "900001", stage: "APPLIED", notes: [] }]);
  await syncDecisions(request, "https://example.com", "cycle", batch, false);
  assert.equal(request.writes.length, 0);
});
test("apply reads back decisions and repeat runs do not duplicate Maybe notes", async () => {
  const record = { id: "a", externalApplicationId: "900001", stage: "APPLIED", notes: [] };
  const request = mock([record]);
  const saved = await syncDecisions(request, "https://example.com", "cycle", batch, true);
  assert.equal(saved.data.plans[0].verified, true);
  assert.equal(record.stage, "ROUND_1");
  await syncDecisions(request, "https://example.com", "cycle", batch, true);
  assert.equal(request.writes.length, 1);
  const maybe = { ...batch, rows: [{ ...batch.rows[0], expectedStage: "ROUND_1", decision: "Maybe" }] };
  await syncDecisions(request, "https://example.com", "cycle", maybe, true);
  await syncDecisions(request, "https://example.com", "cycle", maybe, true);
  assert.equal(record.notes.length, 1);
  assert.equal(record.stage, "ROUND_1");
});
