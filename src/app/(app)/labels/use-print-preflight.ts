"use client";
import { useEffect, useState } from "react";
import { LABEL_KINDS } from "@/lib/brother-label-csv";
import { renderBrotherLabel, verifyBrotherQr, type LabelBitmap } from "@/lib/brother-label-render";
import type { PrintLabel } from "@/lib/label-print-job";
export async function preparePrintBitmaps(labels: PrintLabel[], progress: (done: number) => void, stopped: () => boolean) {
  const bitmaps: LabelBitmap[] = [];
  const checked = new Set<string>();
  for (const [index, label] of labels.entries()) {
    if (stopped()) throw new Error("Label preparation stopped. Nothing was sent.");
    const bitmap = await renderBrotherLabel(label.row);
    const key = JSON.stringify(label.row);
    if (LABEL_KINDS[label.row.kind].needsQr && !checked.has(key)) await verifyBrotherQr(bitmap, label.row.qrCodeValue);
    checked.add(key); bitmaps.push(bitmap); progress(index + 1);
    if (index % 8 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return bitmaps;
}
export function usePrintPreflight(labels: PrintLabel[]) {
  const key = JSON.stringify(labels);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; ready: boolean; done: number; issues: Record<string, string> }>({ key: "", ready: false, done: 0, issues: {} });
  useEffect(() => {
    let cancelled = false;
    const snapshot = JSON.parse(key) as PrintLabel[];
    if (!snapshot.length || snapshot.length > 500) { setResult({ key, ready: false, done: 0, issues: {} }); return; }
    const run = async () => {
      const issues: Record<string, string> = {}, checked = new Map<string, string | null>();
      for (const [index, label] of snapshot.entries()) {
        if (cancelled) return;
        const rowKey = JSON.stringify(label.row);
        if (!checked.has(rowKey)) {
          try {
            const bitmap = await renderBrotherLabel(label.row);
            if (LABEL_KINDS[label.row.kind].needsQr) await verifyBrotherQr(bitmap, label.row.qrCodeValue);
            checked.set(rowKey, null);
          } catch (error) { checked.set(rowKey, error instanceof Error ? error.message : "Label could not be prepared."); }
        }
        const issue = checked.get(rowKey);
        if (issue) issues[label.entryId ?? label.copyId] = issue;
        if (!cancelled) setResult({ key, ready: false, done: index + 1, issues: { ...issues } });
        if (index % 8 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      if (!cancelled) setResult({ key, ready: Object.keys(issues).length === 0, done: snapshot.length, issues });
    };
    void run(); return () => { cancelled = true; };
  }, [key, attempt]);
  return { ...(result.key === key ? result : { ready: false, done: 0, issues: {} as Record<string, string> }), retry: () => { setResult({ key: "", ready: false, done: 0, issues: {} }); setAttempt((value) => value + 1); } };
}
