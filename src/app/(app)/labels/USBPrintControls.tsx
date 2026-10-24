"use client";
import { Check, CircleAlert, History, Loader2, Printer, Usb } from "lucide-react";
import { useCurrentUser } from "@/hooks/use-current-user";
import { Button } from "@/components/ui/button";
import { labelName, printedLabels, remainingLabels, uncertainIndices, type PrintJob, type PrintLabel } from "@/lib/label-print-job";
import { useUsbPrintJob } from "./use-usb-print-job";
const time = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
function BatchDetails({ job }: { job: PrintJob }) {
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(job, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `label-print-${job.id}.json`; link.click();
    // Revoking in the same tick can cancel the download in Safari and Firefox.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <><ol className="mt-2 max-h-52 list-decimal space-y-2 overflow-auto pl-5">{job.labels.map((label, i) => {
    const outcome = job.outcomes[i]!;
    return <li key={label.copyId}><span className="font-medium">{labelName(label)}</span><span className="block text-muted-foreground">{outcome.status === "printed" ? `${outcome.evidence === "printer" ? "Printer completed" : `Confirmed printed by ${outcome.resolvedBy?.name}`} · ${time(outcome.recordedAt!)}` : outcome.status === "buffered" ? "Received by printer · final feed not confirmed" : outcome.status === "sending" ? "Output uncertain · check the physical label" : outcome.status === "not-printed" ? `${outcome.evidence === "not-sent" ? "Not sent" : "Confirmed not printed"} · ${time(outcome.recordedAt!)}` : "Not sent"}</span>{label.row.qrCodeValue && <span className="block break-all font-mono text-[11px] text-muted-foreground">QR: {label.row.qrCodeValue}</span>}</li>;
  })}</ol><Button variant="outline" size="sm" className="mt-3 h-10" onClick={download}>Download batch receipt</Button></>;
}
export function USBPrintControls({ labels, total, blocked, onCompleted }: { labels: PrintLabel[]; total: number; blocked: boolean; onCompleted: (label: PrintLabel) => void }) {
  const { data: me } = useCurrentUser();
  const operator = me && !me.preview ? { id: me.id, name: me.name } : null;
  const print = useUsbPrintJob(operator, onCompleted);
  const savedJob = print.envelope?.job;
  const job = savedJob && me && (savedJob.actor.id === me.id || ["ADMIN", "STAFF"].includes(me.role)) ? savedJob : undefined;
  const unknown = job ? uncertainIndices(job) : [];
  const uncertain = unknown.length > 0;
  const reviewIndex = unknown[0];
  const held = job?.outcomes.filter(o => o.status === "buffered").length ?? 0;
  const remaining = job && !uncertain ? remainingLabels(job) : [];
  const canReview = job && me && (me.id === job.actor.id || ["ADMIN", "STAFF"].includes(me.role)) && !me.preview;
  const historyJobs = print.history.jobs.filter((entry) => me && (["ADMIN", "STAFF"].includes(me.role) || entry.actor.id === me.id));
  const pendingCommand = print.envelope?.pending?.type === "checkpoint" ? print.envelope.pending.input.command : null;
  const canReconcile = !job?.transport && pendingCommand && ["begin", "complete", "cancel-unsent"].includes(pendingCommand.type);
  const inactive = !print.supported || !operator || !print.historyReady || Boolean(print.historyError || print.unreadable || print.history.blockedByOtherOperator);
  return <div className="flex flex-col gap-3 rounded-lg border border-border bg-background p-3">
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0 text-xs"><div className="font-bold">Brother PT-D610BT</div><div className="mt-0.5 text-muted-foreground">12 mm white-on-black tape</div></div>
      <Button variant="outline" size="sm" className="h-10 shrink-0" disabled={inactive || print.busy || uncertain || Boolean(print.envelope?.pending)} onClick={() => void print.connect()}><Usb className="size-4" />{print.device ? "Reconnect" : "Connect USB"}</Button>
    </div>
    {!print.supported && <p className="text-xs text-muted-foreground">Open this helper in Chrome or Edge on a computer for USB printing.</p>}
    <p className="text-xs text-muted-foreground">Gotham XNarrow Bold · Medium Small QR</p>
    <p className="text-xs text-muted-foreground">Labels share one tape feed to reduce waste. One initial blank is normal; stopping early adds a small blank to release the last label.</p>
    {operator && <p className="text-xs text-muted-foreground">Printing as <span className="font-medium text-foreground">{operator.name}</span></p>}
    {!operator && <p className="text-xs text-destructive">Sign in with your own account to record who prints these labels.</p>}
    <Button className="h-11 w-full font-bold" disabled={inactive || !print.device || print.busy || blocked || Boolean(savedJob) || !labels.length || total > 500} onClick={() => void print.print(labels)}>
      {print.busy ? <Loader2 className="size-4 animate-spin" /> : <Printer className="size-4" />}{print.busy ? "Printer in use…" : `Print ${total.toLocaleString()} ${total === 1 ? "label" : "labels"}`}
    </Button>
    {total > 500 && <p role="status" className="text-xs text-destructive">Print up to 500 labels in one USB batch. Reduce the sheet first.</p>}
    {print.busy && <Button variant="outline" className="h-10" onClick={print.stop}>Stop and release labels</Button>}
    {print.message && print.message !== job?.error && <p role="status" className={`text-xs ${print.messageError ? "text-destructive" : "text-muted-foreground"}`}>{print.message}</p>}
    {print.historyError && <div role="alert" className="text-xs text-destructive">{print.historyError}<Button variant="outline" size="sm" className="mt-2 h-10 w-full" disabled={print.busy} onClick={() => void print.refresh()}>Reload print history</Button></div>}
    {print.history.blockedByOtherOperator && <p role="alert" className="text-xs text-destructive">Another person has an unfinished batch on this browser. Ask them or staff to review it before printing.</p>}
    {print.unreadable && <div role="alert" className="rounded-lg border border-destructive/40 p-3 text-xs"><p>{print.unreadable.message}</p>{print.unreadable.raw !== undefined && <>{me && ["ADMIN", "STAFF"].includes(me.role) && <details className="mt-2"><summary className="cursor-pointer py-1">Inspect original record</summary><pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all">{print.unreadable.raw}</pre></details>}<Button variant="outline" className="mt-2 h-auto min-h-10 w-full whitespace-normal" disabled={print.busy} onClick={() => void print.archive()}>I checked the printer · Archive old record</Button></>}</div>}
    {job && <div aria-label="Current print batch" className="rounded-lg border border-border p-3 text-xs">
      <div role="status" className="flex items-center gap-1.5 font-bold">{print.busy ? <Loader2 className="size-4 animate-spin" /> : uncertain || print.envelope?.pending ? <CircleAlert className="size-4 text-destructive" /> : <Check className="size-4 text-emerald-600 dark:text-emerald-400" />}{printedLabels(job).length} of {job.labels.length} labels completed</div>
      <p className="mt-1 text-muted-foreground">{job.actor.name} · Started {time(job.createdAt)}</p>
      {uncertain && print.busy ? <p className="mt-2 text-muted-foreground">{held > 0 && `${held} received; waiting for the final feed. `}{job.activeIndex !== null ? `Sending label ${job.activeIndex + 1}…` : "Finishing the tape feed…"}</p> : uncertain ? <p className="mt-2 text-destructive">{unknown.length} {unknown.length === 1 ? "label needs" : "labels need"} physical review. Check label {reviewIndex! + 1}: {labelName(job.labels[reviewIndex!]!)}. Check the printer for a held label before recording its outcome. Nothing prints or feeds automatically.</p> : job.state === "completed" ? <p className="mt-2">Check the labels and scan a QR before applying them.</p> : <p className="mt-2">{remaining.length} remaining {remaining.length === 1 ? "label" : "labels"}. Confirmed completed copies will be excluded when you continue.</p>}
      {job.error && <p className="mt-1 text-destructive">{job.error}</p>}
      <details className="mt-2"><summary className="cursor-pointer py-1">Review this batch</summary><BatchDetails job={job} /></details>
      {!print.busy && canReview && <div className="mt-3 flex flex-col gap-2">
        {print.envelope?.pending ? <><p className="text-destructive">Print logging is incomplete. Save this exact pending log before continuing.</p><Button variant="outline" className="h-10" onClick={() => void print.sync()}>Save pending log · No printing</Button>{job.transport && pendingCommand && !["reconcile", "recover-chain", "review"].includes(pendingCommand.type) && <Button variant="outline" className="h-auto min-h-10 whitespace-normal" onClick={() => void print.recoverChain()}>Recover saved progress for physical review · No printing</Button>}{canReconcile && <><p className="text-muted-foreground">If that log cannot be saved, check the physical label and record its actual outcome. The original pending record is retained.</p><Button variant="outline" className="h-auto min-h-10 whitespace-normal" onClick={() => void print.reconcile(true)}>I checked · This pending label printed correctly</Button><Button variant="outline" className="h-auto min-h-10 whitespace-normal" onClick={() => void print.reconcile(false)}>I checked · This pending label did not print correctly</Button></>}{print.envelope?.pending?.type === "create" && <Button variant="outline" className="h-10" onClick={() => void print.adopt()}>I checked the printer · Recover unstarted batch</Button>}</> : uncertain ? <><Button variant="outline" className="h-10" onClick={() => void print.command({ type: "resolve", index: reviewIndex!, printed: true })}>Label {reviewIndex! + 1} printed correctly</Button><Button variant="outline" className="h-10" onClick={() => void print.command({ type: "resolve", index: reviewIndex!, printed: false })}>Label {reviewIndex! + 1} did not print correctly</Button></> : <>
          {remaining.length > 0 && <Button className="h-10" disabled={inactive || !print.device} onClick={() => void print.continueRemaining()}>Continue {remaining.length} remaining {remaining.length === 1 ? "label" : "labels"}</Button>}
          <Button variant="outline" className="h-10" onClick={() => void print.command({ type: "review" })}>{remaining.length ? "Finish batch without printing the rest" : "Labels checked · Finish batch"}</Button>
        </>}
      </div>}
      {!canReview && <p className="mt-2 text-muted-foreground">Sign in as the original operator or staff to review this batch.</p>}
    </div>}
    <details className="border-t border-border pt-2 text-xs"><summary className="flex cursor-pointer items-center gap-2 py-2 font-medium"><History className="size-4" />Print history{historyJobs.length ? ` · ${historyJobs.length}` : ""}</summary>
      <p className="mb-2 text-muted-foreground">Operator, exact labels and completion times. Physical application is confirmed separately.</p>
      {!print.historyReady && !print.historyError && <p className="py-2 text-muted-foreground">Loading history…</p>}
      {print.historyReady && !historyJobs.length && <p className="py-2 text-muted-foreground">No print batches yet.</p>}
      <ul className="max-h-80 divide-y divide-border overflow-auto">{historyJobs.map((entry) => <li key={entry.id} className="py-3"><details><summary className="cursor-pointer"><span className="font-bold">{entry.actor.name}</span> · {printedLabels(entry).length}/{entry.labels.length} completed<span className="mt-0.5 block text-muted-foreground">{time(entry.createdAt)} · {entry.state === "reviewed" ? "Reviewed" : uncertainIndices(entry).length > 0 ? "Needs review" : entry.state === "completed" ? "Completed" : "Open batch"}</span></summary><BatchDetails job={entry} />{entry.parentId && <p className="mt-2 text-muted-foreground">Continued from batch {entry.parentId.slice(0, 8)}</p>}<p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">Batch {entry.id}</p></details></li>)}</ul>
      {print.history.nextCursor && <Button variant="outline" className="mt-2 h-10 w-full" disabled={print.busy} onClick={() => void print.loadMore()}>Load earlier batches</Button>}
    </details>
  </div>;
}
