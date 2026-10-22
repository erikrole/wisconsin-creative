"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { BrotherUsbDevice } from "@/lib/brother-usb";

type Mode = "normal" | "pause-first" | "disconnect-second" | "fail-local-final";
type Simulation = { mode: Mode; log: string[]; release?: () => void };
let simulation: Simulation | undefined;
/** Opt-in, loopback fixture only. No real USB methods are called in this mode. */
export function installUsbSimulation() {
  if (typeof window === "undefined" || !new URLSearchParams(location.search).has("simulate-usb") || simulation) return;
  const state: Simulation = simulation = { mode: "normal", log: [] };
  let queue: Uint8Array[] = [], pages = 0, failSave = false;
  const notify = (message: string) => { state.log.push(message); window.dispatchEvent(new Event("label-usb-simulation")); };
  const frame = (type = 0, phase = 0) => {
    const bytes = new Uint8Array(32); bytes.set([128, 32, 66]); bytes[10] = 12; bytes[11] = 1;
    bytes[18] = type; bytes[19] = phase; bytes[24] = 8; bytes[25] = 1; return bytes;
  };
  const originalSet = Storage.prototype.setItem;
  Storage.prototype.setItem = function(key, value) {
    if (key === "wc-qr-usb-journal-v2" && failSave) { failSave = false; notify("Simulated local journal write failed once"); throw new DOMException("Simulated quota failure", "QuotaExceededError"); }
    return originalSet.call(this, key, value);
  };
  const device: BrotherUsbDevice = {
    vendorId: 0x04f9, productId: 0x20e1, productName: "SIMULATED PT-D610BT", opened: false,
    configuration: { interfaces: [{ interfaceNumber: 0, alternates: [{ alternateSetting: 0, interfaceClass: 7, endpoints: [{ endpointNumber: 1, direction: "in", type: "bulk" }, { endpointNumber: 2, direction: "out", type: "bulk" }] }] }] },
    async open() { device.opened = true; pages = 0; queue = []; notify("Opened simulated USB"); },
    async close() { device.opened = false; notify("Closed simulated USB"); },
    async selectConfiguration() {}, async claimInterface() {}, async selectAlternateInterface() {}, async clearHalt() {},
    async transferOut(_endpoint, bytes) {
      if (bytes.length === 3) queue.push(frame());
      else if (bytes.length > 4 && [12, 26].includes(bytes.at(-1)!)) {
        const info = bytes[0] === 0 ? 214 : 0, rows = bytes[info + 7]! + 256 * bytes[info + 8]!;
        const feed = rows === 4;
        if (!feed) pages++;
        notify(feed ? "Zero-ink Stop feed" : `Label content ${pages} · ${bytes.at(-1) === 26 ? "final" : "provisional"}`);
        if (state.mode === "disconnect-second" && pages === 2) throw new Error("Simulated USB disconnect");
        queue.push(frame(6, 1));
        if (state.mode === "pause-first" && pages === 1 && !feed) state.release = () => { queue.push(frame(6)); delete state.release; notify("Released simulated page"); };
        else queue.push(frame(6));
        if (state.mode === "fail-local-final" && bytes.at(-1) === 26) failSave = true;
      } else notify("End print mode");
      return { status: "ok", bytesWritten: bytes.length };
    },
    async transferIn() {
      const bytes = queue.shift() ?? new Uint8Array();
      return { status: "ok", data: new DataView(bytes.buffer) };
    },
  };
  const access = Object.assign(new EventTarget(), { getDevices: async () => [device], requestDevice: async () => device });
  Object.defineProperty(navigator, "usb", { configurable: true, value: access });
}
export function UsbSimulationControls() {
  const [, render] = useState(0);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); const changed = () => render(n => n + 1); window.addEventListener("label-usb-simulation", changed); return () => window.removeEventListener("label-usb-simulation", changed); }, []);
  if (!mounted || !simulation) return null;
  return <div className="mb-4 rounded-lg border border-amber-600 p-3 text-xs"><p className="font-bold">Simulated USB · No physical printer output</p><div className="mt-2 flex flex-wrap items-center gap-2"><Label htmlFor="usb-simulation">Next simulation</Label><select id="usb-simulation" className="h-10 rounded border bg-background px-2" value={simulation.mode} onChange={event => { simulation!.mode = event.target.value as Mode; render(n => n + 1); }}><option value="normal">Normal chain</option><option value="pause-first">Pause first page for Stop</option><option value="disconnect-second">Disconnect on second label</option><option value="fail-local-final">Fail local save after final feed</option></select><Button variant="outline" size="sm" disabled={!simulation.release} onClick={() => simulation?.release?.()}>Release simulated page</Button><Button variant="outline" size="sm" onClick={() => window.dispatchEvent(new Event("focus"))}>Refresh saved progress</Button></div><pre aria-label="Simulated USB commands" className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap">{simulation.log.join("\n") || "No USB commands yet"}</pre></div>;
}
