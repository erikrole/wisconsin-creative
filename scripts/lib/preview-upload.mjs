import { execFileSync } from "node:child_process";
import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

const excluded = /^(?:\.git|\.vercel|\.tmp|\.next(?:-dev|-build)?|node_modules|tasks|\.agents|\.codex|\.claude|\.cursor)(?:\/|$)/;
const executableConfig = /(?:^|\/)(?:vercel|now)\.(?:[cm]?[jt]s)$/i;

/** Never give a privileged Vercel uploader executable PR config or symlinks. */
export function preparePreviewUpload(sourceRoot, trustedConfig, { files } = {}) {
  const root = realpathSync(sourceRoot);
  const names = files ?? execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
  const destination = mkdtempSync(join(tmpdir(), "wc-preview-upload-"));
  try {
    for (const name of names) {
      if (excluded.test(name) || /(?:^|\/)\.env(?:\.|$)/.test(name)) continue;
      if (executableConfig.test(name)) throw new Error("Executable Vercel config is forbidden in managed previews; use reviewed vercel.json settings.");
      if (["vercel.json", "now.json", ".vercelignore"].includes(name)) continue;
      const source = resolve(root, name);
      if (relative(root, source).startsWith("..") || !lstatSync(source).isFile() || realpathSync(source) !== source) {
        throw new Error("Preview upload refuses symlinks, special files and paths outside the source checkout.");
      }
      const target = join(destination, name);
      mkdirSync(dirname(target), { recursive: true }); copyFileSync(source, target);
    }
    // Default-branch configuration is data only and cannot import local code.
    // Preview deployments never schedule production's cron jobs.
    const configuration = { ...trustedConfig };
    delete configuration.crons; delete configuration.env; delete configuration.build;
    writeFileSync(join(destination, "vercel.json"), JSON.stringify(configuration) + "\n");
    writeFileSync(join(destination, ".vercelignore"), ".git\n.env*\nnode_modules\n.next*\n.tmp\n");
    return { path: destination, dispose: () => rmSync(destination, { recursive: true, force: true }) };
  } catch (error) { rmSync(destination, { recursive: true, force: true }); throw error; }
}
