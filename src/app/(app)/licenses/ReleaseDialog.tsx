"use client";

import { useState } from "react";
import { toast } from "@/lib/toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { handleAuthRedirect, parseErrorMessage } from "@/lib/errors";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  licenseId: string;
  onReleased: () => void;
};

export function ReleaseDialog({ open, onOpenChange, licenseId, onReleased }: Props) {
  const [loading, setLoading] = useState(false);

  async function handleRelease() {
    setLoading(true);
    try {
      const res = await fetch(`/api/licenses/${licenseId}/release`, { method: "POST" });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) {
        throw new Error(await parseErrorMessage(res, "Failed to release license"));
      }
      toast.success("License returned");
      onReleased();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The license was not returned");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Return this license?</AlertDialogTitle>
          <AlertDialogDescription>
            The license code will go back into the pool for others to use. You can always claim
            another one later.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleRelease} disabled={loading}>
            Return license
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
