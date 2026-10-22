import { readFileSync, readdirSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { LABEL_KINDS } from "@/lib/brother-label-csv";

/** Reads one entry from a zip (an .lbx is a zip holding label.xml). */
function readZipEntry(zip: Buffer, name: string): string {
  let offset = 0;
  while (offset + 30 <= zip.length && zip.readUInt32LE(offset) === 0x04034b50) {
    const method = zip.readUInt16LE(offset + 8);
    const compressed = zip.readUInt32LE(offset + 18);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    const entryName = zip.toString("utf8", offset + 30, offset + 30 + nameLength);
    const start = offset + 30 + nameLength + extraLength;
    const data = zip.subarray(start, start + compressed);
    if (entryName === name) return (method === 8 ? inflateRawSync(data) : data).toString("utf8");
    offset = start + compressed;
  }
  throw new Error(`${name} not found`);
}

/** P-touch names an unnamed CSV column F<position>. */
function fieldNames(headers: string[]): string[] {
  return headers.map((header, index) => header || `F${index + 1}`);
}

describe("P-touch templates", () => {
  const dir = "public/label-templates";

  it("ships a template for every label kind", () => {
    const files = readdirSync(dir);
    for (const kind of Object.values(LABEL_KINDS)) expect(files).toContain(kind.template);
  });

  it("only binds fields the matching CSV provides", () => {
    for (const kind of Object.values(LABEL_KINDS)) {
      const xml = readZipEntry(readFileSync(`${dir}/${kind.template}`), "label.xml");
      const bound = [...xml.matchAll(/dbMergeFieldStyleName="([^"]+)"/g)].map((match) => match[1]);
      const provided = fieldNames(kind.headers);
      for (const field of bound) expect(provided, `${kind.template} binds ${field}`).toContain(field);
    }
  });
});
