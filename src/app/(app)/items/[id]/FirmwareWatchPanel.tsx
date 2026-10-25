"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Check, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AssetDetail } from "./types";
import { useSaveField } from "@/components/SaveableField";
import { firmwareBadgeStatus, firmwareBadgeVariant, firmwareSupportLabel, firmwareSupportVariant, formatFirmwareDate, normalizeFirmwareVersion } from "./item-info-format";
import { useAdjustState } from "@/hooks/use-synced-draft";

export function FirmwareWatchPanel({
  asset,
  canEdit,
  firmwareWatch,
  onSaveInstalledVersion,
}: {
  asset: AssetDetail;
  canEdit: boolean;
  firmwareWatch: NonNullable<AssetDetail["firmwareWatch"]>;
  onSaveInstalledVersion: (value: string) => Promise<void>;
}) {
  const installedVersion = asset.metadata?.installedFirmwareVersion?.trim() ?? "";
  const releaseDate = formatFirmwareDate(firmwareWatch.latestReleaseDate);
  const lastChecked = formatFirmwareDate(firmwareWatch.lastCheckedAt);
  const [open, setOpen] = useState(false);
  const [draftVersion, setDraftVersion] = useState(installedVersion);
  const saveInstalledVersion = useSaveField(onSaveInstalledVersion);
  const badgeVariant = firmwareBadgeVariant(installedVersion, firmwareWatch.latestVersion);
  const badgeStatus = firmwareBadgeStatus(installedVersion, firmwareWatch.latestVersion);
  const latestLabel = firmwareWatch.latestVersion ?? "Unknown";
  const needsUpdate =
    Boolean(firmwareWatch.latestVersion) &&
    normalizeFirmwareVersion(installedVersion) !==
      normalizeFirmwareVersion(firmwareWatch.latestVersion);

  useAdjustState([installedVersion, open], () => {
    if (open) setDraftVersion(installedVersion);
  });

  async function saveVersion(value: string) {
    if (!canEdit || saveInstalledVersion.isSaving) return;
    const trimmed = value.trim();
    if (trimmed === installedVersion) {
      setOpen(false);
      return;
    }
    await saveInstalledVersion.save(trimmed);
    setOpen(false);
  }

  return (
    <>
      <dt className="flex h-8 items-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Firmware
      </dt>
      <dd className="flex h-8 min-w-0 items-center gap-2">
        <Dialog open={open} onOpenChange={setOpen}>
          <Badge
            asChild
            variant={badgeVariant}
            size="sm"
            className="relative cursor-pointer rounded-sm font-mono tabular-nums hover:brightness-125 active:scale-[0.96] after:absolute after:left-1/2 after:top-1/2 after:size-10 after:-translate-x-1/2 after:-translate-y-1/2"
          >
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-label={`Edit installed firmware version, currently ${installedVersion || "not recorded"}`}
            >
              {installedVersion || "Set firmware"}
            </button>
          </Badge>
          {installedVersion && needsUpdate && (
            <span className="min-w-0 truncate text-muted-foreground">
              {latestLabel} available
            </span>
          )}
          <DialogContent className="max-w-[460px]">
            <DialogHeader>
              <div>
                <DialogTitle className="text-balance">Firmware</DialogTitle>
                <DialogDescription>
                  Installed firmware for {asset.assetTag}
                </DialogDescription>
              </div>
            </DialogHeader>
            <DialogBody className="flex flex-col gap-4 py-4">
              <div className="rounded-md bg-muted/25 p-4 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Installed
                    </div>
                    <div
                      className={cn(
                        "mt-1.5 truncate text-2xl font-semibold leading-none tracking-tight",
                        installedVersion
                          ? "font-mono tabular-nums"
                          : "text-muted-foreground/60",
                      )}
                    >
                      {installedVersion || "Not recorded"}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                    <Badge variant={badgeVariant} size="sm" className="rounded-sm">
                      {badgeStatus}
                    </Badge>
                    <Badge
                      variant={firmwareSupportVariant(firmwareWatch.supportMode)}
                      size="sm"
                      className="rounded-sm"
                    >
                      {firmwareSupportLabel(firmwareWatch.supportMode)}
                    </Badge>
                  </div>
                </div>
                <dl className="mt-4 grid grid-cols-3 border-t border-border/40 pt-3 text-sm">
                  <div className="min-w-0 pr-3">
                    <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Newest
                    </dt>
                    <dd
                      className={cn(
                        "mt-1 truncate font-mono tabular-nums",
                        badgeVariant === "orange" && "text-[var(--orange-text)]",
                      )}
                    >
                      {latestLabel}
                    </dd>
                  </div>
                  <div className="min-w-0 border-l border-border/40 px-3">
                    <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Checked
                    </dt>
                    <dd className="mt-1 truncate tabular-nums">{lastChecked || "Not checked"}</dd>
                  </div>
                  <div className="min-w-0 border-l border-border/40 pl-3">
                    <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Released
                    </dt>
                    <dd className="mt-1 truncate tabular-nums">{releaseDate || "Not recorded"}</dd>
                  </div>
                </dl>
              </div>
              {canEdit && (
                <div className="flex flex-col gap-2">
                  <label htmlFor="installed-firmware-version" className="text-sm font-medium">
                    Installed firmware version
                  </label>
                  <Input
                    id="installed-firmware-version"
                    value={draftVersion}
                    onChange={(event) => setDraftVersion(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") saveVersion(draftVersion);
                    }}
                    placeholder={latestLabel === "Unknown" ? "Enter version" : latestLabel}
                    disabled={saveInstalledVersion.isSaving}
                    aria-busy={saveInstalledVersion.isSaving}
                    className="font-mono tabular-nums"
                  />
                  {needsUpdate && (
                    <Button
                      type="button"
                      variant="secondary"
                      className="w-full"
                      onClick={() => saveVersion(firmwareWatch.latestVersion ?? "")}
                      disabled={saveInstalledVersion.isSaving}
                    >
                      <Check className="size-4" aria-hidden="true" />
                      Mark updated to {latestLabel}
                    </Button>
                  )}
                </div>
              )}
              {firmwareWatch.supportNote && (
                <p className="text-pretty text-sm text-muted-foreground">{firmwareWatch.supportNote}</p>
              )}
              {firmwareWatch.lastError && (
                <p className="text-pretty text-sm text-[var(--orange-text)]">
                  Last check issue: {firmwareWatch.lastError}
                </p>
              )}
            </DialogBody>
            <DialogFooter className="items-center gap-2 sm:justify-between">
              <Button variant="outline" asChild>
                <a
                  href={firmwareWatch.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open Official firmware source"
                >
                  <ExternalLink className="size-4" aria-hidden="true" />
                  Sony update page
                </a>
              </Button>
              {canEdit && (
                <Button
                  type="button"
                  className="h-10"
                  onClick={() => saveVersion(draftVersion)}
                  disabled={saveInstalledVersion.isSaving}
                  loading={saveInstalledVersion.isSaving}
                >
                  Save
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </dd>
    </>
  );
}
