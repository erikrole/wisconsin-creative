"use client";

import { useState } from "react";
import { toast } from "@/lib/toast";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import { encodeLicenseExpiryDate } from "@/lib/license-dates";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
};

type BulkAddResponse = {
  data?: {
    created?: number;
    skipped?: number;
  };
};

export function BulkAddSheet({ open, onOpenChange, onCreated }: Props) {
  const [codes, setCodes] = useState("");
  const [accountEmail, setAccountEmail] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const codeCount = new Set(codes.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)).size;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!codes.trim()) return;
    setErrorMessage(null);
    setLoading(true);
    try {
      const res = await fetch("/api/licenses/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          codes,
          accountEmail: accountEmail.trim() || undefined,
          expiresAt: expiresAt ? encodeLicenseExpiryDate(expiresAt) : undefined,
        }),
      });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) throw new Error(await parseErrorMessage(res, "Failed to bulk add licenses"));
      const json = await parseJsonSafely<BulkAddResponse>(res);
      const created = Number(json?.data?.created ?? 0);
      const skipped = Number(json?.data?.skipped ?? 0);
      toast.success(`Added ${created} license${created !== 1 ? "s" : ""}`, {
        description: skipped > 0 ? `${skipped} duplicate${skipped !== 1 ? "s" : ""} skipped` : undefined,
      });
      setCodes("");
      setAccountEmail("");
      setExpiresAt("");
      onCreated();
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "The licenses were not created";
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Bulk add licenses</SheetTitle>
          <SheetDescription>Paste one license code per line. Duplicates are skipped.</SheetDescription>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
          {errorMessage && (
            <Alert variant="destructive">
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bulk-codes">License codes</Label>
            <Textarea
              id="bulk-codes"
              value={codes}
              onChange={(e) => setCodes(e.target.value)}
              placeholder={"PM6-XXXX-XXXX-0001\nPM6-XXXX-XXXX-0002\nPM6-XXXX-XXXX-0003"}
              className="font-mono text-sm min-h-[200px]"
              name="licenseCodes"
              maxLength={50_000}
              required
            />
            <p className="text-xs text-muted-foreground tabular-nums">
              {codeCount} unique code{codeCount === 1 ? "" : "s"} ready to add
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bulk-account">
              Shared account email <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="bulk-account"
              type="email"
              value={accountEmail}
              onChange={(e) => setAccountEmail(e.target.value)}
              placeholder="kms@athletics.wisc.edu"
              name="accountEmail"
              autoComplete="email"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bulk-expiry">
              Shared expiry <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="bulk-expiry"
              type="date"
              value={expiresAt}
              name="expiresAt"
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </div>
          <SheetFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" loading={loading} disabled={!codes.trim()}>
              Add {codeCount || ""} license{codeCount === 1 ? "" : "s"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
