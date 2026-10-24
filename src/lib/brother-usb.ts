import { brotherChainPage, brotherChainFeed } from "./brother-chain";
import type { LabelBitmap } from "./brother-label-render";

// PT-D610BT only. Protocol facts verified against ptouch-print's model table,
// libptouch.c / ptouch-print.c and physical 04f9:20e1 hardware (2026-10-22).
// https://git.familie-radermacher.ch/linux/ptouch-print.git/tree/src/libptouch.c
const unusableDevices = new WeakSet<BrotherUsbDevice>();
const VENDOR = 0x04f9, PRODUCT = 0x20e1;
export const BROTHER_USB_LOCK = "qr-print-pt-d610bt";
/** The one printer this helper drives; other USB devices (a scanner, a keyboard) are ignored. */
export function isBrotherUsb(device: { vendorId: number; productId: number } | undefined): boolean {
  return Boolean(device && device.vendorId === VENDOR && device.productId === PRODUCT);
}
type Endpoint = { endpointNumber: number; direction: "in" | "out"; type: string };
type Alternate = { alternateSetting: number; interfaceClass: number; endpoints: Endpoint[] };
export interface BrotherUsbDevice {
  vendorId: number; productId: number; productName?: string; opened: boolean;
  configuration: { interfaces: { interfaceNumber: number; alternate?: Alternate; alternates: Alternate[] }[] } | null;
  open(): Promise<void>; close(): Promise<void>; selectConfiguration(value: number): Promise<void>;
  claimInterface(value: number): Promise<void>; selectAlternateInterface(value: number, alternate: number): Promise<void>;
  transferOut(endpoint: number, data: Uint8Array): Promise<{ status: string; bytesWritten: number }>;
  transferIn(endpoint: number, length: number): Promise<{ status: string; data?: DataView }>;
  clearHalt(direction: "in", endpoint: number): Promise<void>;
}
interface UsbAccess extends EventTarget { getDevices(): Promise<BrotherUsbDevice[]>; requestDevice(options: { filters: { vendorId: number; productId: number }[] }): Promise<BrotherUsbDevice> }
export function brotherUsbAccess(): UsbAccess | undefined {
  return typeof navigator === "undefined" ? undefined : (navigator as Navigator & { usb?: UsbAccess }).usb;
}
export async function chooseBrotherUsb() {
  const usb = brotherUsbAccess();
  if (!usb) throw new Error("Use Chrome or Edge on this computer for USB printing.");
  const granted = (await usb.getDevices()).filter(isBrotherUsb);
  if (granted.length === 1) return granted[0]!;
  return usb.requestDevice({ filters: [{ vendorId: VENDOR, productId: PRODUCT }] });
}
async function bounded<T>(promise: Promise<T>, ms = 8000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("The printer stopped responding. Check its screen and cable.")), ms);
    })]);
  } finally { clearTimeout(timer); }
}

/** One claimed connection at a time. Always close before releasing the caller's Web Lock. */
export class BrotherUsbPrinter {
  private input = 0;
  private output = 0;
  private backlog: number[] = [];
  private chainNext = 0;
  private chainTotal = 0;
  private chainFinal = false;
  constructor(private device: BrotherUsbDevice) {}
  async open() {
    try {
      if (unusableDevices.has(this.device)) throw new Error("Reconnect the USB cable and reload this helper before printing again.");
      if (!isBrotherUsb(this.device)) throw new Error("Select the Brother PT-D610BT.");
      await this.device.open();
      if (!this.device.configuration) await this.device.selectConfiguration(1);
      const interfaces = this.device.configuration?.interfaces ?? [];
      const match = interfaces.flatMap((i) => i.alternates.map((a) => ({ i, a }))).find(({ a }) => a.interfaceClass === 7 && ["in", "out"].every((direction) => a.endpoints.some((e) => e.type === "bulk" && e.direction === direction)));
      if (!match) throw new Error("This printer does not expose its USB print connection.");
      await this.device.claimInterface(match.i.interfaceNumber);
      if (match.i.alternate?.alternateSetting !== match.a.alternateSetting) await this.device.selectAlternateInterface(match.i.interfaceNumber, match.a.alternateSetting);
      this.input = match.a.endpoints.find((e) => e.type === "bulk" && e.direction === "in")!.endpointNumber;
      this.output = match.a.endpoints.find((e) => e.type === "bulk" && e.direction === "out")!.endpointNumber;
      this.backlog = [];
    } catch (error) { await this.close(); throw error; }
  }
  async close() {
    // A timed-out transfer is still pending; closing aborts it before another read or job.
    try { if (this.device.opened) await this.device.close(); }
    catch (error) { unusableDevices.add(this.device); throw error; }
    this.backlog = [];
  }
  private async send(bytes: number[] | Uint8Array) {
    const result = await bounded(this.device.transferOut(this.output, new Uint8Array(bytes)));
    if (result.status !== "ok" || result.bytesWritten !== bytes.length) throw new Error("The printer did not receive the full label. Check the cable.");
  }
  private append(data?: DataView) {
    if (data?.byteLength) this.backlog.push(...new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  }
  private async status(deadline: number): Promise<number[]> {
    while (this.backlog.length < 32) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("Printer completion was not confirmed.");
      const result = await bounded(this.device.transferIn(this.input, 64), remaining);
      if (result.status !== "ok") throw new Error("Could not read the printer status.");
      this.append(result.data);
      // The D610BT emits many successful zero-length packets before completion.
      if (!result.data?.byteLength) await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const frame = this.backlog.splice(0, 32);
    if (frame[0] !== 0x80 || frame[1] !== 0x20 || frame[2] !== 0x42) throw new Error("The printer returned an unrecognized response.");
    if (frame[8] || frame[9]) throw new Error("The printer reported an error. Check its screen and tape.");
    if (frame[10] !== 12 || frame[11] !== 1 || frame[24] !== 8 || frame[25] !== 1) throw new Error("Load 12 mm laminated white-on-black tape for this layout.");
    return frame;
  }
  async checkReady() {
    const deadline = Date.now() + 8000;
    while (this.backlog.length) await this.status(deadline);
    await this.send([0x1b, 0x69, 0x53]);
    while (Date.now() < deadline) {
      const frame = await this.status(deadline);
      if (frame[18] !== 0) continue; // Old phase/completion frames are not a fresh status reply.
      if (frame[19] !== 0 || frame[20] !== 0 || frame[21] !== 0) throw new Error("The printer is busy. Wait for it to finish.");
      while (this.backlog.length) {
        const trailing = await this.status(deadline);
        if ((trailing[18] === 6 && trailing[19] === 1) || (trailing[18] === 0 && (trailing[19] || trailing[20] || trailing[21]))) throw new Error("The printer is busy. Wait for it to finish.");
      }
      return;
    }
    throw new Error("The printer did not confirm it is ready.");
  }
  private async receivePhase() {
    const deadline = Date.now() + 45000;
    let sawPrinting = false, phase: number | undefined;
    while (Date.now() < deadline) {
      const frame = await this.status(deadline);
      if (frame[18] === 6) {
        if (frame[19] === 1) { sawPrinting = true; phase = 1; }
        else if (frame[19] === 0 && sawPrinting) phase = 0;
      }
      // Consume trailing errors and phase changes before allowing the next page.
      if (sawPrinting && phase === 0 && this.backlog.length === 0) return;
    }
    throw new Error("The current label's printing and receive phases were not confirmed.");
  }
  async printChainPage(bitmap: LabelBitmap, index: number, total: number, started: () => void) {
    const bytes = brotherChainPage(bitmap, index, total);
    if (index !== this.chainNext || (index > 0 && total !== this.chainTotal) || this.chainFinal) throw new Error("The printer's page order changed. Review the batch.");
    if (index === 0) await this.checkReady();
    started(); // Durable begin checkpoint precedes every setup/content byte.
    this.chainTotal = total; this.chainNext++;
    await this.send(bytes);
    await this.receivePhase();
    if (index === total - 1) this.chainFinal = true;
  }
  async finishHeldChain(total: number) {
    if (this.chainFinal || this.chainNext < 1 || this.chainNext >= total || total !== this.chainTotal) throw new Error("This connection has no held labels to release.");
    this.chainFinal = true; // A failed finish may never be retried on this connection.
    await this.send(brotherChainFeed(total));
    await this.receivePhase();
    await this.endChain();
  }
  async endChain() {
    if (!this.chainFinal) throw new Error("The final printer page has not completed.");
    await this.send([0x1b, 0x69, 0x61, 0xff]);
  }
  async print(bitmap: LabelBitmap, started: () => void) {
    if (bitmap.height !== 76 || bitmap.width < 1 || bitmap.width > 536 || bitmap.ink.length !== bitmap.width * 76) throw new Error("Invalid label image.");
    await this.checkReady();
    // Persist the attempt BEFORE any print setup; failure after here is an unknown outcome.
    started();
    await this.send([...new Uint8Array(100), 0x1b, 0x40]);
    await this.checkReady();
    await this.send([0x1b, 0x69, 0x61, 1]);
    const drain = await bounded(this.device.transferIn(this.input, 32), 1500);
    if (drain.status === "stall") await bounded(this.device.clearHalt("in", this.input));
    else if (drain.status !== "ok") throw new Error("Could not enter label printing mode.");
    this.append(drain.data);
    await this.checkReady();
    await this.send([0x1b, 0x69, 0x7a, 0, 0, 12, 0, bitmap.width & 255, bitmap.width >> 8, 0, 0, 2, 0]);
    await this.send([0x1b, 0x69, 0x64, 1, 0, 0x4d, 0]);
    await this.send([0x1b, 0x69, 0x4d, 0x40]); // Cut the blank leader before the balanced label.
    for (let x = 0; x < bitmap.width; x++) {
      const bytes = new Uint8Array(19); bytes.set([0x47, 16, 0]);
      for (let y = 0; y < 76; y++) if (bitmap.ink[y * bitmap.width + x]) {
        const pin = 26 + 75 - y;
        bytes[3 + 15 - Math.floor(pin / 8)]! |= 1 << (pin % 8);
      }
      await this.send(bytes);
    }
    await this.send([0x1a]);
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) if ((await this.status(deadline))[18] === 1) {
      // Validate bytes already received alongside completion instead of hiding a trailing error.
      while (this.backlog.length) await this.status(deadline);
      return;
    }
    throw new Error("Printer completion was not confirmed.");
  }
}
