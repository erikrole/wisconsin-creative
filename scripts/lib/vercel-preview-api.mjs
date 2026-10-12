import { spawnSync } from "node:child_process";
import { readInfrastructureConfig } from "./migration-baseline.mjs";

const ONGOING_UPDATE = /ongoing update/i;

/** Vercel's error code and message only. Connection strings and long tokens are removed. */
export function vercelFailureDetail(text) {
  let detail = "";
  try {
    const body = JSON.parse(text);
    const error = body?.error && typeof body.error === "object" ? body.error : null;
    const code = typeof error?.code === "string" ? error.code.trim() : "";
    const message = typeof error?.message === "string" ? error.message.trim() : "";
    detail = [code, message].filter(Boolean).join(": ");
  } catch {
    detail = "";
  }
  detail = detail
    .replace(/[\r\n]+/g, " ")
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted]")
    .replace(/vercel_blob_[A-Za-z0-9_]+/g, "[redacted]")
    .replace(/\b[\w.+-]{32,}\b/g, "[redacted]");
  return detail.length > 240 ? `${detail.slice(0, 239)}…` : detail;
}

export function vercelFailureMessage(method, status, text) {
  const detail = vercelFailureDetail(text);
  return `Vercel ${method} failed (${status})${detail ? `: ${detail}` : ""}; provider response body suppressed.`;
}

function retryableProviderFailure(status, text) {
  if (status === 429) return true;
  return status === 400 && ONGOING_UPDATE.test(vercelFailureDetail(text));
}

/** Secrets stay in memory; provider response bodies never appear in errors. */
export class VercelPreviewApi {
  constructor({ token = process.env.VERCEL_TOKEN, config = readInfrastructureConfig(), fetcher = fetch, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
    this.token = token; this.config = config; this.fetcher = fetcher; this.sleep = sleep;
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
    let lastStatus = 0;
    let lastText = "";
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await this.fetcher(`https://api.vercel.com${scoped}`, {
        method, headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000),
      });
      if (response.ok) {
        // Some successful writes (e.g. store connections) return 200 with no body.
        const text = response.status === 204 ? "" : await response.text();
        try { return text.trim() ? JSON.parse(text) : {}; } catch { throw new Error("Vercel returned an unexpected response; inspect before retrying."); }
      }
      lastStatus = response.status;
      lastText = await response.text();
      if (attempt < 3 && retryableProviderFailure(response.status, lastText)) {
        await this.sleep(500 * 2 ** attempt);
        continue;
      }
      break;
    }
    throw new Error(vercelFailureMessage(method, lastStatus, lastText));
  }
}
