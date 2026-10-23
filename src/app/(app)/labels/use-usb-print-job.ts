"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { BROTHER_USB_LOCK, BrotherUsbPrinter, brotherUsbAccess, chooseBrotherUsb, type BrotherUsbDevice } from "@/lib/brother-usb";
import { LabelPrintController } from "@/lib/label-print-controller";
import { PrintApiError, printJobApi, type PrintHistory } from "@/lib/label-print-client";
import { labelName, remainingLabels, uncertainIndices, type PrintActor, type PrintJob, type PrintLabel } from "@/lib/label-print-job";
import { PRINT_JOURNAL_KEY, LEGACY_PRINT_KEY, archiveUnreadableJournal, printerBrowserId, readPrintJournal, savePrintJournal, type JournalRead, type PrintEnvelope } from "@/lib/label-print-storage";
import { preparePrintBitmaps } from "./use-print-preflight";

async function exclusive(action: () => Promise<void>) {
  if (!navigator.locks) throw new Error("This browser cannot reserve the USB printer.");
  await navigator.locks.request(BROTHER_USB_LOCK, { ifAvailable: true }, async (lock) => {
    if (!lock) throw new Error("Another tab is using the printer. Finish that batch first.");
    await action();
  });
}
export function useUsbPrintJob(actor: PrintActor | null, onCompleted: (label: PrintLabel) => void) {
  const [supported, setSupported] = useState(false), [device, setDevice] = useState<BrotherUsbDevice>();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [messageError, setMessageError] = useState(false);
  const [envelope, setEnvelope] = useState<PrintEnvelope | null>(null);
  const [unreadable, setUnreadable] = useState<Extract<JournalRead, { kind: "unreadable" }> | null>(null);
  const [history, setHistory] = useState<PrintHistory>({ jobs: [], active: null, blockedByOtherOperator: false, nextCursor: null });
  const [historyReady, setHistoryReady] = useState(false), [historyError, setHistoryError] = useState("");
  const refreshGeneration = useRef(0), refreshAbort = useRef<AbortController | null>(null);
  const guard = useRef(false), stop = useRef(false), mirror = useRef<PrintEnvelope | null>(null);
  const announced = useRef(new Set<string>());
  const currentActor = useRef(actor), completedCallback = useRef(onCompleted);
  currentActor.current = actor; completedCallback.current = onCompleted;
  const update = useCallback((value: PrintEnvelope | null) => {
    mirror.current = value; setEnvelope(value);
    if (value && value.job.actor.id === currentActor.current?.id) value.job.labels.forEach((label, i) => {
      const key = `${value.job.actor.id}:${value.job.id}:${label.copyId}`;
      if (value.job.outcomes[i]!.status === "printed" && !announced.current.has(key)) { announced.current.add(key); completedCallback.current(label); }
    });
  }, []);
  const refresh = useCallback(async () => {
    if (guard.current) return;
    const generation = ++refreshGeneration.current, actorId = currentActor.current?.id;
    refreshAbort.current?.abort(); const abort = new AbortController(); refreshAbort.current = abort;
    setHistoryReady(false); setHistoryError("");
    try {
      if (!navigator.locks) {
        const latest = await printJobApi.list(printerBrowserId(localStorage));
        if (generation === refreshGeneration.current && actorId === currentActor.current?.id) { setHistory(latest); setHistoryReady(true); }
        return;
      }
      await navigator.locks.request(BROTHER_USB_LOCK, { signal: abort.signal }, async () => {
        if (guard.current || generation !== refreshGeneration.current) return;
        const browserId = printerBrowserId(localStorage);
        const latest = await printJobApi.list(browserId);
        if (guard.current || generation !== refreshGeneration.current || actorId !== currentActor.current?.id) return;
        // Re-read inside the lock AFTER the network wait; never overwrite an outbox captured earlier.
        const saved = readPrintJournal(localStorage);
        if (saved.kind === "unreadable") setUnreadable(saved); else setUnreadable(null);
        const pendingMirror = mirror.current?.pending ? mirror.current : null;
        // A failed local save may leave the newest acknowledged progress only in
        // memory. A focus/storage refresh must not discard that exact outbox.
        if (pendingMirror && saved.kind === "valid" && (saved.envelope.job.id !== pendingMirror.job.id || saved.envelope.job.revision > pendingMirror.job.revision ||
            (saved.envelope.job.revision === pendingMirror.job.revision && saved.envelope.pending && JSON.stringify(saved.envelope.pending) !== JSON.stringify(pendingMirror.pending)))) throw new Error("A different saved print journal conflicts with this tab's pending log. Keep this tab open and review the pending log first.");
        if (saved.kind === "valid" && !pendingMirror) update(saved.envelope);
        setHistory(latest);
        if (saved.kind !== "unreadable") {
          if (saved.kind === "valid" && saved.envelope.job.browserId !== browserId) throw new Error("The saved journal belongs to a different browser identity. Review its record before printing.");
          if (latest.active && saved.kind === "valid" && saved.envelope.job.id !== latest.active.id && saved.envelope.pending) throw new Error("The local pending log and saved active batch differ. Keep this tab open and reconcile the pending log first.");
          if (latest.active && !pendingMirror && !(saved.kind === "valid" && saved.envelope.pending)) {
            savePrintJournal(localStorage, { job: latest.active }); update({ job: latest.active });
          } else if (!latest.active && !pendingMirror && saved.kind === "missing") update(null);
          else if (!latest.active && !pendingMirror && saved.kind === "valid" && !saved.envelope.pending) {
            const recorded = latest.jobs.find((job) => job.id === saved.envelope.job.id) ?? await printJobApi.get(saved.envelope.job.id);
            if (generation !== refreshGeneration.current || actorId !== currentActor.current?.id) return;
            if (recorded?.state === "reviewed") { localStorage.removeItem(PRINT_JOURNAL_KEY); update(null); }
          }
        }
        setHistoryReady(true);
      });
    } catch (error) { if (!abort.signal.aborted && generation === refreshGeneration.current) setHistoryError(error instanceof Error ? error.message : "Print history is unavailable. Printing is paused."); }
  }, [update]);

  useEffect(() => {
    setHistory({ jobs: [], active: null, blockedByOtherOperator: false, nextCursor: null });
    setHistoryReady(false); setDevice(undefined);
    setSupported(Boolean(brotherUsbAccess() && navigator.locks && window.isSecureContext));
    void refresh();
    const storage = (event: StorageEvent) => { if ([PRINT_JOURNAL_KEY, LEGACY_PRINT_KEY, null].includes(event.key)) void refresh(); };
    const focus = () => { void refresh(); };
    const usb = brotherUsbAccess(), disconnect = () => { setDevice(undefined); };
    const unload = (event: BeforeUnloadEvent) => { if (guard.current || mirror.current?.pending) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("storage", storage); window.addEventListener("focus", focus); window.addEventListener("beforeunload", unload); usb?.addEventListener("disconnect", disconnect);
    return () => { stop.current = true; refreshAbort.current?.abort(); window.removeEventListener("storage", storage); window.removeEventListener("focus", focus); window.removeEventListener("beforeunload", unload); usb?.removeEventListener("disconnect", disconnect); };
  }, [refresh, actor?.id]);
  useEffect(() => {
    for (const job of history.jobs) if (job.actor.id === currentActor.current?.id) job.labels.forEach((label, i) => {
      const key = `${job.actor.id}:${job.id}:${label.copyId}`;
      if (job.outcomes[i]!.status === "printed" && !announced.current.has(key)) { announced.current.add(key); completedCallback.current(label); }
    });
  }, [history.jobs, actor?.id]);
  const action = async (run: () => Promise<void>) => {
    if (guard.current) return;
    guard.current = true; stop.current = false; setBusy(true); setMessage(""); setMessageError(false);
    try { await run(); }
    catch (error) { setMessageError(true); setMessage(error instanceof DOMException && error.name === "NotFoundError" ? "No printer selected. Connect when ready." : error instanceof Error ? error.message : "The printer stopped."); }
    finally { guard.current = false; setBusy(false); }
  };
  const controller = () => new LabelPrintController(localStorage, printJobApi, mirror.current, (value) => update(value));
  const checkCurrent = async () => {
    const saved = readPrintJournal(localStorage);
    if (saved.kind === "unreadable") { setUnreadable(saved); throw new Error(saved.message); }
    if (saved.kind === "valid" && (saved.envelope.job.id !== mirror.current?.job.id || saved.envelope.job.revision > mirror.current.job.revision)) {
      update(saved.envelope); throw new Error("The batch changed in another tab. Review the latest progress first.");
    }
    const latest = await printJobApi.list(printerBrowserId(localStorage)); setHistory(latest);
    if (latest.active && mirror.current && latest.active.id !== mirror.current.job.id) throw new Error("A different batch is active. Reload print history before continuing.");
    if (latest.blockedByOtherOperator) throw new Error("Another person's batch needs review on this browser. Ask that person or staff to review it.");
    return latest;
  };
  const connect = () => action(async () => {
    const chosen = await chooseBrotherUsb(); // Keep chooser inside the user gesture.
    await exclusive(async () => {
      const latest = await checkCurrent();
      if ((latest.active && uncertainIndices(latest.active).length > 0) || mirror.current?.pending) throw new Error("Review the uncertain label or save its pending log before reconnecting.");
      const printer = new BrotherUsbPrinter(chosen);
      try { await printer.open(); await printer.checkReady(); } finally { await printer.close(); }
    });
    setDevice(chosen); setMessage("Ready · 12 mm white-on-black tape");
  });
  const print = (labels: PrintLabel[], parent?: PrintJob) => action(async () => {
    if (!device || !currentActor.current) throw new Error("Connect the printer and sign in before printing.");
    const operator = { ...currentActor.current }, snapshot = structuredClone(labels);
    setMessage(`Checking ${snapshot.length} labels…`);
    const bitmaps = await preparePrintBitmaps(snapshot, (done) => setMessage(`Preparing ${done} of ${snapshot.length} labels…`), () => stop.current);
    await exclusive(async () => {
      const latest = await checkCurrent();
      if (stop.current) return;
      if (latest.active && (!parent || latest.active.id !== parent.id || latest.active.revision !== parent.revision)) throw new Error("An earlier batch needs review. Nothing was printed.");
      if (mirror.current?.pending) throw new Error("Save the pending print log first.");
      if (currentActor.current?.id !== operator.id) throw new Error("The signed-in account changed. Start again after reviewing the sheet.");
      const printer = new BrotherUsbPrinter(device), jobController = controller();
      const job = await jobController.start({ transport: "sdk-chain-v1", id: crypto.randomUUID(), browserId: printerBrowserId(localStorage), labels: snapshot, ...(parent ? { parentId: parent.id, parentRevision: parent.revision } : {}) }, operator);
      await jobController.runChain(printer, bitmaps, operator, () => stop.current || currentActor.current?.id !== operator.id,
        (i) => setMessage(`Printing ${i + 1} of ${job.labels.length} · ${labelName(job.labels[i]!)}`));
      setMessage("");
    });
    const latest = await printJobApi.list(printerBrowserId(localStorage)); setHistory(latest);
  });
  const command = (input: Parameters<LabelPrintController["command"]>[0]) => action(() => exclusive(async () => {
    if (!currentActor.current) throw new Error("Sign in to review the print batch.");
    await checkCurrent(); const next = await controller().command(input, currentActor.current);
    if (next.state === "reviewed") { localStorage.removeItem(PRINT_JOURNAL_KEY); update(null); }
    setHistory(await printJobApi.list(printerBrowserId(localStorage)));
  }));
  const adoptReviewedOutbox = async () => {
    const current = mirror.current;
    if (!current?.pending) return false;
    let recorded: PrintJob;
    try { recorded = await printJobApi.get(current.job.id); }
    catch (error) { if (error instanceof PrintApiError && error.status === 404 && current.pending.type === "create") return false; throw error; }
    if (recorded.state !== "reviewed") return false;
    const raw = localStorage.getItem(PRINT_JOURNAL_KEY), durable = readPrintJournal(localStorage);
    if (durable.kind !== "valid" || durable.envelope.job.id !== current.job.id || durable.envelope.job.revision > current.job.revision) throw new Error("The saved journal changed. Reload history.");
    localStorage.setItem(`wc-qr-usb-pending-archive-${crypto.randomUUID()}`, JSON.stringify({ archivedAt: new Date().toISOString(), raw, recordedRevision: recorded.revision }));
    const latest = await printJobApi.list(printerBrowserId(localStorage));
    if (latest.active) { savePrintJournal(localStorage, { job: latest.active }); update({ job: latest.active }); }
    else { localStorage.removeItem(PRINT_JOURNAL_KEY); update(null); }
    setHistory(latest); setHistoryError(""); setHistoryReady(true); setMessage("The earlier batch was already reviewed. Its pending record was archived; no labels were sent.");
    return true;
  };
  const sync = () => action(() => exclusive(async () => {
    if (await adoptReviewedOutbox()) return;
    const latest = await checkCurrent();
    if (latest.active && latest.active.id !== mirror.current?.job.id) throw new Error("A different batch is active. Reload print history before saving this log.");
    const saved = await controller().sync();
    if (saved.state === "reviewed") { localStorage.removeItem(PRINT_JOURNAL_KEY); update(null); }
    setHistory(await printJobApi.list(printerBrowserId(localStorage))); setMessage("Pending print log saved. No labels were sent.");
  }));
  const reconcile = (printed: boolean) => action(() => exclusive(async () => {
    if (!currentActor.current) throw new Error("Sign in to review this batch.");
    if (await adoptReviewedOutbox()) return;
    await checkCurrent(); await controller().reconcilePending(currentActor.current, printed);
    setHistory(await printJobApi.list(printerBrowserId(localStorage)));
  }));
  const recoverChain = () => action(() => exclusive(async () => {
    if (!currentActor.current) throw new Error("Sign in to review this batch.");
    if (await adoptReviewedOutbox()) return;
    await checkCurrent(); await controller().recoverChainLog(currentActor.current);
    setHistory(await printJobApi.list(printerBrowserId(localStorage)));
    setMessage("Saved progress recovered. Check each uncertain label; no print or feed was sent.");
  }));
  const adopt = () => action(() => exclusive(async () => {
    if (await adoptReviewedOutbox()) return;
    const latest = await checkCurrent();
    const jobController = controller();
    try { const saved = await jobController.adoptRecordedCreation(); if (saved.state === "reviewed") { localStorage.removeItem(PRINT_JOURNAL_KEY); update(null); } }
    catch (error) {
      if (!(error instanceof PrintApiError) || error.status !== 404 || latest.active) throw error;
      jobController.archiveUnrecordedCreation(); update(null); setMessage("Unrecorded batch archived after review. No labels were sent.");
    }
    setHistory(await printJobApi.list(printerBrowserId(localStorage)));
  }));
  const archive = () => action(() => exclusive(async () => {
    if (!unreadable) return;
    archiveUnreadableJournal(localStorage, unreadable); setUnreadable(null); update(null);
  })).then(() => refresh());
  const loadMore = () => action(async () => {
    const cursor = history.nextCursor, generation = refreshGeneration.current, operator = currentActor.current?.id;
    if (!cursor) return;
    const next = await printJobApi.list(printerBrowserId(localStorage), cursor);
    if (operator !== currentActor.current?.id || generation !== refreshGeneration.current) return;
    setHistory((previous) => previous.nextCursor !== cursor ? previous : ({ ...previous,
      jobs: [...previous.jobs, ...next.jobs], nextCursor: next.nextCursor }));
  });
  return { supported, device, busy, message, messageError, envelope, unreadable, history, historyReady, historyError,
    connect, print, command, sync, reconcile, recoverChain, adopt, archive, refresh, loadMore,
    stop: () => { stop.current = true; setMessage("Stopping after the current label and releasing held labels…"); },
    continueRemaining: () => { const parent = mirror.current?.job; return parent ? print(remainingLabels(parent), parent) : Promise.resolve(); } };
}
