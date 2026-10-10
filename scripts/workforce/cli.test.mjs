import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { materialUrl, siteOrigin, validateIntake, requestJson, intakeCsv } from "./cli.mjs";
import { boardCount, scanRecords, fetchPageUpMaterial } from "./pageup.mjs";

test("CLI help is readable JSON and runs without a browser or login", () => {
  const output = execFileSync(process.execPath, ["scripts/workforce/cli.mjs", "help"], { encoding: "utf8" });
  assert.equal(JSON.parse(output).version, 1);
  assert.ok(JSON.parse(output).commands.intake);
});
test("intake rejects decisions, repeated IDs, and missing identities before making a write", () => {
  const applicant = { applicationId: "900001", name: "Alex Sample", email: "alex@example.edu" };
  const input = (applicants) => ({ version: 1, source: "pageup", requisitionId: "512089", applicants });
  assert.equal(validateIntake(input([applicant])).applicants.length, 1);
  assert.throws(() => validateIntake(input([applicant, applicant])), /distinct/);
  assert.throws(() => validateIntake(input([{ ...applicant, stage: "HIRE" }])), /decisions/);
  assert.throws(() => validateIntake(input([{ ...applicant, email: "" }])), /name and email/);
});
test("credentialed requests cannot target plaintext remote sites or credential-bearing URLs", () => {
  assert.equal(siteOrigin("https://wisconsincreative.com"), "https://wisconsincreative.com");
  assert.equal(siteOrigin("http://127.0.0.1:3000"), "http://127.0.0.1:3000");
  for (const value of ["http://example.com", "https://user:pass@example.com", "https://example.com/path", "https://example.com?secret=1"]) assert.throws(() => siteOrigin(value));
});
test("PageUp capture binds source links to their Application ID and allowed material routes", () => {
  const url = "https://uwstudents.dc4.pageuppeople.com/ApplicantProgressBoard/OpenResume?applicationId=900001&applicantId=123";
  assert.equal(materialUrl(url, "900001"), url);
  assert.throws(() => materialUrl(url, "900002"));
  assert.throws(() => materialUrl("https://example.com/ApplicantProgressBoard/OpenResume?applicationId=900001", "900001"));
  const records = scanRecords([{ url }, { url: url.replace("OpenResume", "OpenApplicationAnswers") }]);
  assert.equal(records.length, 1);
  assert.equal(records[0].applicationId, "900001");
  assert.equal(records[0].resumeUrl, url);
  assert.equal(boardCount("Application Complete\n(65)"), 65);
  assert.throws(() => boardCount("Applicants are loading"), /Cannot verify/);
});
test("lost import responses are not retried blindly", async () => {
  let calls = 0;
  const request = { fetch: async () => { calls++; throw new Error("disconnected"); } };
  await assert.rejects(() => requestJson(request, "https://example.com", "/api/hiring/import", { method: "POST", data: { apply: true } }), /reconcile Application IDs/);
  assert.equal(calls, 1);
});
test("expired sessions and non-JSON errors have actionable failures", async () => {
  const request = (status, contentType) => ({ fetch: async () => ({ status: () => status, headers: () => ({ "content-type": contentType }), ok: () => false }) });
  await assert.rejects(() => requestJson(request(401, "text/html"), "https://example.com", "/api/me"), /Sign-in/);
  await assert.rejects(() => requestJson(request(500, "text/html"), "https://example.com", "/api/me"), /non-JSON/);
});

test("CSV compatibility preserves quoted evidence and forces factual Applied intake", () => {
  const csv = intakeCsv({ applicants: [{ applicationId: "900001", name: 'Alex "Sample"', email: "alex@example.edu", relevantExperience: "Camera work,\nediting" }] });
  assert.ok(csv.includes('"Alex ""Sample"""'));
  assert.ok(csv.includes('"Applied","FALSE","FALSE"'));
  assert.ok(csv.includes('"Camera work,\nediting"'));
});

test("material downloads only follow verified same-origin PageUp document routes", async () => {
  const source = "https://uwstudents.dc4.pageuppeople.com/ApplicantProgressBoard/OpenResume?applicationId=900001";
  const calls = [];
  const request = { get: async (url, options) => { calls.push({ url, options }); return { status: () => 302, headers: () => ({ location: "https://unverified.example/resume" }) }; } };
  await assert.rejects(() => fetchPageUpMaterial(request, source), /outside the verified/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.maxRedirects, 0);
});
