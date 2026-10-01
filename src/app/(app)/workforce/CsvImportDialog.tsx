"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { handleAuthRedirect, parseJsonSafely } from "@/lib/errors";
import { messageOf } from "./hiring/types";

type Report = {
  applied: boolean;
  counts: Record<string, number>;
  unmappedHeaders?: string[];
  invalid?: { line: number; name: string; reason: string }[];
  rows: { line: number; name: string; action: string; reason?: string; warnings: string[] }[];
};

const COUNT_LABELS: Record<string, string> = {
  create: "New people",
  attach: "Known people, new application",
  skip_existing: "Already imported",
  needs_review: "Need a decision",
  duplicate_in_file: "Duplicate rows",
  invalid: "Invalid rows",
  updated: "People updated",
  noChange: "Nothing to add",
  unmatched: "No matching account",
  startTerms: "Start terms to set",
  placements: "Term placements to add",
  skippedRows: "Header and blank rows",
};

/**
 * Preview-then-apply CSV import. The first call is always a dry run; nothing is
 * written until the admin reviews the report and presses Apply.
 */
export default function CsvImportDialog({
  open,
  onOpenChange,
  title,
  description,
  endpoint,
  extraPayload,
  extraControls,
  onApplied,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  endpoint: string;
  extraPayload: Record<string, unknown>;
  extraControls?: React.ReactNode;
  onApplied: () => void;
}) {
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The reviewed preview is only valid for the options it was run with. If an option
  // changes (Fall year, blank-decision rule), drop the report so Apply cannot write a
  // different plan than the one that was reviewed.
  const optionsKey = JSON.stringify(extraPayload);
  const previewedWith = useRef<string | null>(null);
  useEffect(() => {
    if (previewedWith.current !== null && previewedWith.current !== optionsKey) {
      setReport(null);
      previewedWith.current = null;
    }
  }, [optionsKey]);

  async function run(apply: boolean) {
    if (!csv) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...extraPayload, csv, apply }),
      });
      if (handleAuthRedirect(res)) return;
      const json = await parseJsonSafely<{ data?: Report }>(res);
      if (!res.ok || !json?.data) throw new Error(messageOf(json, "The import could not be processed."));
      setReport(json.data);
      previewedWith.current = optionsKey;
      if (apply) {
        toast.success("Import applied");
        onApplied();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "The import could not be processed.");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setCsv(null);
    setFileName("");
    setReport(null);
    setError(null);
  }

  const attention = report?.rows.filter((r) => r.action === "needs_review" || r.action === "duplicate_in_file" || r.action === "unmatched" || r.warnings.length > 0) ?? [];
  const writable = report ? (report.counts.create ?? 0) + (report.counts.attach ?? 0) + (report.counts.updated ?? 0) > 0 : false;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-4 pb-4">
          {extraControls}
          <div className="grid gap-1.5">
            <Label htmlFor="import-file">CSV file</Label>
            <input
              id="import-file"
              type="file"
              accept=".csv,text/csv"
              className="text-sm"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                setReport(null);
                setError(null);
                if (!file) return setCsv(null);
                setFileName(file.name);
                setCsv(await file.text());
              }}
            />
            <p className="text-xs text-muted-foreground">In Google Sheets: File, Download, Comma-separated values (current sheet). Nothing is saved until you press Apply.</p>
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          {report && (
            <div className="grid gap-3" aria-live="polite">
              <p className="text-sm font-medium">{report.applied ? "Applied" : "Preview (nothing saved yet)"}{fileName ? ` · ${fileName}` : ""}</p>
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {Object.entries(report.counts)
                  .filter(([, value]) => value > 0)
                  .map(([key, value]) => (
                    <div key={key} className="rounded-md border p-2">
                      <dt className="text-xs text-muted-foreground">{COUNT_LABELS[key] ?? key}</dt>
                      <dd className="text-lg font-semibold">{value}</dd>
                    </div>
                  ))}
              </dl>
              {report.unmappedHeaders && report.unmappedHeaders.length > 0 && (
                <p className="text-xs text-muted-foreground">Columns not imported: {report.unmappedHeaders.join(", ")}</p>
              )}
              {(report.invalid?.length ?? 0) + attention.length > 0 && (
                <div className="max-h-56 overflow-y-auto rounded-md border">
                  <ul className="divide-y text-sm">
                    {report.invalid?.map((r) => (
                      <li key={`i${r.line}`} className="p-2">
                        <span className="font-medium">Row {r.line}{r.name ? ` · ${r.name}` : ""}</span> <span className="text-destructive">{r.reason}</span>
                      </li>
                    ))}
                    {attention.map((r) => (
                      <li key={r.line} className="p-2">
                        <span className="font-medium">Row {r.line} · {r.name}</span>{" "}
                        <span className="text-muted-foreground">{[r.reason, ...r.warnings].filter(Boolean).join(" · ")}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {!report.applied && (report.counts.needs_review ?? 0) > 0 && (
                <p className="text-xs text-muted-foreground">Rows that need a decision are skipped. Add them by hand once you know whether they are the same person.</p>
              )}
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {report?.applied ? "Done" : "Cancel"}
          </Button>
          {!report?.applied && (
            <>
              <Button type="button" variant="outline" disabled={busy || !csv} onClick={() => void run(false)}>
                Preview
              </Button>
              <Button type="button" disabled={busy || !report || !writable} onClick={() => void run(true)}>
                Apply import
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
