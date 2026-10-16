"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Archive, CalendarClock, Download, KeyRound, Plus, RefreshCw } from "lucide-react";
import EmptyState from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
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

function SlotMeter({ usedSlots, totalSlots }: { usedSlots: number; totalSlots: number }) {
  return (
    <div
      role="img"
      aria-label={`${usedSlots} of ${totalSlots} slots in use`}
      className="flex h-2.5 gap-0.5 overflow-hidden rounded-full"
    >
      {Array.from({ length: totalSlots }, (_, i) => (
        <span
          key={i}
          className={i < usedSlots ? "flex-1 bg-[var(--blue)]" : "flex-1 bg-[var(--green)]/35"}
        />
      ))}
    </div>
  );
}

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
        <div className="space-y-3">
        <SlotMeter usedSlots={usedSlots} totalSlots={totalSlots} />
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <OperationalMetricCard label="Active codes" value={activeCodes} helper="Usable license codes" />
          <OperationalMetricCard label="Slots in use" value={`${usedSlots}/${totalSlots}`} helper="Two slots per code" tone={usedSlots > 0 ? "blue" : "muted"} />
          <OperationalMetricCard label="Open slots" value={openSlots} helper="Claimable capacity" tone={openSlots > 0 ? "green" : "muted"} />
          <OperationalMetricCard label="Expiring soon" value={expiringCount} helper="Within 30 days" tone={expiringCount > 0 ? "orange" : "muted"} onClick={onRenew} />
          <OperationalMetricCard label="Retired" value={retiredCount} helper="Hidden by default" />
        </div>
        </div>
      )}
    />
  );
}


function ClaimLicensePrompt({ openSlots }: { openSlots: number }) {
  return (
    <section
      aria-label="Claim a Photo Mechanic license"
      className="flex items-center gap-4 rounded-2xl border border-[var(--green)]/30 bg-gradient-to-br from-[var(--green-bg)] to-background p-5"
    >
      <div className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-[var(--green)]/25 bg-background text-[var(--green-text)]">
        <KeyRound className="size-6" aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <p className="text-lg font-semibold leading-tight" style={{ fontFamily: "var(--font-heading)" }}>
          {openSlots} {openSlots === 1 ? "slot" : "slots"} ready to claim
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick any open card below. One code activates two machines, and the code copies for you.
        </p>
      </div>
    </section>
  );
}

type PoolFilter = "all" | "available" | "full" | "expiring";

const FILTERS: { id: PoolFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "available", label: "Has open slot" },
  { id: "full", label: "Full" },
  { id: "expiring", label: "Expiring" },
];

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
  const [filter, setFilter] = useState<PoolFilter>("all");

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
  const claimableFirst = (code: LicenseCode) => (code.status === "AVAILABLE" || code.status === "PARTIAL" ? 0 : 1);
  const filteredCodes = visibleCodes.filter((code) => {
    if (filter === "available") return code.status === "AVAILABLE" || code.status === "PARTIAL";
    if (filter === "full") return code.status === "CLAIMED";
    if (filter === "expiring") return !!code.expiresAt && licenseDaysUntilExpiry(code.expiresAt) <= 30;
    return true;
  }).sort((a, b) => (isAdmin ? 0 : claimableFirst(a) - claimableFirst(b)));
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
        <ClaimLicensePrompt openSlots={openSlots} />
      ) : allCodes.length > 0 ? (
        <p className="rounded-md border bg-muted/30 px-3 py-2.5 text-sm text-muted-foreground">
          Every Photo Mechanic slot is in use. Return a code or ask staff to add one.
        </p>
      ) : null}

      {isAdmin && !codesLoading && allCodes.length > 0 && (
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

      {!isAdmin && myLicense ? (
        <p className="px-1 text-sm text-muted-foreground">
          {openSlots} of {totalSlots} department slots are open. Return yours to pick a different code.
        </p>
      ) : !codesLoading && codesError && allCodes.length === 0 ? (
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
        <>
          {isAdmin && <div className="flex flex-wrap gap-2" role="group" aria-label="Filter license codes">
            {FILTERS.map((item) => (
              <Button
                key={item.id}
                type="button"
                size="sm"
                variant={filter === item.id ? "secondary" : "outline"}
                className="h-10 rounded-full"
                aria-pressed={filter === item.id}
                onClick={() => setFilter(item.id)}
              >
                {item.label}
              </Button>
            ))}
          </div>}
          {filteredCodes.length === 0 && !codesLoading ? (
            <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              No codes match this filter.
            </p>
          ) : (
        <LicenseTable
          codes={filteredCodes}
          loading={codesLoading}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
          hasMyLicense={!!myLicense}
          onClickAvailable={handleClickAvailable}
          onClickClaimed={handleClickClaimed}
          showExpiry={hasExpiry}
        />
          )}
        </>
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
