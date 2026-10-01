"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { handleAuthRedirect, parseErrorMessage } from "@/lib/errors";
import { isApplicantFileType, MAX_APPLICANT_FILE_BYTES } from "@/lib/hiring/files";
import { matchResumeFile } from "@/lib/hiring/resume-match";
import type { BoardApplication } from "./types";

/** Below the 60-per-minute write limit, so one batch cannot partially fail by design. */
const MAX_FILES_PER_BATCH = 50;

type Row = { file: File; applicationId: string; note: string; status: "ready" | "uploading" | "done" | "failed" | "skipped"; error?: string };

/**
 * Upload many resumes at once. Files are matched to applicants by PageUp
 * application ID or by name in the filename; the admin can correct any row
 * before anything is sent. Applicants who already have a resume are skipped.
 */
export default function BulkResumeDialog({
  open,
  onOpenChange,
  apps,
  onUploaded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  apps: BoardApplication[];
  onUploaded: () => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const byId = useMemo(() => new Map(apps.map((a) => [a.id, a])), [apps]);

  const [overLimit, setOverLimit] = useState(0);

  function buildRows(allFiles: File[]) {
    const files = allFiles.slice(0, MAX_FILES_PER_BATCH);
    setOverLimit(Math.max(0, allFiles.length - MAX_FILES_PER_BATCH));
    const targets = apps.map((a) => ({ id: a.id, name: a.name, externalApplicationId: a.externalApplicationId }));
    setRows(
      files.map((file): Row => {
        if (!isApplicantFileType(file.type)) return { file, applicationId: "", note: "Not a PDF, PNG, or JPEG", status: "skipped" };
        if (file.size > MAX_APPLICANT_FILE_BYTES) return { file, applicationId: "", note: "Larger than 4 MB", status: "skipped" };
        const match = matchResumeFile(file.name, targets);
        if (match.status === "matched") {
          const app = byId.get(match.applicationId);
          return app?.hasResume
            ? { file, applicationId: match.applicationId, note: "Already has a resume", status: "skipped" }
            : { file, applicationId: match.applicationId, note: match.via === "application_id" ? "Matched by PageUp ID" : "Matched by name", status: "ready" };
        }
        return {
          file,
          applicationId: "",
          note: match.status === "ambiguous" ? "More than one possible applicant. Choose one." : "No match. Choose an applicant or skip.",
          status: "skipped",
        };
      }),
    );
  }

  const setApplication = (index: number, applicationId: string) =>
    setRows((list) =>
      list.map((r, i) =>
        i === index ? { ...r, applicationId, status: applicationId ? "ready" : "skipped", note: applicationId ? "Chosen by you" : "Skipped" } : r,
      ),
    );

  async function uploadAll() {
    setBusy(true);
    let done = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      // Retry rows that failed (for example after a rate-limit pause) as well as new ones.
      if ((row.status !== "ready" && row.status !== "failed") || !row.applicationId) continue;
      setRows((list) => list.map((r, j) => (j === i ? { ...r, status: "uploading" } : r)));
      try {
        const form = new FormData();
        form.set("file", row.file);
        form.set("kind", "RESUME");
        const res = await fetch(`/api/hiring/applications/${row.applicationId}/documents`, { method: "POST", body: form });
        if (handleAuthRedirect(res)) return;
        if (!res.ok) throw new Error(await parseErrorMessage(res, "Upload failed."));
        done++;
        setRows((list) => list.map((r, j) => (j === i ? { ...r, status: "done" } : r)));
      } catch (err) {
        setRows((list) => list.map((r, j) => (j === i ? { ...r, status: "failed", error: err instanceof Error ? err.message : "Upload failed." } : r)));
      }
    }
    setBusy(false);
    if (done > 0) {
      toast.success(`${done} resume${done === 1 ? "" : "s"} uploaded`);
      onUploaded();
    }
  }

  const ready = rows.filter((r) => r.status === "ready" || (r.status === "failed" && r.applicationId)).length;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setRows([]);
          setOverLimit(0);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Upload resumes</DialogTitle>
          <DialogDescription>
            Choose several PDFs. Each is matched to an applicant by PageUp application ID or by name in the filename. Nothing uploads until you press Upload.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-4 pb-4">
          <div className="grid gap-1.5">
            <Label htmlFor="bulk-resumes">Files</Label>
            <input
              id="bulk-resumes"
              type="file"
              multiple
              accept="application/pdf,image/png,image/jpeg"
              className="text-sm"
              onChange={(e) => buildRows([...(e.target.files ?? [])])}
            />
          </div>
          {overLimit > 0 && (
            <p role="alert" className="text-sm text-destructive">
              Only the first {MAX_FILES_PER_BATCH} files were taken. Upload the other {overLimit} in a second batch.
            </p>
          )}
          {rows.length > 0 && (
            <ul className="grid max-h-80 gap-2 overflow-y-auto" aria-live="polite">
              {rows.map((row, i) => (
                <li key={`${row.file.name}-${i}`} className="grid gap-1.5 rounded-md border p-2 text-sm sm:grid-cols-[1fr_14rem] sm:items-center">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{row.file.name}</p>
                    <p className={row.status === "failed" ? "text-destructive" : "text-xs text-muted-foreground"}>
                      {row.status === "done" ? "Uploaded" : row.status === "uploading" ? "Uploading" : row.error ?? row.note}
                    </p>
                  </div>
                  <NativeSelect
                    aria-label={`Applicant for ${row.file.name}`}
                    value={row.applicationId}
                    disabled={busy || row.status === "done" || row.status === "uploading"}
                    onChange={(e) => setApplication(i, e.target.value)}
                  >
                    <option value="">Skip this file</option>
                    {apps.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                        {a.hasResume ? " (has resume)" : ""}
                      </option>
                    ))}
                  </NativeSelect>
                </li>
              ))}
            </ul>
          )}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button type="button" disabled={busy || ready === 0} onClick={() => void uploadAll()}>
            Upload {ready > 0 ? ready : ""} resume{ready === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
