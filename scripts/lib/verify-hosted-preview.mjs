import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { readInfrastructureConfig } from "./migration-baseline.mjs";
import { VercelPreviewApi } from "./vercel-preview-api.mjs";

export function previewOidcToken({ token = process.env.VERCEL_TOKEN, config = readInfrastructureConfig() } = {}) {
  const args = ["project", "token", config.vercel.productionProjectId, "--scope", config.vercel.teamId];
  if (token) args.push("--token", token);
  const result = spawnSync("vercel", args, { encoding: "utf8", env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, VERCEL_TELEMETRY_DISABLED: "1", NO_UPDATE_NOTIFIER: "1" } });
  const credential = result.stdout.trim();
  if (result.status !== 0 || credential.split(".").length !== 3) throw new Error("Could not mint short-lived preview access. Keep deployment protection enabled and inspect Trusted Sources.");
  return credential;
}
export async function verifyHostedPreview(deploymentId, state, { api = new VercelPreviewApi(), config = readInfrastructureConfig(), onProgress = console.log } = {}) {
  let deployment, lastState;
  for (let attempt = 0; attempt < 120; attempt++) {
    deployment = await api.request(`/v13/deployments/${deploymentId}`);
    if (deployment.projectId !== config.vercel.productionProjectId || deployment.target === "production" || deployment.meta?.wcPreviewBranch !== state.branchId || deployment.meta?.wcPreviewKey !== state.key) throw new Error("Deployment does not belong to the attested preview branch");
    if (lastState !== deployment.readyState) { onProgress({ deployment: deploymentId, status: deployment.readyState }); lastState = deployment.readyState; }
    if (deployment.readyState === "READY") break;
    if (["ERROR", "CANCELED"].includes(deployment.readyState)) throw new Error(`Preview deployment ${deployment.readyState}; no promotion attempted`);
    await delay(5_000);
  }
  if (deployment?.readyState !== "READY") throw new Error("Preview did not become ready within ten minutes");
  const origin = `https://${deployment.url.replace(/^https:\/\//, "")}`;
  if (!new URL(origin).hostname.endsWith(".vercel.app")) throw new Error("Unexpected deployment origin");
  // Project-specific, short-lived OIDC access; no static bypass or public exception.
  const headers = { "x-vercel-trusted-oidc-idp-token": previewOidcToken({ config }), origin, "content-type": "application/json" };
  const login = await fetch(`${origin}/api/auth/login`, { method: "POST", headers, body: JSON.stringify({ email: "admin@creative.local", password: state.environment.PLAYWRIGHT_PASSWORD }), redirect: "error", signal: AbortSignal.timeout(60_000) });
  if (!login.ok) throw new Error(`Hosted preview login failed (${login.status}); credentials and response body suppressed`);
  const cookie = login.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  if (!cookie.includes(`wc-preview-${state.key}=`)) throw new Error("Hosted preview did not issue its branch-specific session cookie");
  for (const path of ["/api/me", "/api/dashboard/stats", "/api/assets?limit=1", "/api/bookings?limit=1"]) {
    const response = await fetch(`${origin}${path}`, { headers: { ...headers, cookie }, redirect: "error", signal: AbortSignal.timeout(60_000) });
    if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) throw new Error(`Hosted preview smoke failed at ${path} (${response.status})`);
  }
  return { deploymentId, url: origin, authenticated: true, database: state.branchId };
}
