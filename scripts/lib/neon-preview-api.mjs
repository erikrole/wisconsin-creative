import { setTimeout as delay } from "node:timers/promises";

export class NeonPreviewApi {
  constructor(token = process.env.NEON_API_KEY, fetcher = fetch) {
    if (!token) throw new Error("NEON_API_KEY is required for provisioning. Use a project-scoped key for Wisconsin Creative Previews only.");
    this.token = token; this.fetcher = fetcher;
  }
  async request(path, { method = "GET", body } = {}) {
    const response = await this.fetcher(`https://console.neon.tech/api/v2${path}`, {
      method, headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Neon ${method} failed (${response.status}). Inspect the named branch before retrying; credentials and response bodies are not logged.`);
    return response.status === 204 ? {} : response.json();
  }
  async branches(project) {
    const branches = []; let cursor;
    do {
      const page = await this.request(`/projects/${encodeURIComponent(project)}/branches?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      branches.push(...page.branches); cursor = page.pagination?.cursor;
    } while (cursor);
    return branches;
  }
  async readyBranch(project, branchId) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const { branch } = await this.request(`/projects/${project}/branches/${branchId}`);
      if (branch.current_state === "ready") return branch;
      await delay(1_000);
    }
    throw new Error("Neon preview did not become ready. Inspect it before retrying.");
  }
  async connection(project, branch, database, role, pooled) {
    const query = new URLSearchParams({ branch_id: branch, database_name: database, role_name: role, pooled: String(pooled) });
    const result = await this.request(`/projects/${project}/connection_uri?${query}`);
    if (!result.uri) throw new Error("Neon did not return a connection URI");
    return result.uri;
  }
}
