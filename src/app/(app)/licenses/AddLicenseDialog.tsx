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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { handleAuthRedirect, parseErrorMessage } from "@/lib/errors";
import { encodeLicenseExpiryDate } from "@/lib/license-dates";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
};

export function AddLicenseDialog({ open, onOpenChange, onCreated }: Props) {
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [accountEmail, setAccountEmail] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setErrorMessage(null);
    setLoading(true);
    try {
      const res = await fetch("/api/licenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: code.trim(),
          label: label.trim() || undefined,
          accountEmail: accountEmail.trim() || undefined,
          expiresAt: expiresAt ? encodeLicenseExpiryDate(expiresAt) : undefined,
        }),
      });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) throw new Error(await parseErrorMessage(res, "Failed to add license"));
      toast.success("License added");
      setCode("");
      setLabel("");
      setAccountEmail("");
      setExpiresAt("");
      onCreated();
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "The license was not created";
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add license code</DialogTitle>
          <DialogDescription>Add a single Photo Mechanic license to the pool.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {errorMessage && (
            <Alert variant="destructive">
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="code">License code</Label>
            <Input
              id="code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="PM6-XXXX-XXXX-XXXX"
              className="font-mono"
              name="licenseCode"
              autoComplete="off"
              maxLength={120}
              autoFocus
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="label">
              Label <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Seat 3, renewed 2026"
              name="licenseLabel"
              maxLength={200}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="accountEmail">
              Account email <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="accountEmail"
              type="email"
              value={accountEmail}
              onChange={(e) => setAccountEmail(e.target.value)}
              placeholder="kms@athletics.wisc.edu"
              name="accountEmail"
              autoComplete="email"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="expiresAt">
              Annual expiry <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="expiresAt"
              type="date"
              value={expiresAt}
              name="expiresAt"
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" loading={loading} disabled={!code.trim()}>
              Create license
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
