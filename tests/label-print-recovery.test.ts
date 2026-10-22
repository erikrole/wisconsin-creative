import { describe, expect, it, vi } from "vitest";
import { applyPrintCommand, createPrintJobSchema, newPrintJob, printJobSchema, remainingLabels, type PrintJob, type PrintLabel } from "@/lib/label-print-job";
import { LabelPrintController } from "@/lib/label-print-controller";
import { archiveUnreadableJournal, PRINT_JOURNAL_KEY, readPrintJournal, savePrintJournal, type PrintEnvelope } from "@/lib/label-print-storage";
import type { PrintJobApi } from "@/lib/label-print-client";

const actor = { id: "staff-1", name: "Pat Operator" }, at = "2026-10-22T15:00:00.000Z";
const labels: PrintLabel[] = [0, 1, 2].map((index) => ({ copyId: `same-item-copy-${index}`, row: { kind: "body", dept: "FB", model: "FX3", number: "1", qrCodeValue: "c62a82d7", copies: 1 } }));
const input = (count = 3) => ({ id: crypto.randomUUID(), browserId: crypto.randomUUID(), labels: labels.slice(0, count) });
class MemoryStorage implements Storage {
  data = new Map<string, string>(); fail = false;
  get length() { return this.data.size; } key(i: number) { return [...this.data.keys()][i] ?? null; }
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { if (this.fail) throw new Error("Quota exceeded"); this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); } clear() { this.data.clear(); }
}
function harness(count = 3, chain = false) {
  const storage = new MemoryStorage(); let server: PrintJob | undefined, mirror: PrintEnvelope | undefined;
  let failure: string | undefined;
  const api = {
    create: vi.fn(async (value) => server = newPrintJob(value, actor, at)),
    checkpoint: vi.fn(async (_id, value) => { if (value.command.type === failure) throw new Error("Server unavailable"); return server = applyPrintCommand(server!, value.command, actor, at); }),
    get: vi.fn(async () => server!), list: vi.fn(),
  } satisfies PrintJobApi;
  const controller = new LabelPrintController(storage, api, null, (value) => { mirror = value; });
  const printer = { printChainPage: vi.fn(async (_bitmap, _index: number, _total: number, started: () => void) => { started(); }), finishHeldChain: vi.fn(async () => {}), endChain: vi.fn(async () => {}), open: vi.fn(async () => {}), close: vi.fn(async () => {}), print: vi.fn(async (_bitmap, started: () => void) => { started(); }) };
  const bitmaps = Array.from({ length: count }, () => ({ width: 194, height: 76, ink: new Uint8Array(194 * 76), preview: "fixture" }));
  return { storage, api, controller, printer, bitmaps, start: () => controller.start({ ...input(count), ...(chain ? { transport: "sdk-chain-v1" as const } : {}) }, actor), mirror: () => mirror!, server: () => server!, fail: (type: typeof failure) => { failure = type; } };
}
describe("durable print recovery", () => {
  it("commits final completion and terminal state in one checkpoint, including after reload", async () => {
    const h = harness(1); await h.start();
    await h.controller.run(h.printer, h.bitmaps, actor, () => false, () => {});
    const saved = readPrintJournal(h.storage); expect(saved.kind).toBe("valid");
    if (saved.kind !== "valid") throw new Error("Missing receipt");
    expect(saved.envelope.job).toMatchObject({ state: "completed", activeIndex: null, outcomes: [{ status: "printed", evidence: "printer", recordedAt: at }] });
    expect(h.printer.print).toHaveBeenCalledTimes(1);
  });
  it("preserves acknowledged progress when local storage fails and sends no next label", async () => {
    const h = harness(); await h.start();
    h.printer.print.mockImplementation(async (_bitmap, started) => { started(); h.storage.fail = true; });
    await expect(h.controller.run(h.printer, h.bitmaps, actor, () => false, () => {})).rejects.toThrow("journal could not save");
    expect(h.mirror().job.outcomes[0]!.status).toBe("printed");
    expect(h.printer.print).toHaveBeenCalledTimes(1); expect(h.printer.close).toHaveBeenCalledTimes(1);
    expect(h.server().outcomes[0]!.status).toBe("sending");
  });
  it("retains the exact pending completion after a server failure; log retry prints nothing", async () => {
    const h = harness(); await h.start(); h.fail("complete");
    await expect(h.controller.run(h.printer, h.bitmaps, actor, () => false, () => {})).rejects.toThrow("Server unavailable");
    expect(h.mirror().job.outcomes[0]!.status).toBe("printed");
    expect(h.mirror().pending).toMatchObject({ type: "checkpoint", input: { revision: 1, command: { type: "complete", index: 0 } } });
    const requestId = h.mirror().pending!.input;
    h.fail(undefined); await h.controller.sync();
    expect(h.api.checkpoint.mock.calls.at(-1)![1]).toEqual(requestId);
    expect(h.printer.print).toHaveBeenCalledTimes(1);
  });
  it("sends no device output when the durable begin checkpoint fails", async () => {
    const h = harness(); await h.start(); h.fail("begin");
    await expect(h.controller.run(h.printer, h.bitmaps, actor, () => false, () => {})).rejects.toThrow("Server unavailable");
    expect(h.printer.print).not.toHaveBeenCalled(); expect(h.printer.close).toHaveBeenCalledTimes(1);
  });
  it("keeps only the actual in-flight copy uncertain and requires physical resolution", () => {
    let job = newPrintJob(input(), actor, at);
    job = applyPrintCommand(job, { type: "begin", index: 0 }, actor, at);
    job = applyPrintCommand(job, { type: "complete", index: 0 }, actor, at);
    expect(job.activeIndex).toBeNull(); expect(job.outcomes[1]!.status).toBe("pending");
    job = applyPrintCommand(job, { type: "begin", index: 1 }, actor, at);
    job = applyPrintCommand(job, { type: "halt", error: "Cable disconnected" }, actor, at);
    expect(job.activeIndex).toBe(1); expect(() => remainingLabels(job)).toThrow("uncertain");
    job = applyPrintCommand(job, { type: "resolve", index: 1, printed: true }, { id: "reviewer", name: "Reviewer" }, at);
    expect(job.outcomes[1]).toMatchObject({ evidence: "physical-review", resolvedBy: { id: "reviewer" } });
    expect(remainingLabels(job).map((label) => label.copyId)).toEqual(["same-item-copy-2"]);
  });
  it("does not claim an uncertain output when media readiness fails before print setup", async () => {
    const h = harness(); await h.start();
    h.printer.print.mockImplementation(async () => { throw new Error("Incorrect tape"); });
    await expect(h.controller.run(h.printer, h.bitmaps, actor, () => false, () => {})).rejects.toThrow("Incorrect tape");
    expect(h.server()).toMatchObject({ activeIndex: null, state: "stopped", outcomes: [{ status: "not-printed", evidence: "not-sent" }, { status: "pending" }, { status: "pending" }] });
  });
  it("preserves identical copies separately and includes a confirmed failed copy in the remainder", () => {
    let job = newPrintJob(input(), actor, at);
    job = applyPrintCommand(job, { type: "begin", index: 0 }, actor, at);
    job = applyPrintCommand(job, { type: "resolve", index: 0, printed: false }, actor, at);
    expect(remainingLabels(job).map((label) => label.copyId)).toEqual(labels.map((label) => label.copyId));
    expect(() => applyPrintCommand(job, { type: "begin", index: 1 }, actor, at)).toThrow();
  });
  it("rejects reordered acknowledgements, duplicate identities and stale reviewed executors", () => {
    const job = newPrintJob(input(), actor, at);
    expect(() => applyPrintCommand(job, { type: "complete", index: 0 }, actor, at)).toThrow();
    expect(() => newPrintJob({ ...input(), labels: [labels[0]!, labels[0]!] }, actor, at)).toThrow("Duplicate copy");
    const reviewed = applyPrintCommand(job, { type: "review" }, actor, at);
    expect(() => applyPrintCommand(reviewed, { type: "begin", index: 0 }, actor, at)).toThrow("reviewed");
  });
  it.each(["{invalid", JSON.stringify({ job: { version: 99 } }), JSON.stringify({ job: { ...newPrintJob(input(), actor, at), error: { message: "bad" } } })])("distinguishes unreadable saved records from missing: %s", (raw) => {
    const storage = new MemoryStorage(); storage.setItem(PRINT_JOURNAL_KEY, raw);
    const read = readPrintJournal(storage); expect(read.kind).toBe("unreadable");
    if (read.kind !== "unreadable") throw new Error("Expected blocked journal");
    expect(read.raw).toBe(raw); archiveUnreadableJournal(storage, read);
    expect(readPrintJournal(storage).kind).toBe("missing");
    expect([...storage.data.values()].some((value) => value.includes(JSON.stringify(raw)))).toBe(true);
  });
  it("refuses to discard an unreadable record when archiving fails or another tab replaced it", () => {
    const storage = new MemoryStorage(); storage.setItem(PRINT_JOURNAL_KEY, "bad");
    const read = readPrintJournal(storage); if (read.kind !== "unreadable") throw new Error("Expected blocked journal");
    storage.fail = true; expect(() => archiveUnreadableJournal(storage, read)).toThrow(); expect(storage.getItem(PRINT_JOURNAL_KEY)).toBe("bad");
    storage.fail = false; storage.setItem(PRINT_JOURNAL_KEY, "changed"); expect(() => archiveUnreadableJournal(storage, read)).toThrow("changed");
  });
  it("never prints a copy when a stale begin response already reports that copy completed", async () => {
    const h = harness(1); await h.start();
    h.api.checkpoint.mockImplementationOnce(async () => {
      const begun = applyPrintCommand(h.server(), { type: "begin", index: 0 }, actor, at);
      return applyPrintCommand(begun, { type: "complete", index: 0 }, actor, at);
    });
    await expect(h.controller.run(h.printer, h.bitmaps, actor, () => false, () => {})).rejects.toThrow("active print checkpoint");
    expect(h.printer.print).not.toHaveBeenCalled();
  });
  it("never overwrites another tab's newer journal while retrying a pending log", async () => {
    const h = harness(1); await h.start();
    const other = { job: newPrintJob(input(1), actor, at) };
    savePrintJournal(h.storage, other);
    await expect(h.controller.sync()).rejects.toThrow("journal could not save");
    const read = readPrintJournal(h.storage); expect(read.kind === "valid" && read.envelope.job.id).toBe(other.job.id);
  });
  it("validates active-index and outcome consistency on every storage read", () => {
    const job = newPrintJob(input(1), actor, at), storage = new MemoryStorage();
    expect(() => printJobSchema.parse({ ...job, activeIndex: 1, state: "printing" })).toThrow();
    savePrintJournal(storage, { job }); expect(readPrintJournal(storage).kind).toBe("valid");
  });
});

describe("chained journal recovery", () => {
  it("keeps every intermediate page provisional and settles all copies only after the final feed", async () => {
    const h = harness(3, true); await h.start();
    h.printer.printChainPage.mockImplementation(async (_bitmap, index, _total, started) => {
      started();
      expect(h.mirror().job.outcomes.slice(0, index).every(o => o.status === "buffered")).toBe(true);
      expect(h.mirror().job.outcomes.some(o => o.status === "printed")).toBe(false);
    });
    h.printer.endChain.mockImplementation(async () => { expect(h.mirror().job.finish).toMatchObject({ kind: "last-page", state: "intent" }); });
    await h.controller.runChain(h.printer, h.bitmaps, actor, () => false, () => {});
    expect(h.server().state).toBe("completed"); expect(h.server().outcomes.every(o => o.status === "printed")).toBe(true);
    expect(h.printer.finishHeldChain).not.toHaveBeenCalled(); expect(h.printer.endChain).toHaveBeenCalledOnce();
  });
  it("Stop durably authorizes one zero-ink finish and excludes unsent copies from completion", async () => {
    const h = harness(3, true); await h.start(); let stop = false;
    h.printer.printChainPage.mockImplementation(async (_bitmap, _index, _total, started) => { started(); stop = true; });
    h.printer.finishHeldChain.mockImplementation(async () => { expect(h.server().finish).toMatchObject({ kind: "stop-feed", state: "intent" }); });
    await h.controller.runChain(h.printer, h.bitmaps, actor, () => stop, () => {});
    expect(h.printer.printChainPage).toHaveBeenCalledTimes(1); expect(h.printer.finishHeldChain).toHaveBeenCalledTimes(1);
    expect(h.server().outcomes.map(o => o.status)).toEqual(["printed", "pending", "pending"]);
    expect(remainingLabels(h.server()).map(l => l.copyId)).toEqual(labels.slice(1).map(l => l.copyId));
    const reloaded = new LabelPrintController(h.storage, h.api, h.mirror(), () => {});
    await expect(reloaded.runChain(h.printer, h.bitmaps, actor, () => false, () => {})).rejects.toThrow("new complete batch");
    expect(h.printer.printChainPage).toHaveBeenCalledTimes(1);
  });
  it.each([0, 1])("Stop during begin checkpoint %s sends no content for that copy", async (stopAt) => {
    const h = harness(3, true); await h.start(); let stop = false;
    const checkpoint = h.api.checkpoint.getMockImplementation()!;
    h.api.checkpoint.mockImplementation(async (id, value) => {
      const response = await checkpoint(id, value);
      if (value.command.type === "begin" && value.command.index === stopAt) stop = true;
      return response;
    });
    await h.controller.runChain(h.printer, h.bitmaps, actor, () => stop, () => {});
    expect(h.printer.printChainPage).toHaveBeenCalledTimes(stopAt);
    expect(h.printer.finishHeldChain).toHaveBeenCalledTimes(stopAt);
    expect(h.server().outcomes[stopAt]).toMatchObject({ status: "not-printed", evidence: "not-sent" });
  });
  it.each(["buffer", "begin-feed", "settle-chain"])("a failed %s checkpoint never replays pixels or silently feeds during log recovery", async (checkpoint) => {
    const h = harness(3, true); await h.start(); let stop = false; h.fail(checkpoint);
    h.printer.printChainPage.mockImplementation(async (_bitmap, _index, _total, started) => { started(); stop = true; });
    await expect(h.controller.runChain(h.printer, h.bitmaps, actor, () => stop, () => {})).rejects.toThrow("Server unavailable");
    const feedCount = h.printer.finishHeldChain.mock.calls.length;
    expect(feedCount).toBe(checkpoint === "settle-chain" ? 1 : 0);
    h.fail(undefined); await h.controller.sync();
    expect(h.printer.printChainPage).toHaveBeenCalledTimes(1); expect(h.printer.finishHeldChain).toHaveBeenCalledTimes(feedCount);
    if (checkpoint !== "settle-chain") expect(() => remainingLabels(h.server())).toThrow("uncertain");
  });
  it("retains every held and in-flight copy on a disconnect and requires separate physical decisions before recovery", async () => {
    const h = harness(3, true); await h.start();
    h.printer.printChainPage.mockImplementation(async (_bitmap, index, _total, started) => { started(); if (index === 1) throw new Error("USB unplugged"); });
    await expect(h.controller.runChain(h.printer, h.bitmaps, actor, () => false, () => {})).rejects.toThrow("USB unplugged");
    expect(h.server().outcomes.map(o => o.status)).toEqual(["buffered", "sending", "pending"]);
    expect(h.printer.finishHeldChain).not.toHaveBeenCalled();
    await h.controller.command({ type: "resolve", index: 0, printed: true }, actor);
    expect(() => remainingLabels(h.server())).toThrow("uncertain");
    await h.controller.command({ type: "resolve", index: 1, printed: false }, actor);
    expect(remainingLabels(h.server()).map(l => l.copyId)).toEqual(labels.slice(1).map(l => l.copyId));
  });
  it("archives an unrecoverable pending chain checkpoint and adopts only uncertain server progress, without output", async () => {
    const h = harness(3, true); await h.start(); h.fail("buffer");
    await expect(h.controller.runChain(h.printer, h.bitmaps, actor, () => false, () => {})).rejects.toThrow();
    h.fail(undefined); await h.controller.recoverChainLog(actor);
    expect(h.server().outcomes.map(o => o.status)).toEqual(["sending", "pending", "pending"]);
    expect(h.server().state).toBe("needs-review");
    expect([...h.storage.data.keys()].some(key => key.startsWith("wc-qr-usb-pending-archive-"))).toBe(true);
    expect(h.printer.printChainPage).toHaveBeenCalledTimes(1); expect(h.printer.finishHeldChain).not.toHaveBeenCalled();
  });
  it("rejects stale finish authorization and sends no zero-ink feed", async () => {
    const h = harness(3, true); await h.start(); let stop = false;
    h.printer.printChainPage.mockImplementation(async (_bitmap, _index, _total, started) => { started(); stop = true; });
    const checkpoint = h.api.checkpoint.getMockImplementation()!;
    h.api.checkpoint.mockImplementation(async (id, value) => {
      const response = await checkpoint(id, value);
      return value.command.type === "begin-feed" ? applyPrintCommand(response, { type: "settle-chain" }, actor, at) : response;
    });
    await expect(h.controller.runChain(h.printer, h.bitmaps, actor, () => stop, () => {})).rejects.toThrow("finish checkpoint changed");
    expect(h.printer.finishHeldChain).not.toHaveBeenCalled(); expect(h.printer.printChainPage).toHaveBeenCalledTimes(1);
  });
});

it("rejects a serialized sheet that cannot leave room for durable outcome history", () => {
  const oversized = { ...input(), labels: Array.from({ length: 500 }, (_, i) => ({
    copyId: `${i}-${"\u0001".repeat(390)}`,
    row: { kind: "text", dept: "\u0001".repeat(200), model: "\u0001".repeat(200), number: "\u0001".repeat(200), qrCodeValue: "", copies: 1 },
  })) };
  expect(() => createPrintJobSchema.parse(oversized)).toThrow("too large");
});
