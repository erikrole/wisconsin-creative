import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/app/(app)/settings/app-activity/page.tsx", "utf8");

describe("App activity table UI contract", () => {
  it("keeps iOS hardware, iOS software, and latest browser activity in dedicated columns", () => {
    expect(source).toContain(">iOS hardware<");
    expect(source).toContain(">iOS software<");
    expect(source).toContain(">Latest browser<");
    expect(source).toContain("const browserClients = clients.filter((client) => client.platform === \"web\")");
    expect(source).toContain("browserClients.length > 1 ? ` · ${browserClients.length} installations` : \"\"");
    expect(source).not.toContain(">Clients and device<");
    expect(source).not.toContain(">Build / channel<");
  });
});
