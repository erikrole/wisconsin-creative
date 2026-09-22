import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export function acquireProcessLock(path, { pid = process.pid, alive = processAlive } = {}) {
  mkdirSync(dirname(path), { recursive: true });
  const token = randomUUID();
  const ownerPath = join(path, "owner.json");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      mkdirSync(path);
      const owner = { pid, token, childPid: null };
      writeFileSync(ownerPath, JSON.stringify(owner), { mode: 0o600 });
      const release = () => {
        if (existsSync(ownerPath) && JSON.parse(readFileSync(ownerPath, "utf8")).token === token) {
          rmSync(path, { recursive: true });
        }
      };
      release.registerChild = (childPid) => {
        owner.childPid = childPid;
        writeFileSync(ownerPath, JSON.stringify(owner), { mode: 0o600 });
      };
      return release;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let owner;
      try { owner = JSON.parse(readFileSync(ownerPath, "utf8")); } catch {
        throw new Error(`Another process is acquiring ${path}; retry after it starts.`);
      }
      if (alive(owner.pid) || (owner.childPid && alive(owner.childPid))) {
        throw new Error(`Output is owned by process ${owner.pid} or its server: ${path}`);
      }
      // Serialize stale-owner recovery inside the directory. Re-read after
      // taking that lock so another contender cannot remove a new live lease.
      const reclaim = join(path, "reclaim");
      try { mkdirSync(reclaim); } catch { throw new Error(`Another process is recovering ${path}; retry.`); }
      const current = JSON.parse(readFileSync(ownerPath, "utf8"));
      if (current.token !== owner.token || alive(current.pid) || (current.childPid && alive(current.childPid))) {
        rmSync(reclaim, { recursive: true });
        throw new Error(`Output ownership changed: ${path}`);
      }
      const stalePath = `${path}.stale-${token}`;
      renameSync(path, stalePath);
      rmSync(stalePath, { recursive: true });
    }
  }
  throw new Error(`Could not acquire ${path}`);
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return true;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== "ESRCH"; }
}
