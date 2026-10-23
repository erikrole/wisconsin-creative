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

  it("binds every printable text and QR object to the intended merge field", () => {
    const expected = {
      body: { text: "Label", barcode: "Codes" },
      lens: { text: "Label", barcode: "Codes" },
      sd: { text: "F5" },
      text: { text: "Label" },
      numberTag: { text: "Number", barcode: "Codes" },
      battery: { text: "item_number", barcode: "qr_code" },
    };
    for (const [kind, fields] of Object.entries(expected)) {
      const template = LABEL_KINDS[kind as keyof typeof LABEL_KINDS];
      const xml = readZipEntry(readFileSync(`${dir}/${template.template}`), "label.xml");
      for (const [type, field] of Object.entries(fields)) {
        const objects = [...xml.matchAll(new RegExp(`<${type}:${type}>([\\s\\S]*?)</${type}:${type}>`, "g"))];
        expect(objects.length, `${template.template}: ${type} objects`).toBeGreaterThan(0);
        for (const object of objects) expect(object[1], `${template.template}: ${type} merge`).toContain(`dbMergeFieldStyleName="${field}"`);
        expect(xml).toContain(`fieldName="${field}"`);
      }
      expect(xml).toContain(`databasePath="${template.file}"`);
      expect(xml).toContain(`mergeTable="${template.file}"`);
      expect(xml).toContain('currentRecord="0"');
    }
  });

  it("centers every frame, separates the text and QR, and uses Medium Small QR cells", () => {
    const attributes = (tag: string) => Object.fromEntries([...tag.matchAll(/([\w]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
    for (const kind of Object.values(LABEL_KINDS)) {
      const xml = readZipEntry(readFileSync(`${dir}/${kind.template}`), "label.xml");
      const paper = attributes(xml.match(/<style:paper\b[^>]*>/)![0]);
      const frames = [...xml.matchAll(/<pt:objectStyle\b[^>]*>/g)].map((m) => attributes(m[0]));
      const width = parseFloat(paper.width!);
      for (const frame of frames) {
        expect(parseFloat(frame.y!) + parseFloat(frame.height!) / 2, kind.template).toBeCloseTo(width / 2);
      }
      frames.sort((a, b) => parseFloat(a.x!) - parseFloat(b.x!));
      for (let i = 1; i < frames.length; i += 1) {
        expect(parseFloat(frames[i]!.x!) - parseFloat(frames[i - 1]!.x!) - parseFloat(frames[i - 1]!.width!), kind.template).toBeGreaterThanOrEqual(6);
      }
      const last = frames.at(-1)!;
      const end = parseFloat(last.x!) + parseFloat(last.width!);
      const trailing = paper.autoLength === "true" ? parseFloat(paper.marginBottom!) : parseFloat(paper.height!) - end;
      expect(parseFloat(frames[0]!.x!), `${kind.template}: equal outer margins`).toBeCloseTo(trailing);
      for (const qr of xml.matchAll(/<barcode:qrcodeStyle\b[^>]*>/g)) {
        expect(attributes(qr[0]).cellSize, kind.template).toBe("1.2pt");
      }
    }
  });
});
