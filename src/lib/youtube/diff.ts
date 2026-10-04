// Word-level diff for the review screen: what a title or description loses and gains.

export type DiffPart = { kind: "same" | "removed" | "added"; text: string };

const tokens = (text: string) => text.split(/(\s+)/).filter(Boolean);

/** Longest-common-subsequence diff over words, merged into runs. Inputs are short (titles, descriptions), so O(n*m) is fine. */
export function wordDiff(before: string, after: string): DiffPart[] {
  const a = tokens(before);
  const b = tokens(after);
  const width = b.length + 1;
  const table = new Array<number>((a.length + 1) * width).fill(0);
  const cell = (i: number, j: number) => table[i * width + j] ?? 0;
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * width + j] = a[i] === b[j] ? cell(i + 1, j + 1) + 1 : Math.max(cell(i + 1, j), cell(i, j + 1));
    }
  }
  const parts: DiffPart[] = [];
  const push = (kind: DiffPart["kind"], text: string | undefined) => {
    if (text === undefined) return;
    const last = parts[parts.length - 1];
    if (last?.kind === kind) last.text += text;
    else parts.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push("same", a[i]);
      i++;
      j++;
    } else if (cell(i + 1, j) >= cell(i, j + 1)) push("removed", a[i++]);
    else push("added", b[j++]);
  }
  while (i < a.length) push("removed", a[i++]);
  while (j < b.length) push("added", b[j++]);
  return parts;
}
