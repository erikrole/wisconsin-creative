#!/usr/bin/env node
// One command to review a pull request locally: npm run review <PR#>
// Creates a worktree beside the main checkout, installs, starts a dev server on a free port,
// signs in when the PR has a managed preview database, and opens the browser.
// It never provisions a database: without an existing preview it serves DB-free.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { readDotenvValue } from "./ensure-dev-env.mjs";
import { availablePreviewPort, previewStatePath } from "./lib/preview-environment.mjs";
import {
  branchFromLsRemote, dbFreeEnvironment, lockfileDigest, parseReviewArgs, parseWorktreeList,
  reviewRoutes, reviewWorktreePath, startRoute,
} from "./lib/review-pr.mjs";

const say = (message = "") => console.log(message ? `review › ${message}` : "");
const git = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const tryGit = (args, cwd) => spawnSync("git", args, { cwd, encoding: "utf8" });
let stopping = false;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function mainCheckout() {
  const common = resolve(process.cwd(), git(["rev-parse", "--git-common-dir"], process.cwd()));
  return dirname(common);
}

function resolveBranch(pr, cwd) {
  const gh = spawnSync("gh", ["pr", "view", String(pr), "--json", "headRefName,isCrossRepository,title,state"], { cwd, encoding: "utf8" });
  if (gh.status === 0) {
    const info = JSON.parse(gh.stdout);
    if (info.isCrossRepository) throw new Error(`PR #${pr} comes from a fork; review it by hand.`);
    return { branch: info.headRefName, title: info.title, state: info.state };
  }
  const output = git(["ls-remote", "origin", `refs/pull/${pr}/head`, "refs/heads/*"], cwd);
  return { branch: branchFromLsRemote(output, pr), title: null, state: null };
}

function ensureWorktree({ root, path, branch }) {
  git(["fetch", "--quiet", "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`], root);
  const worktrees = parseWorktreeList(git(["worktree", "list", "--porcelain"], root));
  let existing = worktrees.find((tree) => resolve(tree.path) === path);
  const elsewhere = worktrees.find((tree) => tree.branch === branch && resolve(tree.path) !== path);
  if (!existing && elsewhere) {
    if (resolve(elsewhere.path) === root) {
      throw new Error(`${branch} is checked out in your main checkout. Switch that checkout to another branch, or review there.`);
    }
    say(`${branch} is already checked out at ${elsewhere.path}; using that worktree.`);
    existing = elsewhere;
    path = resolve(elsewhere.path);
  }
  if (!existing) {
    if (existsSync(path)) throw new Error(`${path} exists but is not a worktree of this repository. Move it away and rerun.`);
    const hasLocal = tryGit(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], root).status === 0;
    git(hasLocal ? ["worktree", "add", path, branch] : ["worktree", "add", "--track", "-b", branch, path, `origin/${branch}`], root);
    say(`Created worktree ${path}`);
  }
  // next dev rewrites next-env.d.ts on every run; that is not a reviewer's edit.
  const edits = git(["status", "--porcelain", "--untracked-files=no"], path).split("\n").filter(Boolean);
  if (edits.some((line) => line.endsWith(" next-env.d.ts"))) tryGit(["checkout", "--", "next-env.d.ts"], path);
  if (edits.some((line) => !line.endsWith(" next-env.d.ts"))) {
    say("The worktree has local edits, so it was left as it is.");
  } else if (tryGit(["merge", "--ff-only", "--quiet", `origin/${branch}`], path).status !== 0) {
    say(`Could not fast-forward to origin/${branch} (local commits?); reviewing the local branch as it is.`);
  }
  return path;
}

function ensureInstall(path) {
  const digest = lockfileDigest(readFileSync(join(path, "package-lock.json")));
  const marker = join(path, "node_modules", ".wc-review-lock");
  if (existsSync(marker) && readFileSync(marker, "utf8").trim() === digest) return say("Dependencies are current.");
  // The lockfile needs the repository's npm (packageManager); a different local npm rejects it.
  const wanted = JSON.parse(readFileSync(join(path, "package.json"), "utf8")).packageManager?.replace(/^npm@/, "");
  const local = spawnSync("npm", ["--version"], { encoding: "utf8" }).stdout?.trim();
  const [command, prefix] = wanted && wanted !== local ? ["npx", ["--yes", `npm@${wanted}`]] : ["npm", []];
  say(`Installing dependencies (npm${prefix.length ? `@${wanted}` : ""} ci)…`);
  const install = spawnSync(command, [...prefix, "ci", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: path, stdio: "inherit" });
  if (install.status !== 0) throw new Error("npm ci failed in the review worktree.");
  writeFileSync(marker, `${digest}\n`);
}

// Reuses an existing managed preview only. Operator keys are removed so setup can never provision one.
function attachPreview(path, branch) {
  const environment = { ...process.env, NEON_API_KEY: "", PREVIEW_SIGNING_KEY: "" };
  const setup = spawnSync(process.execPath, ["scripts/preview.mjs", "setup"], { cwd: path, env: environment, encoding: "utf8" });
  if (setup.status === 0 && existsSync(previewStatePath(branch, path))) return { ok: true };
  const reason = `${setup.stderr || ""}${setup.stdout || ""}`.trim().split("\n").filter((line) => !line.startsWith("{") && line.trim() && !/^\s*"/.test(line) && line.trim() !== "}")[0];
  return { ok: false, reason: reason || "This PR has no managed preview database." };
}

async function waitForServer(origin, child, timeoutMs = 10 * 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("The dev server stopped before it was ready.");
    try {
      const response = await fetch(new URL("/login", origin), { redirect: "manual", signal: AbortSignal.timeout(180_000) });
      if (response.status < 500) return;
    } catch { /* still compiling */ }
    await sleep(1_000);
  }
  throw new Error(`Timed out waiting for ${origin}.`);
}

async function waitForPreviewServer(path, child) {
  const serverPath = join(path, ".tmp", "preview-server.json");
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("The preview server stopped before it was ready (see the output above).");
    if (existsSync(serverPath)) {
      try {
        const server = JSON.parse(readFileSync(serverPath, "utf8"));
        if (server.pid === child.pid) return server.origin;
      } catch { /* being written */ }
    }
    await sleep(500);
  }
  throw new Error("Timed out waiting for the preview server.");
}

function openBrowser(url) {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  spawn(command, [url], { stdio: "ignore", detached: true, shell: process.platform === "win32" }).on("error", () => {}).unref();
}

function copyToClipboard(value) {
  if (process.platform !== "darwin") return false;
  return spawnSync("pbcopy", [], { input: value }).status === 0;
}

function changedRoutes(path, branch) {
  const diff = tryGit(["diff", "--name-only", `origin/main...origin/${branch}`], path);
  return diff.status === 0 ? reviewRoutes(diff.stdout.split("\n").filter(Boolean)) : [];
}

async function main() {
  const options = parseReviewArgs(process.argv.slice(2));
  const root = mainCheckout();
  const path = reviewWorktreePath(root, options.pr);

  if (options.remove) {
    if (existsSync(path)) tryGit(["checkout", "--", "next-env.d.ts"], path);
    git(["worktree", "remove", path], root);
    return say(`Removed ${path}. The branch and its preview were left alone.`);
  }

  const { branch, title, state } = options.branch ? { branch: options.branch } : resolveBranch(options.pr, root);
  say(`PR #${options.pr}${title ? ` · ${title}` : ""} → ${branch}${state && state !== "OPEN" ? ` (${state.toLowerCase()})` : ""}`);
  const worktree = ensureWorktree({ root, path, branch });
  ensureInstall(worktree);

  const routes = changedRoutes(worktree, branch);
  const preview = options.db ? attachPreview(worktree, branch) : { ok: false, reason: "--no-db was passed." };
  let child;
  const stop = (signal) => { stopping = true; child?.kill(signal); };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);

  let origin;
  if (preview.ok) {
    say("Using this PR's preview database.");
    child = spawn(process.execPath, ["scripts/preview.mjs", "dev"], {
      cwd: worktree, stdio: "inherit", env: { ...process.env, ...(options.port ? { NEXT_DEV_PORT: options.port } : {}) },
    });
    origin = await waitForPreviewServer(worktree, child);
    await waitForServer(origin, child);
    // The first auth can 404 while the login route compiles, so it gets one retry.
    const signIn = () => spawnSync(process.execPath, ["scripts/preview.mjs", "auth"], { cwd: worktree, encoding: "utf8" });
    let auth = signIn();
    if (auth.status !== 0) auth = signIn();
    const contents = existsSync(join(worktree, ".env.development.local")) ? readFileSync(join(worktree, ".env.development.local"), "utf8") : "";
    const email = readDotenvValue(contents, "PLAYWRIGHT_EMAIL") || "admin@creative.local";
    const password = readDotenvValue(contents, "PLAYWRIGHT_PASSWORD");
    say();
    say(auth.status === 0 ? "Signed-in test account is ready:" : "Sign-in check failed; try these anyway:");
    say(`  Email     ${email}`);
    if (password) say(`  Password  ${password}${copyToClipboard(password) ? "  (copied to the clipboard)" : ""}`);
    if (auth.status !== 0) say(`  ${(auth.stderr || auth.stdout).trim().split("\n").pop()}`);
  } else {
    say(`No database for this review: ${preview.reason}`);
    say("Serving DB-free. Static tools, the sign-in page and dev-only labs work; pages that read data will error.");
    const port = await availablePreviewPort(worktree, options.port);
    origin = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ["scripts/run-next.mjs", "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
      cwd: worktree, stdio: "inherit", env: dbFreeEnvironment(port),
    });
    await waitForServer(origin, child);
  }

  const start = new URL(startRoute(routes), origin).href;
  say();
  say(`Open: ${start}`);
  if (routes.length) say(`Pages this PR changes: ${routes.slice(0, 8).join("  ")}`);
  say(`Worktree: ${worktree}`);
  say("Ctrl-C stops the server. `npm run review -- --remove " + options.pr + "` deletes the worktree when you're done.");
  if (options.open) openBrowser(start);
  process.exitCode = await new Promise((done) => child.once("exit", (code) => done(code ?? 0)));
}

main().catch((error) => {
  if (stopping) return; // Ctrl-C while starting up
  console.error(`review › ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
