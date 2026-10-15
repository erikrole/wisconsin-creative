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
import { VercelPreviewApi, vercelFailureMessage } from "../scripts/lib/vercel-preview-api.mjs";
import { NeonPreviewApi } from "../scripts/lib/neon-preview-api.mjs";
import { assertPreviewBranchCapacity } from "../scripts/lib/provision-preview.mjs";
import {
  CLEANUP_COMPUTE_BATCH,
  endpointsInspectionWouldStart,
  isEndpointLimitError,
  openPreviewNames,
  partitionPreviewCleanup,
  rotateCleanupBranches,
  takeCleanupBatch,
} from "../scripts/lib/preview-cleanup-plan.mjs";
import { branchKey as previewBranchKey } from "../scripts/lib/preview-environment.mjs";

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

describe("preview provision order", () => {
  it("publishes the database handoff before blob stores can add environment variables", () => {
    const source = readFileSync(new URL("../scripts/lib/provision-preview.mjs", import.meta.url), "utf8");
    const first = source.indexOf("await publishPreviewHandoff");
    const storage = source.indexOf("await provisionPreviewStorage");
    const second = source.indexOf("await publishPreviewHandoff", first + 1);
    expect(first).toBeGreaterThan(-1);
    expect(first).toBeLessThan(storage);
    expect(storage).toBeLessThan(second);
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
  it("names the provider error code without echoing secrets or the rest of the body", async () => {
    const text = JSON.stringify({
      error: { code: "bad_request", message: "The environment variable couldn't be created because project document is too large" },
      value: "postgresql://preview_owner:secret-password@ep-example.neon.tech/neondb",
      token: "vercel_blob_rw_abcdefghijklmnopqrstuvwxyz012345",
    });
    const message = vercelFailureMessage("POST", 400, text);
    expect(message).toMatch(/POST failed \(400\): bad_request: The environment variable couldn't be created because project document is too large/);
    expect(message).not.toMatch(/secret-password|vercel_blob_rw_|postgresql:\/\//);
    await expect(api({ ok: false, status: 400, text: async () => text }).request("/v10/projects/p/env", { method: "POST", body: {} })).rejects.toThrow(/project document is too large/);
  });
  it("retries an in-progress environment update and then accepts the write", async () => {
    const calls = [];
    const fetcher = async () => {
      calls.push("post");
      if (calls.length < 3) return { ok: false, status: 400, text: async () => JSON.stringify({ error: { code: "bad_request", message: "The environment variable couldn't be created because an ongoing update env update is already happening" } }) };
      return respond(201, '{"created":{"id":"env_1"}}');
    };
    const api = new VercelPreviewApi({ token: "t", config, fetcher, sleep: async () => {} });
    await expect(api.request("/v10/projects/p/env", { method: "POST", body: {} })).resolves.toEqual({ created: { id: "env_1" } });
    expect(calls).toHaveLength(3);
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

describe("managed preview cleanup compute", () => {
  it("suspends only the computes cleanup woke, tolerating a deleted branch", async () => {
    const calls = [];
    const fetcher = async (url, { method }) => {
      calls.push(`${method} ${url.replace("https://console.neon.tech/api/v2", "")}`);
      if (url.endsWith("/endpoints")) return new Response(JSON.stringify({ endpoints: [{ id: "ep-idle", current_state: "idle" }, { id: "ep-busy", current_state: "active" }, { id: "ep-starting", current_state: "init", pending_state: "active" }, { id: "ep-waking", current_state: "idle", pending_state: "active" }] }));
      if (url.includes("ep-gone")) return new Response(null, { status: 404 });
      if (url.includes("/operations/")) return new Response(JSON.stringify({ operation: { id: "op-1", status: "finished" } }));
      return new Response(JSON.stringify({ operations: [{ id: "op-1", action: "suspend_compute", status: "running" }] }));
    };
    const api = new NeonPreviewApi("token", fetcher);
    const woken = await api.idleEndpoints("project", "br-test");
    expect(woken).toEqual(["ep-idle"]);
    await api.suspendEndpoints("project", [...woken, "ep-gone"]);
    expect(calls).toEqual(["GET /projects/project/branches/br-test/endpoints", "POST /projects/project/endpoints/ep-idle/suspend", "GET /projects/project/operations/op-1", "POST /projects/project/endpoints/ep-gone/suspend"]);
  });
  it("fails the sweep when a suspend operation fails", async () => {
    const api = new NeonPreviewApi("token", async () => new Response(JSON.stringify({ operations: [{ id: "op-1", action: "suspend_compute", status: "failed" }] })));
    await expect(api.suspendEndpoints("project", ["ep-idle"])).rejects.toThrow(/suspend_compute failed/);
  });
  it("propagates suspension failures other than a vanished endpoint", async () => {
    const api = new NeonPreviewApi("token", async () => new Response(null, { status: 503 }));
    await expect(api.suspendEndpoints("project", ["ep-idle"])).rejects.toMatchObject({ status: 503 });
  });
  it("suspends endpoints it started and does not leave them active", () => {
    const source = readFileSync("scripts/cleanup-previews.mjs", "utf8");
    expect(source).toContain("provider.endpoints(projectId)");
    expect(source).toContain("config.preview.projectId");
    expect(source).toContain("/^wc-preview-[a-f0-9]{20}$/");
    expect(source).not.toContain("in-use-left-active");
    expect(source).not.toContain("costWatch");
    expect(source).toMatch(/if \(!inspection\.removed && started\.length\) await suspendStarted/);
    expect(source).toContain('status: "retry-later", reason: "endpoint-limit"');
    expect(source).toContain('status: "referenced", via: "metadata"');
    expect(source).not.toMatch(/retainPreview/);
  });
});

describe("preview cleanup planning", () => {
  const prefix = "wc-preview-";
  const nameFor = (gitBranch) => `${prefix}${previewBranchKey(gitBranch)}`;
  const child = (name, id = name) => ({ id, name, parent_id: "template", protected: false, default: false, primary: false });

  it("matches open PRs by preview branch name and leaves closed ones for SQL", () => {
    const open = openPreviewNames(["cursor/cost", "main"], { branchPrefix: prefix });
    expect(open.get(nameFor("cursor/cost"))).toBe("cursor/cost");
    expect([...open.keys()]).toHaveLength(1);
    const branches = [child(nameFor("cursor/cost"), "br-open"), child(nameFor("cursor/closed"), "br-closed")];
    const plan = partitionPreviewCleanup(branches, open);
    expect(plan.metadata.map((item) => item.gitBranch)).toEqual(["cursor/cost"]);
    expect(plan.database.map((item) => item.id)).toEqual(["br-closed"]);
  });

  it("starts only idle endpoints and treats the active-endpoint cap as retry-later", () => {
    expect(endpointsInspectionWouldStart([
      { id: "ep-idle", current_state: "idle" },
      { id: "ep-busy", current_state: "active" },
      { id: "ep-waking", current_state: "idle", pending_state: "active" },
    ])).toEqual(["ep-idle"]);
    expect(isEndpointLimitError(Object.assign(new Error("Neon POST failed (402)."), { status: 402 }))).toBe(true);
    expect(isEndpointLimitError(new Error("project cannot have more than 20 concurrently active endpoints"))).toBe(true);
    expect(isEndpointLimitError(new Error("connection reset"))).toBe(false);
    expect(CLEANUP_COMPUTE_BATCH).toBeLessThanOrEqual(3);
  });

  it("stops a sweep at the time budget and rotates which child goes first", () => {
    const branches = ["a", "b", "c", "d"].map((id) => ({ id }));
    expect(takeCleanupBatch(branches, { elapsedMs: 0, budgetMs: 1_000, batchSize: 2 })).toEqual({
      batch: branches.slice(0, 2), deferred: branches.slice(2), reason: null,
    });
    expect(takeCleanupBatch(branches, { elapsedMs: 1_000, budgetMs: 1_000 }).reason).toBe("time-budget");
    const rotated = rotateCleanupBranches(branches, 86_400_000);
    expect(rotated.map((branch) => branch.id)).toEqual(["b", "c", "d", "a"]);
  });
});

describe("preview branch budget", () => {
  it("refuses to create a child once the preview budget is full", () => {
    expect(() => assertPreviewBranchCapacity(9, 9)).toThrow(/Refusing to create a preview branch: 9 preview branches already exist \(limit 9\)/);
    expect(() => assertPreviewBranchCapacity(8, 9)).not.toThrow();
    const source = readFileSync("scripts/lib/provision-preview.mjs", "utf8");
    const check = source.indexOf("assertPreviewBranchCapacity(");
    const create = source.indexOf("branches`, { method: \"POST\"");
    expect(check).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(check);
    expect(source).not.toContain("::warning title=Neon preview branches over budget");
  });
});
