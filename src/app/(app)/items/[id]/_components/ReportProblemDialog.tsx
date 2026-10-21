"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { handleAuthRedirect, parseErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

type Kind = "DAMAGED" | "LOST";

/** Report an item as damaged or missing from its page, any time. Opens a case for staff. */
export function ReportProblemDialog({ assetId, assetTag, open, onOpenChange, onReported }: {
  assetId: string;
  assetTag: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReported: () => void;
}) {
  const [kind, setKind] = useState<Kind>("DAMAGED");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const form = new FormData();
      form.set("type", kind);
      form.set("description", note.trim());
      if (file) form.set("file", file);
      const res = await fetch(`/api/assets/${assetId}/report`, { method: "POST", body: form });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) throw new Error(await parseErrorMessage(res, "Couldn't send the report"));
      toast.success("Thanks. Staff have been told.");
      setNote("");
      setFile(null);
      onOpenChange(false);
      onReported();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't send the report");
    } finally {
      setBusy(false);
    }
  }

  const needsDetail = kind === "DAMAGED" && !note.trim() && !file;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader className="flex-col items-start gap-1">
          <DialogTitle>Report a problem with {assetTag}</DialogTitle>
          <DialogDescription>Staff get a case to look into. A photo and a few words help the most.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4 py-5">
          <div className="flex gap-2" role="radiogroup" aria-label="What's wrong">
            {([["DAMAGED", "It's damaged"], ["LOST", "I can't find it"]] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={kind === value}
                onClick={() => setKind(value)}
                className={cn(
                  "h-9 rounded-full border px-4 text-sm font-bold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                  kind === value ? "border-foreground bg-foreground text-background" : "bg-card hover:bg-muted",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <Textarea
            aria-label="What happened"
            placeholder={kind === "DAMAGED" ? "What's wrong with it?" : "Where did you last see it?"}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={2000}
            rows={3}
          />
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-bold">Photo (optional)</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="text-sm file:mr-3 file:h-8 file:rounded-md file:border file:bg-card file:px-3 file:text-sm file:font-bold"
            />
          </label>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={busy || needsDetail}>{busy ? "Sending…" : "Send report"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
