"use client";

import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AwayForm } from "./cant-work-forms";

type Props = {
  userId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Prefill the first day, e.g. the day picked on the schedule. */
  initialFrom?: string;
  onSaved?: () => void;
};

/** The quick everyday way in: one dated "can't work" entry, from Home or Schedule. */
export function CantWorkDialog({ userId, open, onOpenChange, initialFrom, onSaved }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="flex-col items-start gap-1">
          <DialogTitle>Can’t work some days?</DialogTitle>
          <DialogDescription>A trip, an exam, another job. We won’t schedule you then.</DialogDescription>
        </DialogHeader>
        <DialogBody className="pb-6">
          {open && (
            <AwayForm
              bare
              userId={userId}
              initialFrom={initialFrom}
              onCancel={() => onOpenChange(false)}
              onSaved={() => {
                onOpenChange(false);
                onSaved?.();
              }}
            />
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
