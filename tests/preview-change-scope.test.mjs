import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { provisionPreview } from "../scripts/lib/provision-preview.mjs";
import { missingEnvironmentReason } from "../scripts/lib/preview-handoff.mjs";
import {
  isDocsOnlyPath,
  needsHeavyChecks,
  pathsFromNameStatus,
  previewDatabaseDecision,
} from "../scripts/lib/preview-change-scope.mjs";
import { decidePreviewGate } from "../scripts/preview-ci-gate.mjs";
import { findValidatedPullRequest, listPullRequestFiles } from "../scripts/lib/pull-request-files.mjs";

const sha = "a".repeat(40);
const repository = "erikrole/wisconsin-creative";
function run(overrides = {}) {
  return {
    event: "pull_request",
    conclusion: "success",
    head_sha: sha,
    head_branch: "feat/app",
    actor: { login: "erik" },
    head_repository: { full_name: repository },
    ...overrides,
  };
}
function pr(files) {
  return {
    number: 12,
    state: "open",
    user: { login: "erik" },
    base: { ref: "main" },
    head: { sha, ref: "feat/app", repo: { full_name: repository } },
    files,
  };
}

describe("preview database skip", () => {
  it("skips Dependabot by author or branch, even when app files change", () => {
    expect(previewDatabaseDecision({ author: "dependabot[bot]", branch: "dependabot/npm_and_yarn/left-pad", files: ["src/app/page.tsx"] })).toMatchObject({ skip: true });
    expect(previewDatabaseDecision({ author: "erik", branch: "dependabot/github_actions/checkout-5", files: [".github/workflows/ci.yml"] }).reason).toMatch(/Dependabot/);
    expect(previewDatabaseDecision({ author: { login: "dependabot[bot]" }, files: ["package-lock.json"] }).skip).toBe(true);
  });

  it("skips pull requests that do not change prisma, src, or scripts", () => {
    const files = ["README.md", "docs/PREVIEW_ENVIRONMENTS.md", "tasks/todo.md", ".github/dependabot.yml", ".github/pull_request_template.md", "tests/readme.test.ts", "ios/App.swift", "package.json"];
    const decision = previewDatabaseDecision({ author: "erik", branch: "docs/only", files });
    expect(decision.skip).toBe(true);
    expect(decision.reason).toMatch(/prisma\/, src\/, or scripts\//);
    expect(previewDatabaseDecision({ files: [".github/workflows/ci.yml"], branch: "ci/paths" }).skip).toBe(true);
  });

  it("provisions when prisma, src, or scripts change, including a rename out of src", () => {
    expect(previewDatabaseDecision({ files: ["docs/A.md", "src/app/page.tsx"], branch: "feat/app" }).skip).toBe(false);
    expect(previewDatabaseDecision({ files: ["prisma/schema.prisma"], branch: "feat/schema" }).skip).toBe(false);
    expect(previewDatabaseDecision({ files: ["scripts/preview-ci.mjs"], branch: "feat/scripts" }).skip).toBe(false);
    expect(previewDatabaseDecision({ files: [{ filename: "docs/moved.md", previous_filename: "src/old.tsx" }], branch: "feat/move" }).skip).toBe(false);
  });

  it("does not provision for a release note alone, but still does when real app code changes too", () => {
    expect(previewDatabaseDecision({ files: ["src/lib/releases.json", "public/ots/board.js", "docs/A.md"], branch: "feat/static" }).skip).toBe(true);
    expect(previewDatabaseDecision({ files: ["src/lib/releases.json", "src/app/page.tsx"], branch: "feat/app" }).skip).toBe(false);
  });

  it("skips a pull request labeled no-preview, whatever it changes", () => {
    const decision = previewDatabaseDecision({ files: ["src/app/page.tsx"], branch: "feat/small", labels: [{ name: "no-preview" }] });
    expect(decision.skip).toBe(true);
    expect(decision.reason).toMatch(/no-preview/);
    expect(previewDatabaseDecision({ files: ["src/app/page.tsx"], branch: "feat/small", labels: [{ name: "bug" }] }).skip).toBe(false);
    expect(previewDatabaseDecision({ files: ["src/app/page.tsx"], branch: "feat/small", labels: ["no-preview"] }).skip).toBe(true);
  });

  it("does not skip when the file list is missing or a path cannot be classified", () => {
    expect(previewDatabaseDecision({ author: "erik", branch: "feat/app" }).skip).toBe(false);
    expect(previewDatabaseDecision({ files: ["../src/secret.ts"], branch: "feat/app" }).skip).toBe(false);
    expect(previewDatabaseDecision({ files: [], branch: "docs/empty" }).skip).toBe(true);
  });

  it("does not call Neon when the pull request is skipped", async () => {
    let calls = 0;
    const api = { branches: async () => { calls += 1; throw new Error("Neon was called"); } };
    const skipped = await provisionPreview("docs/only", { api, change: { files: ["README.md", ".github/dependabot.yml"], author: "erik", branch: "docs/only" } });
    expect(skipped).toMatchObject({ skipped: true, gitBranch: "docs/only" });
    expect(calls).toBe(0);
    await expect(provisionPreview("feat/app", { api, change: { files: ["src/app/page.tsx"], author: "erik", branch: "feat/app" } })).rejects.toThrow(/Neon was called/);
    expect(calls).toBe(1);
  });
});

describe("docs-only heavy checks", () => {
  it("treats docs, markdown, task notes, and non-workflow .github files as light", () => {
    const files = ["README.md", "docs/board.png", "tasks/todo.md", ".github/dependabot.yml", "guide.mdx"];
    expect(files.every((file) => isDocsOnlyPath(file))).toBe(true);
    expect(needsHeavyChecks(files)).toBe(false);
  });

  it("keeps app, test, native, package, and workflow changes heavy", () => {
    for (const file of ["src/readme.md", "prisma/schema.prisma", "scripts/ci-heavy-scope.mjs", "tests/a.test.ts", "ios/App.swift", "macos/main.swift", "package.json", ".github/workflows/ci.yml", "LICENSE"]) {
      expect(needsHeavyChecks(["README.md", file])).toBe(true);
    }
    expect(needsHeavyChecks([])).toBe(true);
  });

  it("counts both sides of a rename", () => {
    const files = pathsFromNameStatus("M\tREADME.md\nR100\tsrc/old.tsx\tdocs/new.md\n");
    expect(files).toEqual(["README.md", "src/old.tsx", "docs/new.md"]);
    expect(needsHeavyChecks(files)).toBe(true);
    expect(previewDatabaseDecision({ files, branch: "feat/move" }).skip).toBe(false);
  });
});

describe("required checks stay reportable", () => {
  it("does not path-filter the CI workflow, and still runs both required jobs", () => {
    const ci = readFileSync(".github/workflows/ci.yml", "utf8");
    expect(ci).not.toMatch(/^\s*paths(-ignore)?:/m);
    expect(ci).toMatch(/^ {2}validate:/m);
    expect(ci).toMatch(/^ {2}postgres-integrity:/m);
    expect(ci).toContain("steps.scope.outputs.heavy == 'true'");
    expect(ci).toContain("npm test");
    expect(ci).toContain("npm run build:app");
    expect(ci).toContain("node scripts/check-postgres-integrity.mjs");
    expect(ci).toContain("Docs-only pull request. validate reports success");
    expect(ci).toContain("Docs-only pull request. postgres-integrity reports success");
  });

  it("ignores docs on Claude review and leaves workflow files in scope", () => {
    const review = readFileSync(".github/workflows/claude-code-review.yml", "utf8");
    expect(review).toContain("paths-ignore:");
    expect(review).toContain("\"**/*.md\"");
    expect(review).toContain("\"docs/**\"");
    expect(review).toContain("\"tasks/**\"");
    expect(review).toContain("\".github/dependabot.yml\"");
    expect(review).not.toContain(".github/workflows/**");
  });
});

describe("preview gate", () => {
  it("confirms the PR named by CI when GitHub's commit association lookup fails", async () => {
    const seen = [];
    const fetcher = async (url) => {
      seen.push(url);
      if (url.includes("/commits/")) return { ok: false, status: 500 };
      return { ok: true, json: async () => pr() };
    };
    const found = await findValidatedPullRequest(run({ pull_requests: [{ number: 12 }] }), { repository, token: "t", fetcher });
    expect(found.number).toBe(12);
    expect(seen).toEqual([`https://api.github.com/repos/${repository}/pulls/12`]);
  });

  it.each([
    ["closed", { state: "closed" }],
    ["moved head", { head: { ...pr().head, sha: "b".repeat(40) } }],
    ["other branch", { head: { ...pr().head, ref: "feat/other" } }],
    ["fork", { head: { ...pr().head, repo: { full_name: "outside/fork" } } }],
    ["non-main base", { base: { ref: "develop" } }],
    ["different PR number", { number: 13 }],
  ])("does not deploy a hinted PR with %s", async (_name, changed) => {
    const candidate = { ...pr(), ...changed };
    const fetcher = async (url) => ({ ok: true, json: async () => url.includes("/commits/") ? [candidate] : candidate });
    await expect(findValidatedPullRequest(run({ pull_requests: [{ number: 12 }] }), { repository, token: "t", fetcher })).rejects.toThrow(/nothing deployed/);
  });

  it.each([401, 403, 404, 500])("blocks deployment when the live hinted PR lookup returns %s", async (status) => {
    let calls = 0;
    const fetcher = async () => { calls++; return { ok: false, status }; };
    await expect(findValidatedPullRequest(run({ pull_requests: [{ number: 12 }] }), { repository, token: "t", fetcher })).rejects.toThrow(/Could not confirm current PR/);
    expect(calls).toBe(1);
  });

  it.each([
    ["negative number", [{ number: -1 }]],
    ["string number", [{ number: "12" }]],
    ["excessive PR count", Array.from({ length: 21 }, (_, number) => ({ number: number + 1 }))],
    ["invalid hint collection", { number: 12 }],
  ])("rejects %s workflow PR hints before any lookup", async (_name, hints) => {
    let calls = 0;
    const fetcher = async () => { calls++; return { ok: true, json: async () => [pr()] }; };
    await expect(findValidatedPullRequest(run({ pull_requests: hints }), { repository, token: "t", fetcher })).rejects.toThrow(/Could not confirm current PR/);
    expect(calls).toBe(0);
  });

  it("confirms the open same-repository pull request before listing files", async () => {
    const seen = [];
    const fetcher = async (url) => {
      seen.push(url);
      if (url.includes("/commits/")) return { ok: true, json: async () => [pr()] };
      const page = Number(new URL(url).searchParams.get("page"));
      const batch = page === 1 ? Array.from({ length: 100 }, (_, index) => ({ filename: `docs/page-${index}.md` })) : [{ filename: "src/app/page.tsx" }];
      return { ok: true, json: async () => batch };
    };
    await expect(findValidatedPullRequest(run({ conclusion: "failure" }), { repository, token: "t", fetcher })).rejects.toThrow(/successful same-repository/);
    await expect(findValidatedPullRequest(run(), { repository, token: "t", fetcher: async () => ({ ok: true, json: async () => [] }) })).rejects.toThrow(/nothing deployed/);
    const decision = await decidePreviewGate(run(), { repository, token: "t", fetcher });
    expect(decision.needed).toBe(true);
    expect(seen.some((url) => url.includes("page=2"))).toBe(true);
    const listed = await listPullRequestFiles(repository, 12, { token: "t", fetcher });
    expect(listed.at(-1).filename).toBe("src/app/page.tsx");
  });

  it("skips a docs-only pull request after one file page, and Dependabot before any fetch", async () => {
    const docs = pr();
    docs.head.ref = "docs/only";
    const seen = [];
    const fetcher = async (url) => {
      seen.push(url);
      if (url.includes("/commits/")) return { ok: true, json: async () => [docs] };
      return { ok: true, json: async () => [{ filename: "README.md" }, { filename: ".github/dependabot.yml" }] };
    };
    const decision = await decidePreviewGate(run({ head_branch: "docs/only" }), { repository, token: "t", fetcher });
    expect(seen.some((url) => url.includes("page=2"))).toBe(false);
    expect(decision).toEqual({
      needed: false,
      reason: "This pull request does not change prisma/, src/, or scripts/, so no Neon preview branch was created.",
    });
    const dependabot = await decidePreviewGate(run({ actor: { login: "dependabot[bot]" }, head_branch: "dependabot/npm_and_yarn/x" }), {
      repository,
      token: "t",
      fetcher: async () => { throw new Error("should not fetch"); },
    });
    expect(dependabot.needed).toBe(false);
  });
});

describe("missing preview explains a skipped database", () => {
  const gh = (variables, prs) => (...args) => {
    const out = args[0] === "variable" ? variables : prs;
    if (out instanceof Error) throw out;
    return JSON.stringify(out);
  };
  const enabled = [{ name: "MANAGED_PREVIEWS_ENABLED", value: "true" }];
  it("names Dependabot and non-app pull requests instead of telling the operator to wait", () => {
    expect(missingEnvironmentReason("dependabot/npm_and_yarn/x", gh(enabled, [{
      number: 4, isCrossRepository: false, headRefName: "dependabot/npm_and_yarn/x", author: { login: "dependabot[bot]" }, files: [{ path: "package-lock.json" }],
    }]))[0]).toMatch(/Dependabot/);
    expect(missingEnvironmentReason("docs/readme", gh(enabled, [{
      number: 5, isCrossRepository: false, headRefName: "docs/readme", author: { login: "erik" }, files: [{ path: "README.md" }, { path: ".github/dependabot.yml" }],
    }]))[0]).toMatch(/no Neon preview branch/);
    expect(missingEnvironmentReason("feat/app", gh(enabled, [{
      number: 6, isCrossRepository: false, headRefName: "feat/app", author: { login: "erik" }, files: [{ path: "src/app/page.tsx" }],
    }]))[0]).toMatch(/wait for CI/);
  });
});
