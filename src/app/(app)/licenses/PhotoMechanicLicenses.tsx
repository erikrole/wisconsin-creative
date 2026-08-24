"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Archive, CalendarClock, Download, KeyRound, Plus, RefreshCw } from "lucide-react";
import EmptyState from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { OperationalMetricCard } from "@/components/OperationalFeedback";
import { OperationalStatusRail, type OperationalStatusRailItem } from "@/components/OperationalStatusRail";
import { OperationalToolbar } from "@/components/OperationalToolbar";
import { useFetch } from "@/hooks/use-fetch";
import { formatRelativeTime } from "@/lib/format";
import { handleAuthRedirect, parseErrorMessage } from "@/lib/errors";
import { licenseDaysUntilExpiry, localDateKey } from "@/lib/license-dates";
import { LicenseTable } from "./LicenseTable";
import { MyLicensePanel } from "./MyLicensePanel";
import { ConfirmClaimDialog } from "./ConfirmClaimDialog";
import { AdminClaimSheet } from "./AdminClaimSheet";
import { AddLicenseDialog } from "./AddLicenseDialog";
import { BulkAddSheet } from "./BulkAddSheet";
import { BulkRenewDialog } from "./BulkRenewDialog";
import type { LicenseCode, MyLicense } from "./types";

const MAX_SLOTS = 2;

function LicenseSummary({
  activeCodes,
  usedSlots,
  expiringCount,
  retiredCount,
  myLicense,
  onRenew,
}: {
  activeCodes: number;
  usedSlots: number;
  expiringCount: number;
  retiredCount: number;
  myLicense: boolean;
  onRenew?: () => void;
}) {
  const totalSlots = activeCodes * MAX_SLOTS;
  const openSlots = Math.max(totalSlots - usedSlots, 0);
  const railItems: OperationalStatusRailItem[] = [
    ...(expiringCount > 0 ? [{
      id: "expiring",
      label: "Expiring soon",
      value: expiringCount,
      detail: "Active license codes expiring within 30 days.",
      icon: CalendarClock,
      tone: "warning" as const,
      onSelect: onRenew,
    }] : []),
    ...(openSlots === 0 ? [{
      id: "capacity",
      label: "No open slots",
      detail: "Every active Photo Mechanic license slot is in use.",
      icon: AlertTriangle,
      tone: "critical" as const,
    }] : []),
  ];

  return (
    <OperationalStatusRail
      orientation={{
        label: "Open slots",
        value: `${openSlots} of ${totalSlots}`,
        icon: KeyRound,
      }}
      items={railItems}
      allClearLabel={railItems.length === 0 ? "License capacity is healthy" : undefined}
      notice={myLicense ? <p className="text-xs text-muted-foreground">You hold one slot.</p> : undefined}
      details={(
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <OperationalMetricCard label="Active codes" value={activeCodes} helper="Usable license codes" />
          <OperationalMetricCard label="Slots in use" value={`${usedSlots}/${totalSlots}`} helper="Two slots per code" tone={usedSlots > 0 ? "blue" : "muted"} />
          <OperationalMetricCard label="Open slots" value={openSlots} helper="Claimable capacity" tone={openSlots > 0 ? "green" : "muted"} />
          <OperationalMetricCard label="Expiring soon" value={expiringCount} helper="Within 30 days" tone={expiringCount > 0 ? "orange" : "muted"} onClick={onRenew} />
          <OperationalMetricCard label="Retired" value={retiredCount} helper="Hidden by default" />
        </div>
      )}
    />
  );
}


function ClaimLicensePrompt() {
  return (
    <Card elevation="flat" className="border-[var(--green)]/35 bg-[var(--green-bg)]">
      <CardContent className="flex items-start gap-3 p-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-md border border-[var(--green)]/25 bg-background text-[var(--green-text)]">
          <KeyRound className="size-5" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--green-text)]">
            Claim a Photo Mechanic license
          </p>
          <p className="mt-1 text-sm text-foreground">
            Each code activates two machines. Claim any Open or 1/2 code below.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export function PhotoMechanicLicenses({
  isAdmin,
  currentUserId,
}: {
  isAdmin: boolean;
  currentUserId: string | null;
}) {
  const [claimTarget, setClaimTarget] = useState<LicenseCode | null>(null);
  const [adminTarget, setAdminTarget] = useState<LicenseCode | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [showRenew, setShowRenew] = useState(false);
  const [showRetired, setShowRetired] = useState(false);
  const [exporting, setExporting] = useState(false);

  const {
    data: codesData,
    loading: codesLoading,
    error: codesError,
    lastRefreshed,
    reload: reloadCodes,
  } = useFetch<LicenseCode[]>({
    url: "/api/licenses",
    transform: (json) => (json as Record<string, unknown>).data as LicenseCode[],
  });

  const {
    data: myLicense,
    reload: reloadMy,
  } = useFetch<MyLicense | null>({
    url: "/api/licenses/my",
    transform: (json) => ((json as Record<string, unknown>).data as MyLicense) ?? null,
  });

  function reloadAll() {
    reloadCodes();
    reloadMy();
  }

  const allCodes = codesData ?? [];
  const visibleCodes = showRetired ? allCodes : allCodes.filter((code) => code.status !== "RETIRED");
  const activeCodes = allCodes.filter((code) => code.status !== "RETIRED");
  const usedSlots = activeCodes.reduce((sum, code) => sum + code.claims.length, 0);
  const totalSlots = activeCodes.length * MAX_SLOTS;
  const openSlots = Math.max(totalSlots - usedSlots, 0);
  const retiredCount = allCodes.length - activeCodes.length;
  const expiringCount = activeCodes.filter((code) => {
    if (!code.expiresAt) return false;
    return licenseDaysUntilExpiry(code.expiresAt) <= 30;
  }).length;
  const hasRetired = allCodes.some((code) => code.status === "RETIRED");
  const hasExpiry = allCodes.some((code) => code.expiresAt);

  function handleClickAvailable(code: LicenseCode) {
    if (myLicense) return;
    setClaimTarget(code);
  }

  function handleClickClaimed(code: LicenseCode) {
    // Students without admin rights get their own view via MyLicensePanel — skip the sheet.
    if (!isAdmin) return;
    setAdminTarget(code);
  }

  const adminLicense = adminTarget
    ? allCodes.find((code) => code.id === adminTarget.id) ?? adminTarget
    : null;

  async function handleExport() {
    if (exporting) return;
    setExporting(true);
    try {
      const res = await fetch("/api/licenses/export");
      if (handleAuthRedirect(res)) return;
      if (!res.ok) throw new Error(await parseErrorMessage(res, "Failed to export licenses"));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `licenses-${localDateKey()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to export licenses");
    } finally {
      setExporting(false);
    }
  }

  return (
    <section aria-labelledby="photo-mechanic-title" className="space-y-4">
      <h2 id="photo-mechanic-title" className="sr-only">Photo Mechanic licenses</h2>

      {myLicense ? (
        <MyLicensePanel license={myLicense} isStaff={isAdmin} onReleased={reloadAll} />
      ) : codesLoading ? (
        <Skeleton className="h-28 w-full rounded-lg" />
      ) : allCodes.length > 0 && openSlots > 0 ? (
        <ClaimLicensePrompt />
      ) : allCodes.length > 0 ? (
        <p className="rounded-md border bg-muted/30 px-3 py-2.5 text-sm text-muted-foreground">
          Every Photo Mechanic slot is in use. Return a code or ask staff to add one.
        </p>
      ) : null}

      {!codesLoading && allCodes.length > 0 && (
        <LicenseSummary
          activeCodes={activeCodes.length}
          usedSlots={usedSlots}
          expiringCount={expiringCount}
          retiredCount={retiredCount}
          myLicense={!!myLicense}
          onRenew={isAdmin ? () => setShowRenew(true) : undefined}
        />
      )}

      {isAdmin && allCodes.length > 0 && (
        <OperationalToolbar>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" className="h-10" onClick={() => setShowRenew(true)} disabled={activeCodes.length === 0}>
              <CalendarClock data-icon="inline-start" />
              Renew licenses
            </Button>
            {hasRetired && (
              <Button
                type="button"
                variant={showRetired ? "secondary" : "outline"}
                size="sm"
                className="h-10"
                onClick={() => setShowRetired((value) => !value)}
                aria-pressed={showRetired}
              >
                <Archive data-icon="inline-start" />
                {showRetired ? "Hide retired" : `Show retired (${retiredCount})`}
              </Button>
            )}
            <Button type="button" variant="outline" size="sm" className="h-10" onClick={handleExport} disabled={exporting}>
              <Download data-icon="inline-start" />
              Export CSV
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button type="button" variant="ghost" size="icon" className="size-10" onClick={reloadAll} disabled={codesLoading} aria-label="Refresh license pool">
                  <RefreshCw className={codesLoading ? "animate-spin" : undefined} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {lastRefreshed ? `Updated ${formatRelativeTime(lastRefreshed.toISOString(), new Date())}` : "Refresh license pool"}
              </TooltipContent>
            </Tooltip>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" className="h-10" onClick={() => setShowBulk(true)}>
                Bulk add codes
              </Button>
              <Button type="button" size="sm" className="h-10" onClick={() => setShowAdd(true)}>
                <Plus data-icon="inline-start" />
                Add license code
              </Button>
            </div>
          </div>
        </OperationalToolbar>
      )}

      {!codesLoading && codesError && allCodes.length === 0 ? (
        <EmptyState
          icon="wifi-off"
          title="Couldn't load Photo Mechanic licenses"
          description="Check your connection and try again."
          actionLabel="Retry"
          onAction={reloadAll}
        />
      ) : !codesLoading && allCodes.length === 0 ? (
        <EmptyState
          icon="box"
          title="No Photo Mechanic licenses"
          description={isAdmin ? "Add activation codes to start the two-device license pool." : "No activation licenses have been added yet."}
          actionLabel={isAdmin ? "Add code" : undefined}
          onAction={isAdmin ? () => setShowAdd(true) : undefined}
        />
      ) : !codesLoading && visibleCodes.length === 0 ? (
        <EmptyState
          icon="box"
          title="All licenses are retired"
          description="Show retired codes above to review archived license history."
          actionLabel={isAdmin ? "Show retired" : undefined}
          onAction={isAdmin ? () => setShowRetired(true) : undefined}
        />
      ) : (
        <LicenseTable
          codes={visibleCodes}
          loading={codesLoading}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
          hasMyLicense={!!myLicense}
          onClickAvailable={handleClickAvailable}
          onClickClaimed={handleClickClaimed}
          showExpiry={hasExpiry}
        />
      )}

      <ConfirmClaimDialog
        license={claimTarget}
        onOpenChange={(open) => { if (!open) setClaimTarget(null); }}
        onClaimed={reloadAll}
      />
      <AdminClaimSheet
        license={adminLicense}
        isAdmin={isAdmin}
        hasMyLicense={!!myLicense}
        onOpenChange={(open) => { if (!open) setAdminTarget(null); }}
        onAction={reloadAll}
      />
      <AddLicenseDialog open={showAdd} onOpenChange={setShowAdd} onCreated={reloadAll} />
      <BulkAddSheet open={showBulk} onOpenChange={setShowBulk} onCreated={reloadAll} />
      <BulkRenewDialog
        open={showRenew}
        onOpenChange={setShowRenew}
        codes={visibleCodes}
        onRenewed={reloadAll}
      />
    </section>
  );
}
