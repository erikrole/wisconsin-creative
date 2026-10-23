import { applyPrintCommand, newPrintJob, type CreatePrintJob, type PrintActor, type PrintCommand, type PrintJob } from "./label-print-job";
import { PRINT_JOURNAL_KEY, readPrintJournal, savePrintJournal, type PrintEnvelope } from "./label-print-storage";
import type { PrintJobApi } from "./label-print-client";
import type { LabelBitmap } from "./brother-label-render";
import type { BrotherUsbPrinter } from "./brother-usb";

export class PrintPersistenceError extends Error {}
/** Coordinates the local write-ahead journal with authenticated server checkpoints.
 * Device bytes are never replayed by log reconciliation. The caller holds the Web Lock. */
export class LabelPrintController {
  envelope: PrintEnvelope | null;
  private expectedRaw: string | null;
  constructor(private storage: Storage, private api: PrintJobApi, envelope: PrintEnvelope | null,
    private changed: (envelope: PrintEnvelope) => void) {
    this.envelope = envelope;
    this.expectedRaw = storage.getItem(PRINT_JOURNAL_KEY);
    const durable = readPrintJournal(storage);
    if (durable.kind === "unreadable" || (durable.kind === "valid" && (!envelope || durable.envelope.job.id !== envelope.job.id || durable.envelope.job.revision > envelope.job.revision ||
      (durable.envelope.pending?.type === "checkpoint" && envelope.pending?.type === "checkpoint" && durable.envelope.job.revision === envelope.job.revision && durable.envelope.pending.input.requestId !== envelope.pending.input.requestId)))) {
      throw new PrintPersistenceError("The saved print journal changed. Reload the current batch before saving or printing.");
    }
  }
  private save(envelope: PrintEnvelope) {
    // Keep acknowledged physical progress visible even when durable storage fails.
    this.envelope = envelope; this.changed(envelope);
    try {
      if (this.storage.getItem(PRINT_JOURNAL_KEY) !== this.expectedRaw) throw new Error("The saved print journal changed in another tab.");
      savePrintJournal(this.storage, envelope);
      this.expectedRaw = this.storage.getItem(PRINT_JOURNAL_KEY);
    }
    catch { throw new PrintPersistenceError("The print journal could not save. Printing stopped; known completed labels are still shown. Restore storage, then save the pending log."); }
  }
  async sync(): Promise<PrintJob> {
    const envelope = this.envelope;
    if (!envelope) throw new Error("There is no print batch to recover.");
    this.save(envelope); // Re-establish durable outbox before a server write.
    if (!envelope.pending) return envelope.job;
    let response: PrintJob;
    try { response = envelope.pending.type === "create" ? await this.api.create(envelope.pending.input) : await this.api.checkpoint(envelope.job.id, envelope.pending.input); }
    catch (error) {
      if (envelope.pending.type !== "checkpoint") throw error;
      // An older committed request may have been followed by a review in another tab.
      // Reconcile its observable result; never replay device output or discard known progress.
      const command = envelope.pending.input.command;
      if (["begin", "begin-feed"].includes(command.type)) throw error; // A later outcome never authorizes device output.
      const saved = await this.api.get(envelope.job.id);
      const outcome = "index" in command ? saved.outcomes[command.index] : undefined;
      const satisfied = command.type === "buffer" ? ["buffered", "printed"].includes(outcome?.status ?? "")
        : command.type === "settle-chain" ? saved.finish?.state === "completed"
        : command.type === "recover-chain" ? ["needs-review", "stopped", "completed", "reviewed"].includes(saved.state)
        : command.type === "complete" ? outcome?.status === "printed"
        : command.type === "resolve" ? outcome?.status === (command.printed ? "printed" : "not-printed")
        : command.type === "review" ? saved.state === "reviewed"
        : command.type === "halt" ? ["stopped", "completed", "reviewed", "needs-review"].includes(saved.state)
        : command.type === "cancel-unsent" ? outcome?.status === "not-printed"
        : outcome && outcome.status !== "pending";
      if (!satisfied || saved.revision <= envelope.pending.input.revision) throw error;
      response = saved;
    }
    if (response.transport !== envelope.job.transport || response.id !== envelope.job.id || response.browserId !== envelope.job.browserId || JSON.stringify(response.labels) !== JSON.stringify(envelope.job.labels)) throw new Error("The saved batch identity changed. Reload history and review it.");
    this.save({ job: response }); return response;
  }
  async start(input: CreatePrintJob, actor: PrintActor) {
    this.save({ job: newPrintJob(input, actor, new Date().toISOString()), pending: { type: "create", input } });
    return this.sync();
  }
  async command(command: PrintCommand, actor: PrintActor) {
    const current = this.envelope;
    if (!current || current.pending) throw new Error("Save the pending print log before changing this batch.");
    const input = { requestId: crypto.randomUUID(), revision: current.job.revision, command };
    this.save({ job: applyPrintCommand(current.job, command, actor, new Date().toISOString()), pending: { type: "checkpoint", input } });
    return this.sync();
  }
  async reconcilePending(actor: PrintActor, printed: boolean) {
    const envelope = this.envelope;
    if (!envelope?.pending || envelope.pending.type !== "checkpoint" || (envelope.pending.input.command.type === "reconcile" || envelope.pending.input.command.type === "recover-chain")) throw new Error("Save the pending log or review the saved server batch.");
    const originalCommand = envelope.pending.input.command;
    const original = { ...envelope.pending.input, command: originalCommand }, saved = await this.api.get(envelope.job.id);
    this.storage.setItem(`wc-qr-usb-pending-archive-${crypto.randomUUID()}`, JSON.stringify({ archivedAt: new Date().toISOString(), envelope }));
    if (saved.state === "reviewed") { this.save({ job: saved }); return saved; }
    const command = { type: "reconcile" as const, original, printed };
    const input = { requestId: crypto.randomUUID(), revision: saved.revision, command };
    this.save({ job: applyPrintCommand(saved, command, actor, new Date().toISOString()), pending: { type: "checkpoint", input } });
    return this.sync();
  }
  async recoverChainLog(actor: PrintActor) {
    const envelope = this.envelope;
    if (!envelope?.job.transport || envelope.pending?.type !== "checkpoint" || ["reconcile", "recover-chain"].includes(envelope.pending.input.command.type)) throw new Error("Save the pending log before reviewing this batch.");
    const original = envelope.pending.input as { requestId: string; revision: number; command: Exclude<PrintCommand, { type: "reconcile" | "recover-chain" }> };
    const saved = await this.api.get(envelope.job.id);
    if (saved.transport !== envelope.job.transport || saved.browserId !== envelope.job.browserId || JSON.stringify(saved.labels) !== JSON.stringify(envelope.job.labels)) throw new Error("The saved batch identity changed.");
    this.storage.setItem(`wc-qr-usb-pending-archive-${crypto.randomUUID()}`, JSON.stringify({ archivedAt: new Date().toISOString(), envelope }));
    if (saved.state === "reviewed") { this.save({ job: saved }); return saved; }
    const command = { type: "recover-chain" as const, original };
    const input = { requestId: crypto.randomUUID(), revision: saved.revision, command };
    this.save({ job: applyPrintCommand(saved, command, actor, new Date().toISOString()), pending: { type: "checkpoint", input } });
    return this.sync();
  }
  async adoptRecordedCreation() {
    const envelope = this.envelope;
    if (envelope?.pending?.type !== "create") throw new Error("There is no pending batch creation.");
    const saved = await this.api.get(envelope.job.id);
    if (saved.browserId !== envelope.job.browserId || JSON.stringify(saved.labels) !== JSON.stringify(envelope.job.labels)) throw new Error("The recorded batch differs. Keep the original journal for review.");
    this.storage.setItem(`wc-qr-usb-pending-archive-${crypto.randomUUID()}`, JSON.stringify({ archivedAt: new Date().toISOString(), envelope }));
    this.save({ job: saved }); return saved;
  }
  archiveUnrecordedCreation() {
    const envelope = this.envelope;
    if (envelope?.pending?.type !== "create" || this.storage.getItem(PRINT_JOURNAL_KEY) !== this.expectedRaw) throw new Error("The pending creation changed. Reload before reviewing it.");
    this.storage.setItem(`wc-qr-usb-pending-archive-${crypto.randomUUID()}`, JSON.stringify({ archivedAt: new Date().toISOString(), envelope }));
    this.storage.removeItem(PRINT_JOURNAL_KEY); this.envelope = null; this.expectedRaw = null;
  }
  async runChain(printer: Pick<BrotherUsbPrinter, "open" | "close" | "printChainPage" | "finishHeldChain" | "endChain">, bitmaps: LabelBitmap[], actor: PrintActor,
    shouldStop: () => boolean, progress: (index: number) => void) {
    const initial = this.envelope?.job;
    if (!initial?.transport || this.envelope?.pending || initial.state !== "ready" || initial.outcomes.some(o => o.status !== "pending") || bitmaps.length !== initial.labels.length) throw new Error("A new complete batch must be prepared and saved before printing.");
    let mainError: unknown, started = false;
    try {
      await printer.open();
      for (let i = 0; i < initial.labels.length && !shouldStop(); i++) {
        const expectedRevision = this.envelope!.job.revision + 1;
        const begun = await this.command({ type: "begin", index: i }, actor);
        if (begun.revision !== expectedRevision || begun.state !== "printing" || begun.activeIndex !== i || begun.outcomes[i]?.status !== "sending") throw new Error("This label no longer has the active print checkpoint. No device output was sent.");
        started = false;
        if (shouldStop()) { await this.command({ type: "cancel-unsent", index: i }, actor); break; }
        progress(i);
        await printer.printChainPage(bitmaps[i]!, i, initial.labels.length, () => {
          if (shouldStop()) throw new Error("Stopped before sending this label.");
          started = true;
        });
        if (i === initial.labels.length - 1) {
          await printer.endChain();
          await this.command({ type: "settle-chain" }, actor);
        } else await this.command({ type: "buffer", index: i }, actor);
      }
      if (this.envelope!.job.outcomes.some(o => o.status === "buffered")) {
        const expectedRevision = this.envelope!.job.revision + 1;
        const finish = await this.command({ type: "begin-feed" }, actor);
        if (finish.revision !== expectedRevision || finish.state !== "needs-review" || finish.finish?.kind !== "stop-feed" || finish.finish.state !== "intent" || finish.activeIndex !== null) throw new Error("The held-label finish checkpoint changed. No feed was sent.");
        // This is the only Stop feed. Errors/storage failures never enter here.
        await printer.finishHeldChain(initial.labels.length);
        await this.command({ type: "settle-chain" }, actor);
      } else if (this.envelope!.job.state === "ready") await this.command({ type: "halt" }, actor);
    } catch (error) {
      mainError = error;
      if (!(error instanceof PrintPersistenceError) && this.envelope && !this.envelope.pending) {
        try {
          if (!started && this.envelope.job.activeIndex !== null) await this.command({ type: "cancel-unsent", index: this.envelope.job.activeIndex }, actor);
          await this.command({ type: "halt", error: error instanceof Error ? error.message.slice(0, 2000) : "Printing stopped." }, actor);
        } catch (logError) { throw new Error(`${error instanceof Error ? error.message : "Printing stopped."} ${logError instanceof Error ? logError.message : "The print log also needs recovery."}`); }
      }
      throw error;
    } finally {
      try { await printer.close(); }
      catch (error) { throw new Error(`${mainError instanceof Error ? `${mainError.message} ` : ""}USB cleanup failed: ${error instanceof Error ? error.message : "Reconnect the cable before printing again."}`); }
    }
  }
  async run(printer: Pick<BrotherUsbPrinter, "open" | "close" | "print">, bitmaps: LabelBitmap[], actor: PrintActor,
    shouldStop: () => boolean, progress: (index: number) => void) {
    const initial = this.envelope?.job;
    if (!initial || initial.transport || this.envelope?.pending || initial.state !== "ready" || bitmaps.length !== initial.labels.length) throw new Error("The complete batch must be prepared and saved before printing.");
    let mainError: unknown;
    let started = false;
    try {
      await printer.open();
      for (let i = 0; i < initial.labels.length && !shouldStop(); i++) {
        const expectedRevision = this.envelope!.job.revision + 1;
        const begun = await this.command({ type: "begin", index: i }, actor);
        if (begun.revision !== expectedRevision || begun.state !== "printing" || begun.activeIndex !== i || begun.outcomes[i]?.status !== "sending") throw new Error("This label no longer has the active print checkpoint. No device output was sent.");
        // A stop during the durable checkpoint has sent no bytes for this label.
        if (shouldStop()) {
          await this.command({ type: "cancel-unsent", index: i }, actor);
          break;
        }
        progress(i);
        started = false;
        await printer.print(bitmaps[i]!, () => {
          if (shouldStop()) throw new Error("Stopped before sending this label.");
          started = true;
        });
        await this.command({ type: "complete", index: i }, actor);
      }
      if (this.envelope?.job.state === "ready") await this.command({ type: "halt" }, actor);
    } catch (error) {
      mainError = error;
      if (!(error instanceof PrintPersistenceError) && this.envelope && !this.envelope.pending) {
        try {
          if (!started && this.envelope.job.activeIndex !== null) await this.command({ type: "cancel-unsent", index: this.envelope.job.activeIndex }, actor);
          await this.command({ type: "halt", error: error instanceof Error ? error.message.slice(0, 2000) : "Printing stopped." }, actor); }
        catch (logError) { throw new Error(`${error instanceof Error ? error.message : "Printing stopped."} ${logError instanceof Error ? logError.message : "The print log also needs recovery."}`); }
      }
      throw error;
    } finally {
      try { await printer.close(); }
      catch (error) { throw new Error(`${mainError instanceof Error ? `${mainError.message} ` : ""}USB cleanup failed: ${error instanceof Error ? error.message : "Reconnect the cable before printing again."}`); }
    }
  }
}
