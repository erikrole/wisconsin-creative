// Keeps main light. Fails when media is tracked at the repository root, or when
// a pull request adds a file over 1 MB outside the app's own asset folders.
// Review screenshots belong in /mnt/project-files or a scratch/<topic>-shots
// branch. CI sets BASE_SHA; locally only the root check runs. A PR that truly
// needs a large file takes the `allow-large-files` label (re-run CI after).
import { execFileSync } from "node:child_process";

const MAX_BYTES = 1024 * 1024;
const ASSET_ROOTS = ["public/", "ios/", "macos/", "src/"];
const git = (...args) => execFileSync("git", args, { encoding: "utf8" });
const problems = [];

for (const f of git("ls-files", "-z").split("\0")) {
  if (f && !f.includes("/") && /\.(png|jpe?g|gif|webp|mp4|mov|zip)$/i.test(f)) {
    problems.push(`${f}: media at the repository root`);
  }
}

const base = process.env.BASE_SHA ?? "";
const allowLarge = (process.env.PR_LABELS ?? "").includes("allow-large-files");
if (!allowLarge && /^[0-9a-f]{40}$/.test(base) && !/^0+$/.test(base)) {
  const added = git("diff", "--diff-filter=A", "--name-only", "-z", base, "HEAD").split("\0").filter(Boolean);
  for (const f of added) {
    if (ASSET_ROOTS.some((root) => f.startsWith(root))) continue;
    const bytes = Number(git("cat-file", "-s", `HEAD:${f}`).trim());
    if (bytes > MAX_BYTES) problems.push(`${f}: ${(bytes / MAX_BYTES).toFixed(1)} MB added outside ${ASSET_ROOTS.join(", ")}`);
  }
}

if (problems.length > 0) {
  console.error("Repo hygiene failed. Keep review captures out of main:");
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log("Repo hygiene: ok.");
