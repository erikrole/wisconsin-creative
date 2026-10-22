import type { LabelBitmap } from "./brother-label-render";

// D610 framing verified byte-for-byte against MacPrintSDK (SHA 3b958667...e85b),
// then on physical 04f9:20e1 hardware. First/middle pages remain provisional;
// only the final 1A or the explicitly journaled zero-ink feed releases the tail.
function packBits(line: Uint8Array) {
  const encoded: number[] = [];
  let index = 0;
  while (index < line.length) {
    let end = index + 1;
    while (end < line.length && line[end] === line[index] && end - index < 128) end++;
    if (end - index >= 2) {
      encoded.push(257 - (end - index), line[index]!);
      index = end;
      continue;
    }
    const begin = index++;
    while (index < line.length && index - begin < 128) {
      if (index + 1 < line.length && line[index] === line[index + 1]) break;
      index++;
    }
    encoded.push(index - begin - 1, ...line.slice(begin, index));
  }
  return encoded;
}
function sdkPage(columns: Uint8Array[], index: number, total: number) {
  if (!Number.isInteger(total) || total < 1 || total > 500 || !Number.isInteger(index) || index < 0 || index >= total ||
      columns.length < 1 || columns.length > 536 || columns.some(column => column.length !== 16)) throw new Error("Invalid D610 page.");
  const rows = columns.length, mode = index === total - 1 ? 2 : index === 0 ? 0 : 1;
  const bytes: number[] = [];
  if (index === 0) bytes.push(...new Uint8Array(200), 27, 105, 97, 1, 27, 64, 27, 105, 33, 0, 27, 105, 112, 1);
  bytes.push(
    27, 105, 122, 0xc4, 1, 12, 0, rows & 255, (rows >> 8) & 255, 0, 0, mode, 0,
    27, 105, 75, 8,           // Native no-chain mode; intermediate 0C keeps the tail held.
    27, 105, 77, 64,          // Automatic cut, one per label.
    27, 105, 65, 1,
    27, 105, 107, 99, total & 255, (total >> 8) & 255,
    27, 105, 100, 14, 0,     // Native 14-dot margin.
    77, 2,                   // TIFF PackBits raster compression.
  );
  // Native assembly appends the first/middle/final media checks to the first vector.
  if (index === 0) for (let check = 0; check < Math.min(total, 3); check++) {
    bytes.push(27, 105, 76, 0, 1, 1, 27, 105, 67, 1, 255, 255, 255);
  }
  for (const line of columns) {
    const packed = packBits(line);
    if (packed.length <= 16) bytes.push(71, packed.length, 0, ...packed);
    else bytes.push(71, 17, 0, 15, ...line);
  }
  bytes.push(index === total - 1 ? 26 : 12);
  return Uint8Array.from(bytes);
}

export function brotherChainPage(bitmap: LabelBitmap, index: number, total: number): Uint8Array {
  if (bitmap.height !== 76 || !Number.isInteger(bitmap.width) || bitmap.width < 1 || bitmap.width > 536 || bitmap.ink.length !== bitmap.width * 76) throw new Error("Invalid label image.");
  const columns = Array.from({ length: bitmap.width }, (_, x) => {
    const line = new Uint8Array(16);
    for (let y = 0; y < 76; y++) if (bitmap.ink[y * bitmap.width + x]) {
      const pin = 101 - y;
      line[15 - Math.floor(pin / 8)]! |= 1 << (pin % 8);
    }
    return line;
  });
  return sdkPage(columns, index, total);
}
/** Four empty rows satisfy the native minimum-length guard; never replay ink. */
export function brotherChainFeed(total: number): Uint8Array {
  if (total < 2) throw new Error("There is no held chain to finish.");
  return sdkPage(Array.from({ length: 4 }, () => new Uint8Array(16)), total - 1, total);
}
