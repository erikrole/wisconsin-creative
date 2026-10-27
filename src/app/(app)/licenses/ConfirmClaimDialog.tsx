"use client";

import { useState } from "react";
import { toast } from "@/lib/toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import type { LicenseCode } from "./types";

type Props = {
  license: LicenseCode | null;
  onOpenChange: (open: boolean) => void;
  onClaimed: () => void;
};

type ClaimResponse = {
  data?: {
    code?: string;
  };
};

export function ConfirmClaimDialog({ license, onOpenChange, onClaimed }: Props) {
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleClaim() {
    if (!license) return;
    setErrorMessage(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/licenses/${license.id}/claim`, { method: "POST" });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) throw new Error(await parseErrorMessage(res, "Failed to claim license"));

      // The claim succeeded — nothing past this point may report failure.
      // Safari rejects clipboard writes outside the original user gesture.
      const json = await parseJsonSafely<ClaimResponse>(res);
      const code = json?.data?.code;
      let copied = false;
      if (code) {
        try {
          await navigator.clipboard.writeText(code);
          copied = true;
        } catch {
          copied = false;
        }
      }
      toast.success(copied ? "License claimed and copied to clipboard" : "License claimed", {
        description: copied ? code : "Copy the code from your license banner above.",
        duration: 6000,
      });
      onClaimed();
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "The license was not claimed";
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={!!license} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Claim Photo Mechanic license?</DialogTitle>
          <DialogDescription>
            You can only hold one license at a time. The code will be copied to your clipboard
            automatically.
            {license?.label && (
              <span className="block mt-1 text-xs text-muted-foreground">{license.label}</span>
            )}
          </DialogDescription>
        </DialogHeader>
        {errorMessage && (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleClaim} loading={loading}>
            Claim and copy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
