"use client";

import { useState } from "react";
import { Copy, Check, Clock3, LogOut, Monitor } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatRelativeTime } from "@/lib/format";
import { formatLicenseExpiryDate, isLicenseExpired, licenseDaysUntilExpiry } from "@/lib/license-dates";
import type { MyLicense } from "./types";
import { ReleaseDialog } from "./ReleaseDialog";
import { MyLicenseHistoryDialog } from "./MyLicenseHistoryDialog";

type Props = {
  license: MyLicense;
  isStaff: boolean;
  onReleased: () => void;
};

export function MyLicensePanel({ license, isStaff, onReleased }: Props) {
  const [copied, setCopied] = useState(false);
  const [showRelease, setShowRelease] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(license.code);
      setCopied(true);
      toast.success("License code copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy — select the code and copy it manually.");
    }
  }

  const daysLeft = license.expiresAt ? licenseDaysUntilExpiry(license.expiresAt) : null;
  const isExpired = license.expiresAt ? isLicenseExpired(license.expiresAt) : false;
  const isExpiringSoon = daysLeft != null && daysLeft >= 0 && daysLeft <= 30;
  const releaseLabel = isStaff ? "Release" : "Return";
  const timeLabel = isStaff ? "Held" : "Claimed";
  const status = isExpired
    ? { label: "Expired", variant: "red" as const }
    : isExpiringSoon
      ? { label: daysLeft === 0 ? "Expires today" : `${daysLeft}d left`, variant: "orange" as const }
      : { label: "Active", variant: "green" as const };

  return (
    <>
      <section
        aria-label="Your Photo Mechanic license"
        className="relative overflow-hidden rounded-2xl border border-[var(--blue)]/30 bg-gradient-to-br from-[var(--blue-bg)] via-background to-background p-5 sm:p-7"
      >
        <Monitor className="pointer-events-none absolute -right-4 -top-4 size-32 text-[var(--blue)]/[0.07]" aria-hidden="true" />
        <div className="relative flex flex-wrap items-center gap-2">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--blue-text)]">
            Your Photo Mechanic license
          </p>
          <Badge variant={status.variant}>{status.label}</Badge>
        </div>

        <button
          type="button"
          onClick={handleCopy}
          className="group relative mt-3 block w-full rounded-xl border bg-background/80 px-4 py-4 text-left transition-colors hover:bg-background focus-visible:outline-2 focus-visible:outline-ring"
          aria-label="Copy license code"
        >
          <code className="block break-all font-mono text-lg font-semibold tracking-[0.08em] text-foreground min-[420px]:text-2xl min-[420px]:tracking-[0.14em] sm:text-3xl sm:tracking-[0.16em]">
            {license.code}
          </code>
          <span className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            {copied ? <Check className="size-3.5 text-[var(--green-text)]" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
            {copied ? "Copied to clipboard" : "Tap to copy"}
          </span>
        </button>

        <dl className="relative mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">{timeLabel}</dt>
            <dd className="font-medium">{license.claimedAt ? formatRelativeTime(license.claimedAt, new Date()) : "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Expires</dt>
            <dd className="font-medium">{license.expiresAt ? formatLicenseExpiryDate(license.expiresAt) : "No expiry set"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Activation</dt>
            <dd className="font-medium">Shared across two machines</dd>
          </div>
        </dl>

        <div className="relative mt-5 flex flex-wrap items-center gap-2">
          <Button type="button" className="h-10" onClick={handleCopy}>
            {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
            {copied ? "Copied" : "Copy code"}
          </Button>
          <Button type="button" variant="outline" className="h-10" onClick={() => setShowHistory(true)}>
            <Clock3 data-icon="inline-start" />
            History
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setShowRelease(true)}
            className="h-10 text-destructive hover:text-destructive sm:ml-auto"
          >
            <LogOut data-icon="inline-start" />
            {releaseLabel}
          </Button>
        </div>
      </section>

      <ReleaseDialog
        open={showRelease}
        onOpenChange={setShowRelease}
        licenseId={license.id}
        onReleased={onReleased}
      />
      <MyLicenseHistoryDialog open={showHistory} onOpenChange={setShowHistory} />
    </>
  );
}
