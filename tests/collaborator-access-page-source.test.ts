import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function pageSource() {
  return readFileSync(
    path.join(process.cwd(), "src/app/(app)/settings/collaborator-access/page.tsx"),
    "utf8",
  );
}

describe("Collaborator Access settings response contract", () => {
  it("uses the policy array already unwrapped by useFetch", () => {
    const source = pageSource();

    expect(source).toContain("useFetch<Policy[]>");
    expect(source).toContain("const policies = data ?? [];");
    expect(source).not.toContain("const policies = data?.data ?? [];");
  });

  it("preserves intentional badge casing in create and edit fields", () => {
    const source = pageSource();

    expect(source).toContain('placeholder="Learfield"');
    expect(source).not.toContain("setBadge(event.target.value.toUpperCase())");
  });

  it("uses SettingsSaveBar with reset and unload protection on dirty policy cards", () => {
    const source = pageSource();

    expect(source).toContain('import { SettingsSaveBar } from "../_components/SettingsSaveBar"');
    expect(source).toContain("function resetChanges()");
    expect(source).toContain("<SettingsSaveBar");
    expect(source).toContain("onReset={resetChanges}");
    expect(source).toContain("onSave={() => void save()}");
    expect(source).toContain('saveLabel="Save policy"');
    expect(source).toContain("beforeunload");
    expect(source).toContain("warnBeforeLeaving");
    expect(source).toContain("savingRef");
    expect(source).toContain("if (!dirty || savingRef.current) return");
    expect(source).toContain("disabled={saving}");
    expect(source).not.toContain("<Save />Save policy");
  });
});
