import { createHash } from "node:crypto";
import { brotherChainPage, brotherChainFeed } from "@/lib/brother-chain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrotherUsbPrinter, isBrotherUsb, type BrotherUsbDevice } from "@/lib/brother-usb";
import type { LabelBitmap } from "@/lib/brother-label-render";

const status = (type = 0, patch: Record<number, number> = {}) => {
  const bytes = new Uint8Array(32);
  bytes.set([0x80, 0x20, 0x42]);
  bytes[10] = 12; bytes[11] = 1; bytes[18] = type; bytes[24] = 8; bytes[25] = 1;
  Object.entries(patch).forEach(([key, value]) => { bytes[Number(key)] = value; });
  return bytes;
};
class Usb implements BrotherUsbDevice {
  vendorId = 0x04f9; productId = 0x20e1; opened = false;
  configuration = { interfaces: [{ interfaceNumber: 0, alternates: [{ alternateSetting: 0, interfaceClass: 7, endpoints: [{ direction: "in" as const, endpointNumber: 1, type: "bulk" }, { direction: "out" as const, endpointNumber: 2, type: "bulk" }] }] }] };
  writes: number[][] = [];
  incoming: Uint8Array[] = [];
  ready = status();
  completion = [status(6, { 19: 1 }), status(1)];
  drain = new Uint8Array();
  shortRaster = false;
  hangRaster = false;
  closes = 0;
  async open() { this.opened = true; }
  async close() { this.opened = false; this.closes++; }
  async selectConfiguration() {}
  async claimInterface() {}
  async selectAlternateInterface() {}
  async clearHalt() {}
  async transferOut(_endpoint: number, data: Uint8Array) {
    const bytes = Array.from(data); this.writes.push(bytes);
    if (bytes.join() === "27,105,83") this.incoming.push(this.ready);
    if (bytes.join() === "27,105,97,1") this.incoming.push(this.drain);
    if (bytes.join() === "26") this.incoming.push(...this.completion);
    if (data[0] === 0x47 && this.hangRaster) return new Promise<{ status: string; bytesWritten: number }>(() => {});
    return { status: "ok", bytesWritten: this.shortRaster && data[0] === 0x47 ? 2 : data.length };
  }
  async transferIn() {
    const bytes = this.incoming.shift();
    if (!bytes) return new Promise<{ status: string; data?: DataView }>(() => {});
    return { status: "ok", data: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength) };
  }
}
const image = (): LabelBitmap => {
  const ink = new Uint8Array(3 * 76); ink[0] = 1; ink[75 * 3 + 2] = 1;
  return { width: 3, height: 76, ink, preview: "" };
};
afterEach(() => { vi.useRealTimers(); });
describe("PT-D610BT USB job boundary", () => {
  it("prints the bitmap in printer-pin order and waits through empty packets/phase notifications for completion", async () => {
    vi.useFakeTimers();
    const usb = new Usb();
    usb.completion = [...Array.from({ length: 123 }, () => new Uint8Array()), status(6, { 19: 1 }), status(1).slice(0, 11), status(1).slice(11)];
    const printer = new BrotherUsbPrinter(usb); await printer.open();
    const started = vi.fn(); let completed = false;
    const job = printer.print(image(), started).then(() => { completed = true; });
    await vi.advanceTimersByTimeAsync(1000); expect(completed).toBe(false);
    await vi.runAllTimersAsync(); await job;
    expect(started).toHaveBeenCalledOnce(); expect(completed).toBe(true);
    const columns = usb.writes.filter((bytes) => bytes[0] === 0x47);
    expect(columns).toHaveLength(3);
    expect(columns[0]!.filter(Boolean)).toEqual([0x47, 16, 32]);
    expect(columns[0]![6]).toBe(32); expect(columns[2]![15]).toBe(4);
    expect(usb.writes.filter((bytes) => bytes.join() === "26")).toHaveLength(1);
    await printer.close(); expect(usb.opened).toBe(false);
  });
  it("preserves an already-selected interface instead of resetting its USB endpoints", async () => {
    const usb = new Usb();
    Object.assign(usb.configuration.interfaces[0]!, { alternate: usb.configuration.interfaces[0]!.alternates[0] });
    usb.selectAlternateInterface = async () => { throw new Error("Active endpoint state was reset"); };
    const printer = new BrotherUsbPrinter(usb); await printer.open();
    await printer.print(image(), vi.fn());
    expect(usb.writes.filter((bytes) => bytes.join() === "26")).toHaveLength(1);
    await printer.close();
  });
  it.each<Record<number, number>>([{ 10: 18 }, { 11: 0 }, { 24: 1 }, { 25: 8 }, { 8: 1 }, { 9: 1 }, { 19: 1 }])("blocks setup and pixels for wrong media, printer errors or a busy printer: %j", async (patch) => {
    const usb = new Usb(); usb.ready = status(0, patch);
    const printer = new BrotherUsbPrinter(usb); await printer.open(); const started = vi.fn();
    await expect(printer.print(image(), started)).rejects.toThrow();
    expect(started).not.toHaveBeenCalled(); expect(usb.writes).toEqual([[27, 105, 83]]);
    await printer.close();
  });
  it("does not treat an old completion as readiness, and validates a mode-drain status before the fresh query", async () => {
    const usb = new Usb(); usb.incoming.push(status(1)); usb.drain = status(0, { 9: 1 });
    const printer = new BrotherUsbPrinter(usb); await printer.open();
    await expect(printer.print(image(), vi.fn())).rejects.toThrow("printer reported an error");
    expect(usb.writes.filter((bytes) => bytes[0] === 0x47)).toHaveLength(0);
    expect(usb.writes.filter((bytes) => bytes.join() === "27,105,83")).toHaveLength(2);
    await printer.close();
  });
  it("checks fresh readiness for each consecutive label on the same connection", async () => {
    const usb = new Usb();
    usb.completion = [status(1), status(6)];
    const printer = new BrotherUsbPrinter(usb); await printer.open();
    await printer.print(image(), vi.fn());
    usb.ready = status(0, { 8: 1 });
    await expect(printer.print(image(), vi.fn())).rejects.toThrow("printer reported an error");
    expect(usb.writes.filter((bytes) => bytes.join() === "26")).toHaveLength(1);
    expect(usb.writes.filter((bytes) => bytes[0] === 0x47)).toHaveLength(3);
    await printer.close();
  });
  it("rejects an error received in the same transfer as completion", async () => {
    const usb = new Usb(); usb.completion = [new Uint8Array([...status(1), ...status(2, { 8: 1 })])];
    const printer = new BrotherUsbPrinter(usb); await printer.open();
    await expect(printer.print(image(), vi.fn())).rejects.toThrow("printer reported an error");
    await printer.close();
  });
  it("never retries a short write or finalizes a partial raster", async () => {
    const usb = new Usb(); usb.shortRaster = true;
    const printer = new BrotherUsbPrinter(usb); await printer.open();
    await expect(printer.print(image(), vi.fn())).rejects.toThrow("full label");
    expect(usb.writes.filter((bytes) => bytes[0] === 0x47)).toHaveLength(1);
    expect(usb.writes.some((bytes) => bytes.join() === "26")).toBe(false);
    await printer.close();
  });
  it("returns an uncertain transfer timeout without sending another command, allowing close to abort the pending transfer", async () => {
    vi.useFakeTimers();
    const usb = new Usb(); usb.hangRaster = true;
    const printer = new BrotherUsbPrinter(usb); await printer.open();
    const result = printer.print(image(), vi.fn()).catch((error: unknown) => error);
    await vi.runAllTimersAsync(); expect(await result).toBeInstanceOf(Error);
    expect(usb.writes.at(-1)![0]).toBe(0x47);
    await printer.close(); expect(usb.closes).toBe(1);
  });
});

class ChainUsb extends Usb {
  chainFrames = [status(6, { 19: 1 }), status(1, { 19: 1 }), status(6)];
  shortPage = false;
  override async transferOut(endpoint: number, data: Uint8Array) {
    const result = await super.transferOut(endpoint, data);
    if (data.length > 4 && [12, 26].includes(data.at(-1)!)) {
      this.incoming.push(...this.chainFrames);
      if (this.shortPage) return { status: "ok", bytesWritten: data.length - 1 };
    }
    return result;
  }
}
describe("SDK chained output", () => {
  it("pins native first/middle/final framing, lossless raster data and the accepted zero-ink Stop feed", () => {
    const bitmap = image();
    for (const [index, mode, ending] of [[0, 0, 12], [1, 1, 12], [2, 2, 26]]) {
      const bytes = brotherChainPage(bitmap, index!, 3), info = index === 0 ? 214 : 0;
      expect([...bytes.slice(info, info + 13)]).toEqual([27, 105, 122, 196, 1, 12, 0, 3, 0, 0, 0, mode, 0]);
      expect(bytes.at(-1)).toBe(ending);
      let offset = info + 38 + (index === 0 ? 39 : 0);
      const rows: number[][] = [];
      while (offset < bytes.length - 1) {
        expect(bytes[offset]).toBe(71);
        const end = offset + 3 + bytes[offset + 1]! + 256 * bytes[offset + 2]!;
        let cursor = offset + 3; const row: number[] = [];
        while (cursor < end) {
          const code = bytes[cursor++]!;
          if (code < 128) for (let count = 0; count <= code; count++) row.push(bytes[cursor++]!);
          else if (code > 128) { const value = bytes[cursor++]!; for (let count = 0; count < 257 - code; count++) row.push(value); }
        }
        expect(row).toHaveLength(16); rows.push(row); offset = end;
      }
      expect(rows).toHaveLength(3);
      expect(rows[0]![3]).toBe(32); expect(rows[2]![12]).toBe(4);
      expect(rows.flat().reduce((sum, byte) => sum + byte, 0)).toBe(36);
    }
    const feed = brotherChainFeed(3);
    expect(feed).toHaveLength(59);
    expect(createHash("sha256").update(feed).digest("hex")).toBe("c244a46c4d00762592292b3ad3a1b911e9dca73171887883133bbbd8d2b8d404");
  });
  it("initializes once, waits for each printing→receive transition, and explicitly finishes without resetting between labels", async () => {
    const usb = new ChainUsb(), printer = new BrotherUsbPrinter(usb); await printer.open();
    await printer.printChainPage(image(), 0, 2, vi.fn());
    await printer.printChainPage(image(), 1, 2, vi.fn()); await printer.endChain(); await printer.close();
    expect(usb.writes.map(b => b.length)).toEqual([3, brotherChainPage(image(), 0, 2).length, brotherChainPage(image(), 1, 2).length, 4]);
    expect(usb.writes[1]!.slice(0, 200).every(b => b === 0)).toBe(true);
    expect(usb.writes[2]!.slice(0, 3)).toEqual([27, 105, 122]);
    expect(usb.writes.at(-1)).toEqual([27, 105, 97, 255]);
  });
  it.each(["short", "old-phase", "trailing-error", "trailing-printing"])("fails closed without feeding or replaying after %s", async (fault) => {
    vi.useFakeTimers();
    const usb = new ChainUsb(), printer = new BrotherUsbPrinter(usb); await printer.open();
    if (fault === "short") usb.shortPage = true;
    if (fault === "old-phase") usb.chainFrames = [status(1), status(6)];
    if (fault === "trailing-error") usb.chainFrames = [new Uint8Array([...status(6, { 19: 1 }), ...status(6), ...status(2, { 8: 1 })])];
    if (fault === "trailing-printing") usb.chainFrames = [new Uint8Array([...status(6, { 19: 1 }), ...status(6), ...status(6, { 19: 1 })])];
    const result = printer.printChainPage(image(), 0, 3, vi.fn()).catch(error => error);
    await vi.runAllTimersAsync(); expect(await result).toBeInstanceOf(Error);
    await printer.close(); expect(usb.writes).toHaveLength(2);
  });
  it("releases a deliberately stopped chain with only the zero-ink final page and end-mode command", async () => {
    const usb = new ChainUsb(), printer = new BrotherUsbPrinter(usb); await printer.open();
    await printer.printChainPage(image(), 0, 3, vi.fn()); await printer.finishHeldChain(3);
    expect(usb.writes[2]).toEqual([...brotherChainFeed(3)]);
    await expect(printer.finishHeldChain(3)).rejects.toThrow("no held labels");
    await printer.close(); expect(usb.writes.at(-1)).toEqual([27, 105, 97, 255]);
  });
});

describe("isBrotherUsb", () => {
  it("recognizes only the PT-D610BT, so a scanner or keyboard disconnect never drops the printer", () => {
    expect(isBrotherUsb({ vendorId: 0x04f9, productId: 0x20e1 })).toBe(true);
    expect(isBrotherUsb({ vendorId: 0x04f9, productId: 0x2085 })).toBe(false);
    expect(isBrotherUsb({ vendorId: 0x05e0, productId: 0x1200 })).toBe(false);
    expect(isBrotherUsb(undefined)).toBe(false);
  });
});
