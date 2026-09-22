import { spawnSync } from "node:child_process";
import { readInfrastructureConfig } from "./migration-baseline.mjs";

/** Secrets stay in memory; provider response bodies never appear in errors. */
export class VercelPreviewApi {
  constructor({ token = process.env.VERCEL_TOKEN, config = readInfrastructureConfig(), fetcher = fetch } = {}) {
    this.token = token; this.config = config; this.fetcher = fetcher;
  }
  async request(path, { method = "GET", body } = {}) {
    const scoped = `${path}${path.includes("?") ? "&" : "?"}teamId=${this.config.vercel.teamId}`;
    if (!this.token) {
      if (method === "DELETE") throw new Error("Automated cleanup requires its explicitly configured operator token.");
      const args = ["api", scoped, "--method", method, "--raw"];
      if (body) args.push("--input", "-");
      const result = spawnSync("vercel", args, { input: body ? JSON.stringify(body) : undefined, encoding: "utf8",
        env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, VERCEL_TELEMETRY_DISABLED: "1", NO_UPDATE_NOTIFIER: "1" }, maxBuffer: 8 * 1024 * 1024 });
      if (result.status) throw new Error(`Vercel ${method} failed; inspect provider status. Response bodies are suppressed.`);
      try { return result.stdout.trim() ? JSON.parse(result.stdout) : {}; } catch { throw new Error("Vercel returned an unexpected response; inspect before retrying."); }
    }
    const response = await this.fetcher(`https://api.vercel.com${scoped}`, {
      method, headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Vercel ${method} failed (${response.status}); provider response body suppressed.`);
    return response.status === 204 ? {} : response.json();
  }
}
