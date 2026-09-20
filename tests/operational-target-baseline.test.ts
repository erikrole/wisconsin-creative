import path from "node:path";
import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";
import { walkFiles } from "./_helpers/source-tree";

/**
 * `docs/DESIGN_LANGUAGE.md` requires action targets of at least 40px on web.
 * shadcn `size="sm"` is h-8 (32px) and `size="xs"` is h-6 (24px), so a control
 * reaches the baseline only with an explicit `h-10` or larger.
 *
 * This is app-wide. Two categories are deliberately out of scope:
 *
 * - `src/components/ui/` defines the size variants themselves.
 * - Icon-only controls, where the 40px rule and the "keep repeated rows dense"
 *   rule contradict each other. That conflict is recorded in
 *   `docs/DESIGN_LANGUAGE.md` and is decided per surface, not by a regex.
 */

const ROOTS = ["src/app", "src/components"];

/**
 * Reads `<Button ...>` opening tags, tracking brace depth and string state so a
 * `>` inside an arrow function or expression does not truncate the tag. A
 * line-based grep misses multi-line tags entirely and undercounts badly.
 */
export function buttonTags(source: string): string[] {
  const tags: string[] = [];
  const open = "<Button";
  let i = 0;

  while ((i = source.indexOf(open, i)) !== -1) {
    const next = source[i + open.length];
    if (next && /[A-Za-z0-9_]/.test(next)) {
      i += open.length;
      continue;
    }

    let j = i + open.length;
    let depth = 0;
    let quote: string | null = null;

    for (; j < source.length; j++) {
      const char = source[j];
      if (quote) {
        if (char === quote && source[j - 1] !== "\\") quote = null;
        continue;
      }
      if (char === '"' || char === "'" || char === "`") quote = char;
      else if (char === "{") depth++;
      else if (char === "}") depth--;
      else if (char === ">" && depth === 0) break;
    }

    tags.push(source.slice(i, j + 1));
    i = j + 1;
  }

  return tags;
}

export function undersizedControls(source: string): string[] {
  return buttonTags(source).filter((tag) => {
    const classes = [...tag.matchAll(/className="([^"]*)"/g)].map((m) => m[1]).join(" ");
    if (/\bh-1[0-9]\b|\bsize-1[0-9]\b|\bh-full\b|\bmin-h-1[0-9]\b/.test(classes)) return false;
    // An expression className may compose h-10 through cn(); those are checked by eye.
    if (/className=\{/.test(tag)) return false;
    if (/size="icon/.test(tag) || /\bsize-[5-9]\b/.test(classes)) return false;
    return /size="(?:sm|xs)"/.test(tag) || /\bh-[5-9]\b/.test(classes);
  });
}

describe("Operational target baseline", () => {
  it("keeps every text-label action target at 40px across the app", () => {
    const offenders: string[] = [];

    for (const root of ROOTS) {
      for (const file of walkFiles(root, (name) => name.endsWith(".tsx"), `tsx:${root}`)) {
        if (file.includes(`${path.sep}ui${path.sep}`)) continue;
        for (const tag of undersizedControls(source(file))) {
          offenders.push(`${file}: ${tag.replace(/\s+/g, " ").slice(0, 100)}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("locks the shared form-field baseline at 40px", () => {
    const combobox = source("src/components/FormCombobox.tsx");
    expect(combobox).not.toContain('"h-9 w-full justify-between');
    expect(combobox).toContain('"w-full justify-between text-sm font-normal"');
    expect(source("src/components/ui/input.tsx")).toContain("flex h-10 w-full");
    expect(source("src/components/ui/native-select.tsx")).toContain("flex h-10 w-full");
    expect(source("src/components/ui/select.tsx")).toContain('size === "default" && "h-10"');
    expect(source("src/components/ui/button.tsx")).toContain('default: "h-10 px-4 py-2');
  });

  it("detects an undersized control rather than passing vacuously", () => {
    expect(undersizedControls('<Button variant="outline" size="sm">Go</Button>')).toHaveLength(1);
    expect(undersizedControls('<Button className="h-8">Go</Button>')).toHaveLength(1);
    expect(undersizedControls('<Button className="h-10">Go</Button>')).toHaveLength(0);
    // an h-10 override beats the size prop through tailwind-merge
    expect(undersizedControls('<Button size="sm" className="h-10">Go</Button>')).toHaveLength(0);
    // icon-only controls are the documented density exception
    expect(undersizedControls('<Button size="icon-xs" className="size-6" aria-label="x" />')).toHaveLength(0);
  });

  it("reads tags whose attributes span lines and contain arrow functions", () => {
    const tricky = [
      "<Button",
      '  variant="ghost"',
      '  size="sm"',
      "  onClick={() => doThing(a, b)}",
      ">",
    ].join("\n");
    expect(undersizedControls(tricky)).toHaveLength(1);
  });
});
