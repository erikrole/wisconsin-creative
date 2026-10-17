import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const absolute = path.join(dir, entry);
    if (statSync(absolute).isDirectory()) {
      files.push(...sourceFiles(absolute));
      continue;
    }
    if (absolute.endsWith(".ts") || absolute.endsWith(".tsx")) files.push(absolute);
  }
  return files;
}

describe("kiosk pickup scan operator clients", () => {
  it("keeps the WisconsinKiosk pickup scan body tied to the operator at the iPad", () => {
    const project = source("ios/project.yml");
    const kioskTarget = project.slice(project.indexOf("  WisconsinKiosk:"));
    const client = source("ios/Wisconsin/Kiosk/KioskAPIClient.swift");
    const pickup = source("ios/Wisconsin/Kiosk/KioskPickupView.swift");

    expect(kioskTarget).toContain("- path: Wisconsin/Kiosk");
    const scan = client.slice(
      client.indexOf("func kioskPickupScan("),
      client.indexOf("func kioskPickupUnstage("),
    );
    expect(scan).toContain("actorId: String");
    expect(scan).toContain("let actorId: String");
    expect(scan).toContain('path: "/api/kiosk/pickup/\\(bookingId)/scan"');
    expect(scan).toContain("Body(actorId: actorId, scanValue: scanValue, intent: intent)");

    expect(pickup).toContain("let userId: String");
    const calls = [...pickup.matchAll(/kioskPickupScan\(([\s\S]*?)\)/g)];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call[1]).toContain("actorId: userId");
    }
  });

  it("has no web caller that posts a kiosk pickup scan without an operator", () => {
    const route = path.join(process.cwd(), "src/app/api/kiosk/pickup/[id]/scan/route.ts");
    const callers = sourceFiles(path.join(process.cwd(), "src"))
      .filter((file) => file !== route)
      .filter((file) => {
        const text = source(file);
        return text.includes("/api/kiosk/pickup/") && text.includes("/scan");
      });

    expect(callers.filter((file) => !source(file).includes("actorId"))).toEqual([]);
    expect(callers).toEqual([]);
  });
});
