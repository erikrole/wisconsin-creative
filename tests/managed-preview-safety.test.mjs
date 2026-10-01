import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { branchKey, localPreviewEnvironment, previewRuntimeEnvironment } from "../scripts/lib/preview-environment.mjs";
import { preparePreviewUpload } from "../scripts/lib/preview-upload.mjs";
import { acquireProcessLock } from "../scripts/lib/process-lock.mjs";
import { readInfrastructureConfig } from "../scripts/lib/migration-baseline.mjs";
import { previewRetentionDecision } from "../scripts/lib/preview-retention.mjs";
import { privateHandoff, handoffVariable, missingEnvironmentReason } from "../scripts/lib/preview-handoff.mjs";
import { VercelPreviewApi } from "../scripts/lib/vercel-preview-api.mjs";

const temporary = [];
function directory() { const path = mkdtempSync(join(tmpdir(), "wc-preview-test-")); temporary.push(path); return path; }
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }); });
const config = readInfrastructureConfig();
function state() {
  return { gitBranch: "claude/test", key: branchKey("claude/test"), projectId: config.preview.projectId, branchId: "br-test", endpointId: "ep-test", environment: {
    DATABASE_URL: "postgresql://owner:fake@ep-test-pooler.us-east-1.aws.neon.tech/gear-tracker",
    DIRECT_URL: "postgresql://owner:fake@ep-test.us-east-1.aws.neon.tech/gear-tracker",
    DATABASE_URL_UNPOOLED: "postgresql://owner:fake@ep-test.us-east-1.aws.neon.tech/gear-tracker", SESSION_SECRET: "fake-session",
  } };
}
describe("managed preview process boundary", () => {
  it("drops metadata-injected operator credentials and Node preload, deriving identity itself", () => {
    const preview = state();
    Object.assign(preview.environment, { NODE_OPTIONS: "--import=./evil.mjs", PREVIEW_SIGNING_KEY: "leak", BLOB_READ_WRITE_TOKEN: "production", WC_PREVIEW_KEY: "other", SESSION_COOKIE_NAME: "production" });
    const runtime = previewRuntimeEnvironment(preview);
    expect(runtime.NODE_OPTIONS).toBeUndefined(); expect(runtime.PREVIEW_SIGNING_KEY).toBeUndefined(); expect(runtime.BLOB_READ_WRITE_TOKEN).toBeUndefined();
    const environment = localPreviewEnvironment(preview, 4400, { PATH: "/bin", GH_TOKEN: "operator" });
    expect(environment.PREVIEW_SIGNING_KEY).toBe(""); expect(environment.BLOB_READ_WRITE_TOKEN).toBe(""); expect(environment.GH_TOKEN).toBe("");
    expect(environment.WC_PREVIEW_KEY).toBe(preview.key); expect(environment.SESSION_COOKIE_NAME).toBe(`wc-preview-${preview.key}-4400`);
    expect(environment.APP_URL).toBe("http://127.0.0.1:4400"); expect(environment.PASSKEY_ORIGINS).toBe(environment.APP_URL);
  });
  it.each(["main", "master", "HEAD", "", "branch\nother"])("refuses unsafe branch %j", (branch) => expect(() => branchKey(branch)).toThrow());
  it("refuses production/template identities and mismatched endpoints before connecting", () => {
    const preview = state(); preview.branchId = config.preview.templateBranchId;
    expect(() => localPreviewEnvironment(preview, 4400)).toThrow("isolated child");
    preview.branchId = "br-test"; preview.environment.DIRECT_URL = "postgresql://owner:fake@ep-production.us-east-1.aws.neon.tech/gear-tracker";
    expect(() => localPreviewEnvironment(preview, 4400)).toThrow("attested endpoint");
  });
});
describe("privileged uploader", () => {
  it.each(["vercel.ts", "vercel.mjs", "vercel.cjs", "vercel.mts", "vercel.js"])("rejects executable %s without executing the canary", (file) => {
    const root = directory(), marker = join(root, "executed");
    writeFileSync(join(root, file), `require('fs').writeFileSync(${JSON.stringify(marker)}, 'executed')`);
    expect(() => preparePreviewUpload(root, {}, { files: [file] })).toThrow("Executable Vercel");
    expect(() => readFileSync(marker)).toThrow();
  });
  it("rejects symlink escape and strips dotenv/provider linkage", () => {
    const root = directory(), outside = directory(); writeFileSync(join(outside, "secret"), "private"); symlinkSync(join(outside, "secret"), join(root, "alias"));
    expect(() => preparePreviewUpload(root, {}, { files: ["alias"] })).toThrow("symlinks");
    writeFileSync(join(root, "package.json"), "{}"); writeFileSync(join(root, ".env.local"), "PRODUCTION_SECRET=private");
    const upload = preparePreviewUpload(root, { buildCommand: "npm run build", crons: [{ path: "/cron" }] }, { files: ["package.json", ".env.local", ".vercel/project.json"] });
    try { expect(() => readFileSync(join(upload.path, ".env.local"))).toThrow(); expect(JSON.parse(readFileSync(join(upload.path, "vercel.json"), "utf8"))).toEqual({ buildCommand: "npm run build" }); }
    finally { upload.dispose(); }
  });
});
describe("output ownership", () => {
  it("refuses a concurrent owner and an orphaned live server, then recovers a stale lease", () => {
    const path = join(directory(), "output.lock"); const live = new Set([100, 101]);
    const first = acquireProcessLock(path, { pid: 100, alive: (pid) => live.has(pid) }); first.registerChild(101);
    expect(() => acquireProcessLock(path, { pid: 102, alive: (pid) => live.has(pid) })).toThrow("owned");
    live.delete(100);
    expect(() => acquireProcessLock(path, { pid: 102, alive: (pid) => live.has(pid) })).toThrow("owned");
    live.delete(101); live.add(102);
    const second = acquireProcessLock(path, { pid: 102, alive: (pid) => live.has(pid) }); first();
    expect(JSON.parse(readFileSync(join(path, "owner.json"), "utf8")).pid).toBe(102); second();
  });
});
describe("preview retention", () => {
  const now = Date.parse("2026-10-01T00:00:00Z");
  const expired = { exists: false, openPullRequest: false, pinned: false, deletedAt: "2026-09-22T00:00:00Z", lastSeenAt: "2026-09-22T00:00:00Z", now };
  it("requires a recorded deletion plus seven days without active use", () => {
    expect(previewRetentionDecision(expired)).toBe("eligible");
    expect(previewRetentionDecision({ ...expired, deletedAt: null })).toBe("record-deletion");
    expect(previewRetentionDecision({ ...expired, deletedAt: "2026-09-25T00:00:00Z" })).toBe("retained");
    expect(previewRetentionDecision({ ...expired, lastSeenAt: "2026-09-30T00:00:00Z" })).toBe("retained");
  });
  it("always retains referenced and pinned environments and fails closed on bad dates", () => {
    expect(previewRetentionDecision({ ...expired, exists: true })).toBe("referenced");
    expect(previewRetentionDecision({ ...expired, openPullRequest: true })).toBe("referenced");
    expect(previewRetentionDecision({ ...expired, pinned: true })).toBe("pinned");
    expect(() => previewRetentionDecision({ ...expired, deletedAt: "invalid" })).toThrow("refusing cleanup");
  });
});
describe("private cross-machine handoff", () => {
  it("excludes operator credentials from stored branch state", () => {
    const preview = state(); preview.environment.NEON_API_KEY = "operator";
    expect(privateHandoff(preview).environment.NEON_API_KEY).toBeUndefined();
    expect(privateHandoff(preview).environment.DIRECT_URL).toBe(preview.environment.DIRECT_URL);
  });
  it("rejects plaintext or production-scoped handoffs before retrieving their values", async () => {
    const key = `WC_PREVIEW_${branchKey("claude/test").toUpperCase()}_STATE`;
    for (const entry of [{ key, type: "plain", target: ["development"] }, { key, type: "encrypted", target: ["production"] }]) {
      await expect(handoffVariable("claude/test", { request: async () => ({ envs: [entry] }) }, config)).rejects.toThrow("unexpected scope");
    }
  });
});

describe("Vercel preview API responses", () => {
  const respond = (status, text) => ({ ok: status < 400, status, text: async () => text });
  const api = (response) => new VercelPreviewApi({ token: "t", config, fetcher: async () => response });
  it("treats a successful empty body as an empty result", async () => {
    expect(await api(respond(200, "")).request("/v1/x", { method: "POST", body: {} })).toEqual({});
  });
  it("parses a JSON body and rejects a malformed one", async () => {
    expect(await api(respond(200, '{"a":1}')).request("/v1/x")).toEqual({ a: 1 });
    await expect(api(respond(200, "<html>")).request("/v1/x")).rejects.toThrow(/unexpected response/);
  });
});

describe("missing preview environment diagnosis", () => {
  const gh = (variables, prs) => (...args) => {
    const out = args[0] === "variable" ? variables : prs;
    if (out instanceof Error) throw out;
    return JSON.stringify(out);
  };
  it("blames the disabled workflow without telling the operator to wait", () => {
    const [reason, ...rest] = missingEnvironmentReason("b", gh([], [{ number: 1, isCrossRepository: false }]));
    expect(reason).toMatch(/not enabled/); expect(rest).toEqual([]);
  });
  it("ignores fork PRs", () => {
    expect(missingEnvironmentReason("b", gh([{ name: "MANAGED_PREVIEWS_ENABLED", value: "true" }], [{ number: 2, isCrossRepository: true }]))[0]).toMatch(/no open same-repository PR targeting main/);
  });
  it("only asks gh for PRs targeting main", () => {
    let seen;
    missingEnvironmentReason("b", (...args) => { if (args[0] === "pr") seen = args; return args[0] === "variable" ? JSON.stringify([{ name: "MANAGED_PREVIEWS_ENABLED", value: "true" }]) : "[]"; });
    expect(seen).toContain("--base"); expect(seen[seen.indexOf("--base") + 1]).toBe("main");
  });
  it("falls back to the generic hint when gh is unusable", () => {
    expect(missingEnvironmentReason("b", gh(new Error("no gh"), []))).toEqual([]);
  });
});
