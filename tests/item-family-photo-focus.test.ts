import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("item family photo control", () => {
  it("shows the edit label and a focus ring from the keyboard", () => {
    const source = readFileSync(
      "src/app/(app)/bulk-inventory/[id]/_components/BulkSkuHeader.tsx",
      "utf8",
    );

    expect(source).toContain("focus-visible:ring-[3px]");
    expect(source).toContain("focus-visible:ring-ring/50");
    expect(source).toContain("group-focus-visible:opacity-100");
    expect(source).toContain('aria-label={canEdit ? "Change image" : undefined}');
  });
});
