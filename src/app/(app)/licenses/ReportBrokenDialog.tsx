"use client";

import { useState } from "react";
import { toast } from "sonner";
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
  onSwapped: () => void;
};

export function ReportBrokenDialog({ open, onOpenChange, licenseId, onSwapped }: Props) {
  const [loading, setLoading] = useState(false);

  async function handleReport(event: React.MouseEvent) {
    // Keep the dialog open until the request settles so the button can't double-fire.
    event.preventDefault();
    setLoading(true);
    try {
      const res = await fetch(`/api/licenses/${licenseId}/report-broken`, { method: "POST" });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) throw new Error(await parseErrorMessage(res, "Couldn't swap this code"));
      const json = (await res.json()) as { data?: { replacement: { id: string } | null } };
      if (json.data?.replacement) {
        toast.success("Here's a new code. The old one was flagged for staff.");
      } else {
        toast.message("No open codes right now. The old one was flagged for staff to check.");
      }
      onSwapped();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't swap this code");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => !loading && onOpenChange(next)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Code not working?</AlertDialogTitle>
          <AlertDialogDescription>
            We&apos;ll flag this code so staff can check it, make sure nobody else gets it, and give you a different
            open one right away. If none are open, staff will be able to see it needs replacing.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleReport} disabled={loading}>
            {loading ? "Swapping…" : "Get a new code"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
