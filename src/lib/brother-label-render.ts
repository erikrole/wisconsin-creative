import { fitsBrotherQr, LABEL_KINDS, type LabelRow } from "./brother-label-csv";

/** Approved PT-D610BT layout, in 180 dpi printer dots. */
export type LabelBitmap = { width: number; height: number; ink: Uint8Array; preview: string };
type Outlines = { postScriptName: string; sizePx: number; glyphs: Record<string, { advance: number; path: string }> };
let font: Promise<Outlines> | undefined;
const cache = new Map<string, Promise<LabelBitmap>>();
async function loadFont(): Promise<Outlines> {
  if (!font) font = fetch("/GothamXNarrow-Bold.outlines.json", { signal: AbortSignal.timeout(10000) }).then(async (res) => {
    if (!res.ok) throw new Error("Gotham could not load. Reload before printing.");
    const value: Outlines = await res.json();
    if (value.postScriptName !== "GothamXNarrow-Bold" || value.sizePx !== 21 || !value.glyphs?.F?.path) throw new Error("The label font could not be verified.");
    return value;
  }).catch((error) => { font = undefined; throw error; });
  return font;
}
function canvas(width: number, height: number) {
  const element = document.createElement("canvas");
  element.width = width; element.height = height;
  const context = element.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Label rendering is unavailable in this browser.");
  return { element, context };
}
/** Trim actual glyph ink instead of estimating font ascent or using a fallback face. */
function textInk(lines: string[], outlines: Outlines, size: number, rotated: boolean) {
  const scale = size / outlines.sizePx;
  const glyphLines = lines.map((line) => Array.from(line).map((char) => {
    const glyph = outlines.glyphs[char];
    if (!glyph) throw new Error(`Gotham cannot print “${char}”. Edit the label text.`);
    return glyph;
  }));
  const widths = glyphLines.map((line) => line.reduce((sum, glyph) => sum + glyph.advance, 0));
  const width = Math.max(100, Math.ceil(Math.max(...widths) * scale) + 24);
  const { context } = canvas(width, 160);
  context.fillStyle = "white";
  glyphLines.forEach((glyphs, i) => {
    let x = (width - widths[i]! * scale) / 2;
    for (const glyph of glyphs) {
      context.setTransform(scale, 0, 0, scale, x, Math.max(20, Math.ceil(size * 1.5)) + i * size * 24 / 21);
      context.fill(new Path2D(glyph.path));
      x += glyph.advance * scale;
    }
  });
  const rgba = context.getImageData(0, 0, width, 160).data;
  let left = width, top = 160, right = -1, bottom = -1;
  for (let y = 0; y < 160; y++) for (let x = 0; x < width; x++) if (rgba[(y * width + x) * 4 + 3]! >= 128) {
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  if (right < left) return { width: 0, height: 0, ink: new Uint8Array() };
  const w = right - left + 1, h = bottom - top + 1;
  const ink = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const on = rgba[((y + top) * width + x + left) * 4 + 3]! >= 128 ? 1 : 0;
    // Rotated (battery) text reads bottom-to-top with the digit bottoms toward the QR. Erik confirmed this on tape 2026-10-23; keep it.
    ink[rotated ? (w - 1 - x) * h + y : y * w + x] = on;
  }
  return { width: rotated ? h : w, height: rotated ? w : h, ink };
}
async function render(row: LabelRow): Promise<LabelBitmap> {
  const hasQr = LABEL_KINDS[row.kind].needsQr;
  if (hasQr && !fitsBrotherQr(row.qrCodeValue)) throw new Error("This QR needs a larger label layout. Its identity has not been changed.");
  const lines = ["body", "lens", "sd"].includes(row.kind) ? [row.dept, row.model, row.number]
    : [row.kind === "text" ? row.model : row.number || row.model];
  if (lines.some((line) => line.length > 200 || /[\r\n\t]/.test(line))) throw new Error("Use up to 200 characters per printed line, without line breaks.");
  if (lines.every((line) => !line.trim()) && !hasQr) throw new Error("Enter text for this label.");
  const outlines = await loadFont();
  const rotated = row.kind === "battery";
  const maxTextWidth = hasQr ? 85 : row.kind === "sd" ? 80 : 480;
  const maxSize = ["body", "lens", "sd"].includes(row.kind) ? 21 : 58;
  let size = maxSize, text = textInk(lines, outlines, size, rotated);
  while ((text.height > 64 || text.width > maxTextWidth) && size > 7) {
    size -= 0.5; text = textInk(lines, outlines, size, rotated);
  }
  if (text.height > 64 || text.width > maxTextWidth) throw new Error("Text is too long to fit legibly. Shorten the printed text.");
  const height = 76, width = hasQr ? 194 : row.kind === "sd" ? 120 : Math.max(120, text.width + 56);
  const ink = new Uint8Array(width * height);
  const gap = hasQr && text.width ? 18 : 0;
  const left = Math.floor((width - text.width - gap - (hasQr ? 63 : 0)) / 2);
  const top = Math.floor((height - text.height) / 2);
  for (let y = 0; y < text.height; y++) for (let x = 0; x < text.width; x++) ink[(y + top) * width + left + x] = text.ink[y * text.width + x]!;
  if (hasQr) {
    const { create } = await import("qrcode");
    const qr = create(row.qrCodeValue, { version: 1, errorCorrectionLevel: "M" });
    const qrX = left + text.width + gap;
    for (let y = 0; y < 63; y++) for (let x = 0; x < 63; x++) ink[(y + 6) * width + qrX + x] = qr.modules.get(Math.floor(y / 3), Math.floor(x / 3)) ? 1 : 0;
  }
  const { element, context } = canvas(width, height);
  const image = context.createImageData(width, height);
  for (let i = 0; i < ink.length; i++) {
    image.data[i * 4] = image.data[i * 4 + 1] = image.data[i * 4 + 2] = ink[i]! * 255;
    image.data[i * 4 + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return { width, height, ink, preview: element.toDataURL("image/png") };
}
/** The preview and USB sender consume this exact monochrome bitmap. */
export function renderBrotherLabel(row: LabelRow): Promise<LabelBitmap> {
  const key = JSON.stringify([row.kind, row.dept, row.model, row.number, row.qrCodeValue]);
  let result = cache.get(key);
  if (!result) {
    result = render(row).catch((error) => { cache.delete(key); throw error; });
    cache.set(key, result);
    if (cache.size > 100) cache.delete(cache.keys().next().value!);
  }
  return result;
}

type QrDecoder = (data: Uint8ClampedArray, width: number, height: number) => { data: string } | null;
let decoder: Promise<QrDecoder> | undefined;
function loadDecoder(): Promise<QrDecoder> {
  if (!decoder) decoder = new Promise<QrDecoder>((resolve, reject) => {
    const target = window as typeof window & { jsQR?: QrDecoder };
    if (target.jsQR) { resolve(target.jsQR); return; }
    const script = document.createElement("script");
    script.src = "/qrcode/vendor/jsQR.js";
    const timeout = setTimeout(() => { script.remove(); reject(new Error("QR verification timed out. Retry the label checks.")); }, 10000);
    script.onload = () => { clearTimeout(timeout); if (target.jsQR) resolve(target.jsQR); else reject(new Error("QR verification could not load. Retry the label checks.")); };
    script.onerror = () => { clearTimeout(timeout); script.remove(); reject(new Error("QR verification could not load. Retry the label checks.")); };
    document.head.appendChild(script);
  }).catch((error) => { decoder = undefined; throw error; });
  return decoder;
}
/** Independently decode the final monochrome bitmap, preserving the approved print pixels. */
export async function verifyBrotherQr(bitmap: LabelBitmap, expected: string) {
  const decode = await loadDecoder();
  const border = 12, width = bitmap.width + border * 2, height = bitmap.height + border * 2;
  const rgba = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 0; y < bitmap.height; y++) for (let x = 0; x < bitmap.width; x++) {
    const offset = ((y + border) * width + x + border) * 4;
    rgba[offset] = rgba[offset + 1] = rgba[offset + 2] = bitmap.ink[y * bitmap.width + x] ? 0 : 255;
  }
  if (decode(rgba, width, height)?.data !== expected) throw new Error("The rendered QR could not be verified against this item's identity. Printing is paused.");
}
