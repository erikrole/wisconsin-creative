import { createHash, randomBytes } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { blockedPreviewKeys } from "./preview-environment.mjs";

const USAGE = "Usage: npm run review <PR#> [-- --no-db] [--no-open] [--port N] [--branch NAME] [--remove]";

export function parseReviewArgs(argv) {
  const options = { pr: null, db: true, open: true, port: undefined, branch: undefined, remove: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--no-db") options.db = false;
    else if (arg === "--no-open") options.open = false;
    else if (arg === "--remove") options.remove = true;
    else if (arg === "--port" || arg === "--branch") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} needs a value.\n${USAGE}`);
      options[arg.slice(2)] = value;
      index += 1;
    } else if (/^#?\d+$/.test(arg) && options.pr === null) options.pr = Number(arg.replace("#", ""));
    else throw new Error(`Unknown argument ${arg}.\n${USAGE}`);
  }
  if (!options.pr) throw new Error(USAGE);
  return options;
}

// Review worktrees live beside the main checkout, never inside it.
export function reviewWorktreePath(mainCheckout, pr, environment = process.env) {
  const parent = environment.WC_REVIEW_DIR
    ? resolve(environment.WC_REVIEW_DIR)
    : join(dirname(mainCheckout), `${basename(mainCheckout)}-review`);
  const path = join(parent, `pr-${pr}`);
  const inside = relative(mainCheckout, path);
  if (!inside || (!inside.startsWith("..") && !isAbsolute(inside))) {
    throw new Error("Review worktrees must live outside the main checkout. Point WC_REVIEW_DIR somewhere else.");
  }
  return path;
}

/** Maps `git ls-remote origin refs/pull/N/head 'refs/heads/*'` output to the PR's head branch. */
export function branchFromLsRemote(output, pr) {
  const rows = output.trim().split("\n").filter(Boolean).map((line) => line.split(/\s+/));
  const head = rows.find(([, ref]) => ref === `refs/pull/${pr}/head`)?.[0];
  if (!head) throw new Error(`PR #${pr} was not found on origin.`);
  const branches = rows
    .filter(([sha, ref]) => sha === head && ref.startsWith("refs/heads/"))
    .map(([, ref]) => ref.slice("refs/heads/".length))
    .filter((branch) => !["main", "master"].includes(branch));
  if (branches.length === 1) return branches[0];
  if (!branches.length) throw new Error(`PR #${pr}'s head is not a branch on origin (a fork, or a branch that moved). Pass --branch NAME.`);
  throw new Error(`PR #${pr}'s head matches several branches (${branches.join(", ")}). Pass --branch NAME.`);
}

export function parseWorktreeList(porcelain) {
  return porcelain.trim().split(/\n\n+/).filter(Boolean).map((block) => {
    const entry = {};
    for (const line of block.split("\n")) {
      const [key, ...rest] = line.split(" ");
      entry[key] = rest.join(" ") || true;
    }
    return { path: entry.worktree, branch: typeof entry.branch === "string" ? entry.branch.replace(/^refs\/heads\//, "") : null };
  });
}

/** Turns changed app files into routes worth opening, most useful first. */
export function reviewRoutes(files) {
  const routes = new Set();
  for (const file of files) {
    const tool = /^public\/([^/]+)\/index\.html$/.exec(file) ?? /^public\/([^/]+)\/[^/]+\.(?:js|css)$/.exec(file);
    if (tool) { routes.add(`/${tool[1]}/`); continue; }
    const page = /^src\/app\/(.*)page\.(?:tsx|ts|jsx|js|mdx)$/.exec(file);
    if (!page) continue;
    const segments = page[1].split("/").filter((segment) => segment && !/^\(.*\)$/.test(segment) && !segment.startsWith("@"));
    routes.add(`/${segments.join("/")}`);
  }
  return [...routes];
}

export function startRoute(routes) {
  return routes.find((route) => !route.includes("[")) ?? "/";
}

export function lockfileDigest(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

/** A dev server with no database and no outside credentials, for pages that render without data. */
export function dbFreeEnvironment(port, base = process.env, secret = randomBytes(32).toString("hex")) {
  const origin = `http://127.0.0.1:${port}`;
  const inherited = Object.fromEntries(Object.entries(base).filter(([key]) => /^(PATH|HOME|USER|SHELL|TMPDIR|TMP|TEMP|LANG|LC_.*|TERM|COLORTERM|NODE_OPTIONS|NODE_EXTRA_CA_CERTS|HTTPS?_PROXY|NO_PROXY)$/.test(key)));
  return {
    ...inherited,
    ...Object.fromEntries(blockedPreviewKeys.map((key) => [key, ""])),
    // Empty values override any .env file the worktree might have.
    DATABASE_URL: "", DIRECT_URL: "", DATABASE_URL_UNPOOLED: "", SOFTWARE_VAULT_KEY: "",
    NODE_ENV: "development", VERCEL: "", VERCEL_ENV: "development", VERCEL_URL: "",
    WC_REVIEW_DB_FREE: "1",
    SESSION_SECRET: secret, SESSION_COOKIE_NAME: `wc-review-${port}`,
    APP_URL: origin, TRUSTED_ORIGINS: origin, PASSKEY_RP_ID: "127.0.0.1", PASSKEY_ORIGINS: origin,
    NEXT_DEV_HOST: "127.0.0.1", NEXT_DEV_PORT: String(port),
  };
}
