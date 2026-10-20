import { describe, expect, it } from "vitest";
import * as database from "@prisma/client";
import * as browser from "@/lib/client-enums";
import { build } from "esbuild";

describe("browser enum compatibility", () => {
  for (const name of Object.keys(browser) as Array<keyof typeof browser>) {
    it(`${name} preserves every generated database value and its order`, () => {
      expect(Object.entries(browser[name])).toEqual(Object.entries(database[name]));
    });
  }

  it("bundles without a database runtime or other dependency", async () => {
    const result = await build({
      entryPoints: ["src/lib/client-enums.ts"],
      bundle: true,
      write: false,
      metafile: true,
      platform: "browser",
      format: "esm",
    });
    expect(Object.keys(result.metafile!.inputs)).toEqual(["src/lib/client-enums.ts"]);
    for (const output of Object.values(result.metafile!.outputs)) {
      expect(output.imports).toEqual([]);
    }
  });
});
