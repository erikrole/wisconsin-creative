"use client";

import { AlertTriangleIcon, ArrowLeftRightIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { FRESH_THEME_CLASS } from "./fresh-theme";

export type PostTradeShiftSummary = {
  title: string;
  when: string;
  area: string;
};

type Props = {
  open: boolean;
  shift: PostTradeShiftSummary | null;
  notes: string;
  error: string | null;
  posting: boolean;
  onNotes: (value: string) => void;
  onClose: () => void;
  onPost: () => void;
};

/** One-tap reasons: a posted shift with a reason gets claimed faster and approved without a question. */
const REASONS = ["Class conflict", "Out of town", "Sick", "Other commitment"];

export function PostTradeDialog({ open, shift, notes, error, posting, onNotes, onClose, onPost }: Props) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className={cn(FRESH_THEME_CLASS, "sm:max-w-md")}>
        <DialogHeader>
          <div className="flex flex-col gap-1">
            <DialogTitle>Post this shift for trade</DialogTitle>
            <DialogDescription>
              Teammates in your area are told it is up. You stay on the shift until an admin approves a claim.
            </DialogDescription>
          </div>
        </DialogHeader>
        <div className="flex flex-col gap-4 px-6 py-1">
          {shift && (
            <div className="flex items-start gap-3 rounded-lg border border-border/60 bg-muted/40 px-3 py-2.5">
              <ArrowLeftRightIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 text-sm">
                <p className="truncate font-semibold">{shift.title}</p>
                <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">{shift.when} · {shift.area}</p>
              </div>
            </div>
          )}
          {error && (
            <Alert variant="destructive" className="py-2.5">
              <AlertTriangleIcon className="size-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="schedule-trade-notes" className="text-xs font-medium">
              Why, and when you could cover instead{" "}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {REASONS.map((reason) => (
                <button
                  key={reason}
                  type="button"
                  disabled={posting}
                  onClick={() => onNotes(notes.trim() ? `${notes.trim()}. ${reason}` : reason)}
                  className="h-10 rounded-full border border-border bg-background px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {reason}
                </button>
              ))}
            </div>
            <Textarea
              id="schedule-trade-notes"
              placeholder="e.g. Class conflict, happy to cover a later game"
              value={notes}
              onChange={(event) => onNotes(event.target.value)}
              className="min-h-20 resize-none text-sm"
              maxLength={5000}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" className="h-10" onClick={onClose} disabled={posting}>
            Cancel
          </Button>
          <Button className="h-10" onClick={onPost} disabled={posting}>
            {posting ? "Posting..." : "Post trade"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
