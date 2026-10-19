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
    expect(core.cameraName("NIKON CORPORATION", "NIKON Z 9")).toBe("NIKON Z 9");
    expect(core.cameraName("FUJIFILM", "X-T5")).toBe("Fujifilm X-T5");
  });

  it("picks readable text on dark and light frames", () => {
    expect(core.inkFor("#000000").ink).toBe("#f4f2ed");
    expect(core.inkFor("#a00000").ink).toBe("#f4f2ed");
    expect(core.inkFor("#ffffff").ink).toBe("#15151a");
  });
});
