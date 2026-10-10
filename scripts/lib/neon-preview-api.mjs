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
    if (!response.ok) throw Object.assign(new Error(`Neon ${method} failed (${response.status}). Inspect the named branch before retrying; credentials and response bodies are not logged.`), { status: response.status });
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
  async idleEndpoints(project, branchId) {
    const { endpoints } = await this.request(`/projects/${project}/branches/${branchId}/endpoints`);
    // Only definitively idle computes; one in "init" or with a pending "active" is being started by someone else.
    return endpoints.filter((endpoint) => endpoint.current_state === "idle" && !endpoint.pending_state).map((endpoint) => endpoint.id);
  }
  // Cleanup wakes each child to read its retention row. Suspend only the computes
  // it woke so a sweep never exhausts the active-endpoint limit or bills idle time.
  // Wait for each suspend operation to finish before moving on. A vanished endpoint
  // is fine; any other failure stops the sweep rather than silently leaving computes active.
  async suspendEndpoints(project, endpointIds) {
    for (const id of endpointIds) {
      let operations;
      try { ({ operations = [] } = await this.request(`/projects/${project}/endpoints/${id}/suspend`, { method: "POST" })); }
      catch (error) {
        if (error.status !== 404) throw error;
        console.warn({ endpoint: id, status: "suspend-skipped-not-found" }); continue;
      }
      for (const operation of operations) await this.finishedOperation(project, operation);
    }
  }
  async finishedOperation(project, operation, attempts = 60) {
    for (let attempt = 0, current = operation; attempt < attempts; attempt += 1) {
      if (["finished", "skipped"].includes(current.status)) return;
      if (["failed", "error", "cancelled"].includes(current.status)) throw new Error(`Neon ${current.action ?? "operation"} ${current.status}. Inspect the endpoint before retrying.`);
      await delay(1_000);
      ({ operation: current } = await this.request(`/projects/${project}/operations/${operation.id}`));
    }
    throw new Error("Neon operation did not finish. Inspect the endpoint before retrying.");
  }
  async connection(project, branch, database, role, pooled) {
    const query = new URLSearchParams({ branch_id: branch, database_name: database, role_name: role, pooled: String(pooled) });
    const result = await this.request(`/projects/${project}/connection_uri?${query}`);
    if (!result.uri) throw new Error("Neon did not return a connection URI");
    return result.uri;
  }
}
