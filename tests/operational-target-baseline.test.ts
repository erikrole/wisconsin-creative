import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

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
 * Form fields, not action buttons. `Input` and `SelectTrigger` are both h-9, so
 * raising a combobox alone misaligns every form row it shares with them. Moving
 * the whole form-field baseline to 40px is a real change with app-wide visual
 * impact; it needs its own slice and proof, not a side effect of a button sweep.
 * Tracked in `tasks/design-language-route-conformance-checklist.md`.
 */
const FORM_FIELD_EXCEPTIONS = ["src/components/FormCombobox.tsx"];

function tsxFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) tsxFiles(full, acc);
    else if (full.endsWith(".tsx")) acc.push(full);
  }
  return acc;
}

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
      for (const file of tsxFiles(root)) {
        if (file.includes(`${path.sep}ui${path.sep}`)) continue;
        if (FORM_FIELD_EXCEPTIONS.includes(file)) continue;
        for (const tag of undersizedControls(readFileSync(file, "utf8"))) {
          offenders.push(`${file}: ${tag.replace(/\s+/g, " ").slice(0, 100)}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("keeps the form-field exception honest", () => {
    // If this fails, FormCombobox was changed and the exception should be
    // re-examined rather than silently carried forward.
    const combobox = readFileSync("src/components/FormCombobox.tsx", "utf8");
    expect(undersizedControls(combobox).length).toBeGreaterThan(0);
    expect(readFileSync("src/components/ui/input.tsx", "utf8")).toContain("h-9");
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
