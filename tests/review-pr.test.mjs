import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  branchFromLsRemote, dbFreeEnvironment, parseReviewArgs, parseWorktreeList,
  reviewRoutes, reviewWorktreePath, startRoute,
} from "../scripts/lib/review-pr.mjs";

const a = "a".repeat(40);
const b = "b".repeat(40);

describe("npm run review", () => {
  it("parses a PR number and flags", () => {
    expect(parseReviewArgs(["543"])).toMatchObject({ pr: 543, db: true, open: true, remove: false });
    expect(parseReviewArgs(["#521", "--no-db", "--no-open", "--port", "3200"])).toMatchObject({ pr: 521, db: false, open: false, port: "3200" });
    expect(parseReviewArgs(["--remove", "552"])).toMatchObject({ pr: 552, remove: true });
    expect(() => parseReviewArgs([])).toThrow(/Usage/);
    expect(() => parseReviewArgs(["543", "--wat"])).toThrow(/Unknown argument/);
    expect(() => parseReviewArgs(["543", "--branch"])).toThrow(/needs a value/);
  });

  it("puts worktrees beside the main checkout, never inside it", () => {
    expect(reviewWorktreePath("/Users/role/wisconsin-creative", 543, {})).toBe("/Users/role/wisconsin-creative-review/pr-543");
    expect(reviewWorktreePath("/Users/role/wisconsin-creative", 543, { WC_REVIEW_DIR: "/tmp/reviews" })).toBe("/tmp/reviews/pr-543");
    expect(() => reviewWorktreePath("/Users/role/wisconsin-creative", 543, { WC_REVIEW_DIR: "/Users/role/wisconsin-creative/.reviews" })).toThrow(/outside the main checkout/);
  });

  it("finds the PR's head branch without gh", () => {
    const output = [`${a}\trefs/pull/521/head`, `${a}\trefs/heads/claude/golden-hour-weather`, `${b}\trefs/heads/main`].join("\n");
    expect(branchFromLsRemote(output, 521)).toBe("claude/golden-hour-weather");
    expect(() => branchFromLsRemote(`${b}\trefs/heads/main`, 521)).toThrow(/not found/);
    expect(() => branchFromLsRemote(`${a}\trefs/pull/9/head\n${b}\trefs/heads/x`, 9)).toThrow(/--branch/);
    expect(() => branchFromLsRemote(`${a}\trefs/pull/9/head\n${a}\trefs/heads/x\n${a}\trefs/heads/y`, 9)).toThrow(/several/);
  });

  it("reads git worktree list --porcelain", () => {
    const porcelain = "worktree /Users/role/wc\nHEAD abc\nbranch refs/heads/main\n\nworktree /Users/role/wc-review/pr-1\nHEAD def\ndetached\n";
    expect(parseWorktreeList(porcelain)).toEqual([
      { path: "/Users/role/wc", branch: "main" },
      { path: "/Users/role/wc-review/pr-1", branch: null },
    ]);
  });

  it("opens the pages a PR changes", () => {
    const routes = reviewRoutes([
      "src/lib/releases.json",
      "public/golden-hour/app.js",
      "public/golden-hour/index.html",
      "src/app/(app)/staff/[id]/page.tsx",
      "src/app/(app)/settings/apps/page.tsx",
      "src/app/dev-sidebar/page.tsx",
    ]);
    expect(routes).toEqual(["/golden-hour/", "/staff/[id]", "/settings/apps", "/dev-sidebar"]);
    expect(startRoute(routes)).toBe("/golden-hour/");
    expect(startRoute(["/staff/[id]"])).toBe("/");
    expect(startRoute([])).toBe("/");
  });

  it("DB-free mode has no database or outside credentials", () => {
    const environment = dbFreeEnvironment(3200, {
      PATH: "/bin", HOME: "/Users/role", DATABASE_URL: "postgres://prod", NEON_API_KEY: "secret", RESEND_API_KEY: "re_live", AWS_SECRET: "x",
    }, "s".repeat(64));
    expect(environment.DATABASE_URL).toBe("");
    expect(environment.DIRECT_URL).toBe("");
    expect(environment.NEON_API_KEY).toBe("");
    expect(environment.RESEND_API_KEY).toBe("");
    expect(environment.AWS_SECRET).toBeUndefined();
    expect(environment).toMatchObject({ PATH: "/bin", APP_URL: "http://127.0.0.1:3200", SESSION_SECRET: "s".repeat(64), NODE_ENV: "development" });
  });

  it("never provisions a preview database", () => {
    const source = readFileSync("scripts/review-pr.mjs", "utf8");
    expect(source).toContain('NEON_API_KEY: "", PREVIEW_SIGNING_KEY: ""');
    expect(source).not.toMatch(/provisionPreview|NeonPreviewApi|createBranch/);
    expect(readFileSync("package.json", "utf8")).toContain('"review": "node scripts/review-pr.mjs"');
  });
});
