import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

/* eslint-disable @typescript-eslint/no-explicit-any */
const context: { window: Record<string, unknown> } = { window: {} };
runInNewContext(readFileSync("public/frame/core.js", "utf8"), context);
const core = context.window.PhotoFrameCore as any;

/** A small JPEG shell whose APP1 holds little-endian EXIF with the settings the frame shows. */
function jpegWithExif(): ArrayBuffer {
  const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0)).concat(0);
  const make = ascii("SONY");
  const model = ascii("ILCE-1M2");
  const lens = ascii("FE 70-200mm F2.8 GM OII");
  const when = ascii("2026:09:19 20:41:07");
  const ifd0Entries = 3;
  const exifEntries = 6;
  const ifd0At = 8;
  const exifAt = ifd0At + 2 + ifd0Entries * 12 + 4;
  const dataAt = exifAt + 2 + exifEntries * 12 + 4;
  let data: number[] = [];
  const place = (bytes: number[]) => {
    const at = dataAt + data.length;
    data = data.concat(bytes);
    return at;
  };
  const u16 = (n: number) => [n & 255, n >> 8];
  const u32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
  const entry = (tag: number, type: number, count: number, value: number[]) => [...u16(tag), ...u16(type), ...u32(count), ...value];
  const pad4 = (v: number[]) => v.concat([0, 0, 0, 0]).slice(0, 4);
  const rational = (n: number, d: number) => place([...u32(n), ...u32(d)]);

  const ifd0 = [
    ...u16(ifd0Entries),
    ...entry(0x010f, 2, make.length, pad4(make)),
    ...entry(0x0110, 2, model.length, u32(place(model))),
    ...entry(0x8769, 4, 1, u32(exifAt)),
    ...u32(0),
  ];
  const exif = [
    ...u16(exifEntries),
    ...entry(0x829a, 5, 1, u32(rational(1, 1600))),
    ...entry(0x829d, 5, 1, u32(rational(28, 10))),
    ...entry(0x8827, 3, 1, pad4(u16(3200))),
    ...entry(0x9003, 2, when.length, u32(place(when))),
    ...entry(0x920a, 5, 1, u32(rational(200, 1))),
    ...entry(0xa434, 2, lens.length, u32(place(lens))),
    ...u32(0),
  ];
  const tiff = [0x49, 0x49, 42, 0, ...u32(ifd0At), ...ifd0, ...exif, ...data];
  const app1 = [...ascii("Exif").slice(0, 4), 0, 0, ...tiff];
  const len = app1.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 255, ...app1, 0xff, 0xd9]).buffer;
}

describe("Photo Frame core", () => {
  it("reads the settings the frame shows from a JPEG's EXIF", () => {
    expect(core.readExif(jpegWithExif())).toEqual({
      camera: "Sony A1 II",
      lens: "FE 70-200mm F2.8 GM OII",
      focal: "200 mm",
      aperture: "f/2.8",
      shutter: "1/1600 s",
      iso: "3200",
      date: "Sep 19, 2026",
      artist: "",
    });
  });

  it("gives empty fields, not an error, for files without EXIF or with junk", () => {
    const blank = core.readExif(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer);
    expect(Object.values(blank).every((v) => v === "")).toBe(true);
    expect(() => core.readExif(new Uint8Array([1, 2, 3]).buffer)).not.toThrow();
    const cut = jpegWithExif().slice(0, 60);
    expect(() => core.readExif(cut)).not.toThrow();
  });

  it("formats exposure values the way photographers write them", () => {
    expect(core.formatShutter(1 / 1000)).toBe("1/1000 s");
    expect(core.formatShutter(0.5)).toBe("0.5 s");
    expect(core.formatShutter(2)).toBe("2 s");
    expect(core.formatAperture(4)).toBe("f/4");
    expect(core.formatAperture(2.8)).toBe("f/2.8");
    expect(core.formatFocal(24.4)).toBe("24 mm");
    expect(core.formatIso(6400)).toBe("6400");
    expect(core.formatShutter(0)).toBe("");
  });

  it("names cameras without repeating the brand", () => {
    expect(core.cameraName("SONY", "ILCE-1")).toBe("Sony A1");
    expect(core.cameraName("SONY", "ILME-FX3")).toBe("Sony FX3");
    expect(core.cameraName("Canon", "Canon EOS R5")).toBe("Canon EOS R5");
    expect(core.cameraName("NIKON CORPORATION", "NIKON Z 9")).toBe("Nikon Z 9");
    expect(core.cameraName("Apple", "iPhone 16 Pro")).toBe("iPhone 16 Pro");
    expect(core.cameraName("SONY", "ILCE-7CM2")).toBe("Sony A7C II");
    expect(core.cameraName("FUJIFILM", "X-T5")).toBe("Fujifilm X-T5");
  });

  it("picks readable text on dark and light frames", () => {
    expect(core.inkFor("#000000").ink).toBe("#f4f2ed");
    expect(core.inkFor("#a00000").ink).toBe("#f4f2ed");
    expect(core.inkFor("#ffffff").ink).toBe("#15151a");
  });

  it("reads exposure written as doubles, and falls back to the APEX values", () => {
    // Same shell as above, but with the rationals rewritten as type 12 (double) like some exporters do.
    const buf = jpegWithExif();
    const view = new DataView(buf);
    const tiff = 12;
    const exifAt = tiff + view.getUint32(tiff + 4, true) + 2 + 3 * 12 + 4;
    const n = view.getUint16(exifAt, true);
    for (let i = 0; i < n; i++) {
      const at = exifAt + 2 + i * 12;
      if (view.getUint16(at + 2, true) !== 5) continue;
      const off = tiff + view.getUint32(at + 8, true);
      const value = view.getUint32(off, true) / view.getUint32(off + 4, true);
      view.setUint16(at + 2, 12, true);
      view.setFloat64(off, value, true);
    }
    expect(core.readExif(buf)).toMatchObject({ focal: "200 mm", aperture: "f/2.8", shutter: "1/1600 s" });
    // APEX: Av 3 is f/2.8, Tv 10 is 1/1024 s.
    expect(core.summarize({ 0x9202: 3, 0x9201: 10 })).toMatchObject({ aperture: "f/2.8", shutter: "1/1024 s" });
  });

  it("finds EXIF in containers it does not parse, like HEIC", () => {
    const jpeg = new Uint8Array(jpegWithExif());
    // Wrap the TIFF block the way a HEIC Exif item stores it: junk, then "Exif\0\0", then TIFF.
    const tiff = jpeg.slice(12, jpeg.length - 2);
    const heic = new Uint8Array([0, 0, 0, 24, ...[..."ftypheic"].map((c) => c.charCodeAt(0)), ...new Array(40).fill(7), 0, 0, 0, 6, 0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]);
    expect(core.readExif(heic.buffer)).toMatchObject({ camera: "Sony A1 II", iso: "3200" });
  });

  it("fills lens and credit from fallback tags", () => {
    expect(core.formatLensSpec([24, 70, 2.8, 2.8])).toBe("24-70mm F2.8");
    expect(core.formatLensSpec([35, 35, 1.4, 1.4])).toBe("35mm F1.4");
    expect(core.summarize({ 0xa432: [70, 200, 2.8, 2.8] }).lens).toBe("70-200mm F2.8");
    expect(core.creditFromCopyright("© 2026 Jane Doe. All rights reserved.")).toBe("Jane Doe");
    expect(core.creditFromCopyright("Copyright (c) 2025-2026 UW Athletics")).toBe("UW Athletics");
    expect(core.summarize({ 0x8298: "Photo by Sam Lee" }).artist).toBe("Sam Lee");
    expect(core.summarize({ 0x013b: "Pat Kim", 0x8298: "© Someone Else" }).artist).toBe("Pat Kim");
  });

  it("names exports safely", () => {
    expect(core.exportName("DSC01234.ARW.jpg", "jpg")).toBe("DSC01234.ARW-framed.jpg");
    expect(core.exportName("../../evil:name?.png", "png")).toBe("evilname-framed.png");
    expect(core.exportName("", "png")).toBe("photo-framed.png");
  });
});

describe("Photo Frame page", () => {
  const html = readFileSync("public/frame/index.html", "utf8");

  it("carries the shared Wisconsin Creative badge, and its CSP allows the badge mask", () => {
    expect(html).toContain('<a class="wc-badge" href="/apps"><span class="wc-badge-w" aria-hidden="true"></span>Wisconsin Creative</a>');
    expect(html).toContain("img-src 'self' data:;");
    expect(html).toContain("connect-src 'none'");
  });
});
