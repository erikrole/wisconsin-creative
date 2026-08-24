"use client";

import { useState } from "react";
import { Copy, Check, Clock3, LogOut } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatRelativeTime } from "@/lib/format";
import { isLicenseExpired, licenseDaysUntilExpiry } from "@/lib/license-dates";
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
      : { label: "Active", variant: "blue" as const };

  return (
    <>
      <Card elevation="flat" className="overflow-hidden border-[var(--blue)]/35 bg-[var(--blue-bg)]">
        <CardContent className="flex flex-col gap-4 border-l-[3px] border-l-[var(--blue)] p-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--blue-text)]">
                Your Photo Mechanic license
              </p>
              <Badge variant={status.variant}>{status.label}</Badge>
            </div>
            <code className="block break-all font-mono text-xl font-semibold tracking-[0.18em] text-foreground">
              {license.code}
            </code>
            <p className="text-xs text-muted-foreground">
              {license.claimedAt ? `${timeLabel} ${formatRelativeTime(license.claimedAt, new Date())}` : null}
              {license.claimedAt && license.expiresAt && !isExpired && !isExpiringSoon ? " · Two-machine activation" : null}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" className="h-10" onClick={handleCopy}>
              {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button type="button" variant="outline" size="sm" className="h-10" onClick={() => setShowHistory(true)}>
              <Clock3 data-icon="inline-start" />
              History
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowRelease(true)}
              className="h-10 text-destructive hover:text-destructive"
            >
              <LogOut data-icon="inline-start" />
              {releaseLabel}
            </Button>
          </div>
        </CardContent>
      </Card>

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
