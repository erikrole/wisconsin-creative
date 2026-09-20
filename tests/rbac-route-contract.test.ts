import { describe, expect, it } from "vitest";
import path from "node:path";
import { apiRouteSources } from "./_helpers/source-tree";
import { PERMISSIONS } from "@/lib/permissions";

describe("route RBAC permission contract", () => {
  it("only references defined resource/action permissions", () => {
    const calls = apiRouteSources().flatMap(({ file, text: source }) => {
      return Array.from(
        source.matchAll(/requirePermission\s*\([^,]+,\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']/g),
        (match) => ({
          file: path.relative(process.cwd(), file),
          resource: match[1]!,
          action: match[2]!,
        }),
      );
    });

    expect(calls.length).toBeGreaterThan(0);
    const missing = calls.filter(({ resource, action }) => !PERMISSIONS[resource]?.[action]);

    expect(missing).toEqual([]);
  });
});
