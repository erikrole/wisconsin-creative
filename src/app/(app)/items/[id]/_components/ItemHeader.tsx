"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { InlineTitle } from "@/components/InlineTitle";
import { OperationalRowActions } from "@/components/OperationalRowActions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/UserAvatar";
import { DetailPageHeader } from "@/components/DetailPageHeader";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { PencilIcon, ImageIcon, RefreshCw, Star, ChevronRight } from "lucide-react";
import { useCurrentUser } from "@/hooks/use-current-user";

import type { AssetDetail } from "../types";
import { getAttachmentKind, getSdCardSlotLabel } from "@/lib/asset-attachments";
import { isOptimizableAssetImageSrc, normalizeAssetImageSrc } from "@/lib/asset-image";

/* ── Status Line ────────────────────────────────────────── */

function StatusLine({ asset }: { asset: AssetDetail }) {
  const s = asset.computedStatus;
  const b = asset.activeBooking;

  if (s === "AVAILABLE") return <Badge variant="green" className="px-2.5 py-1 text-xs">Available</Badge>;
  if (s === "CHECKED_OUT" && b) {
    const href = `/checkouts/${b.id}`;
    const isOverdue = new Date(b.endsAt) < new Date();
    const label = isOverdue ? "Overdue" : "Checked Out";
    return (
      <Badge variant={isOverdue ? "red" : "blue"} className="gap-1 px-1.5 py-1 pr-2 text-xs" asChild>
        <Link href={href} className="no-underline" title={`${label} by ${b.requesterName}`}>
          <UserAvatar name={b.requesterName} avatarUrl={b.requesterAvatarUrl} size="xs" />
          {label}
        </Link>
      </Badge>
    );
  }
  if (s === "PENDING_PICKUP" && b) {
    const href = b.kind === "RESERVATION" ? `/reservations/${b.id}` : `/checkouts/${b.id}`;
    return (
      <Badge variant="orange" className="gap-1 px-1.5 py-1 pr-2 text-xs" asChild>
        <Link href={href} className="no-underline" title={`Pending Pickup by ${b.requesterName}`}>
          <UserAvatar name={b.requesterName} avatarUrl={b.requesterAvatarUrl} size="xs" />
          Pending Pickup
        </Link>
      </Badge>
    );
  }
  if (s === "RESERVED" && b) {
    return (
      <Badge variant="purple" className="gap-1 px-1.5 py-1 pr-2 text-xs" asChild>
        <Link href={`/reservations/${b.id}`} className="no-underline" title={`Reserved by ${b.requesterName}`}>
          <UserAvatar name={b.requesterName} avatarUrl={b.requesterAvatarUrl} size="xs" />
          Reserved
        </Link>
      </Badge>
    );
  }
  if (s === "MAINTENANCE") return <Badge variant="orange" className="px-2.5 py-1 text-xs">Needs maintenance</Badge>;
  if (s === "RETIRED") return <Badge variant="gray" className="px-2.5 py-1 text-xs">Retired</Badge>;
  return <Badge variant="gray" className="px-2.5 py-1 text-xs">{s}</Badge>;
}

/* ── Actions Dropdown ───────────────────────────────────── */

function ActionsMenu({
  asset,
  disabled,
  onAction,
}: {
  asset: AssetDetail;
  disabled?: boolean;
  onAction: (action: string) => void;
}) {
  return (
    <OperationalRowActions
      label={`Actions for ${asset.assetTag}`}
      triggerClassName="h-10 w-auto px-3 text-xs font-medium text-foreground"
      icon={<span>Actions</span>}
    >
      <DropdownMenuItem disabled={disabled} onSelect={() => onAction("duplicate")}>Duplicate</DropdownMenuItem>
      <DropdownMenuItem disabled={disabled} onSelect={() => onAction("print-label")}>Print label</DropdownMenuItem>
      <DropdownMenuItem disabled={disabled} onSelect={() => onAction("maintenance")}>
        {asset.status === "MAINTENANCE" ? "Clear Maintenance" : "Needs Maintenance"}
      </DropdownMenuItem>
      <DropdownMenuItem disabled={disabled} onSelect={() => onAction("retire")}>Retire</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        variant="destructive"
        disabled={disabled || asset.hasBookingHistory}
        title={asset.hasBookingHistory ? "Item has booking history. Use Retire instead." : "Permanently delete this item"}
        onSelect={() => onAction("delete")}
      >
        Delete
      </DropdownMenuItem>
    </OperationalRowActions>
  );
}

function includesLoose(haystack: string, needle: string) {
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const normalizedNeedle = normalize(needle);
  return normalizedNeedle.length > 0 && normalize(haystack).includes(normalizedNeedle);
}

/* ── Item Header ────────────────────────────────────────── */

type ItemHeaderProps = {
  asset: AssetDetail;
  canEdit: boolean;
  refreshing: boolean;
  actionBusy: boolean;
  lastRefreshed: Date | null;
  onRefresh: () => void;
  onToggleFavorite: () => void;
  onSaveHeaderField: (field: string, value: string) => Promise<void>;
  onAction: (action: string) => void;
  onImageModalOpen: () => void;
};

export function ItemHeader({
  asset,
  canEdit,
  refreshing,
  actionBusy,
  lastRefreshed,
  onRefresh,
  onToggleFavorite,
  onSaveHeaderField,
  onAction,
  onImageModalOpen,
}: ItemHeaderProps) {
  const attachmentKind = asset.parentAsset ? getAttachmentKind(asset) : null;
  const slotLabel = asset.parentAsset ? getSdCardSlotLabel(asset, asset.parentAsset.assetTag) : null;
  const [imageFailed, setImageFailed] = useState(false);
  const { data: currentUser } = useCurrentUser();
  const imageSrc = normalizeAssetImageSrc(asset.imageUrl);
  const isRetired = asset.computedStatus === "RETIRED";
  const isMaintenance = asset.computedStatus === "MAINTENANCE";
  // A new reservation can only start when the item's derived status is AVAILABLE.
  // The item policy flag enables the workflow; current status decides whether a
  // reservation can actually begin.
  // This mirrors server-side booking validation in availability.ts so the
  // header never sends staff into a flow that is rejected at submit time.
  const isAvailable = asset.computedStatus === "AVAILABLE";
  const canCreateReservation = currentUser != null && (
    currentUser.role !== "COLLABORATOR" || currentUser.capabilities?.includes("RESERVATION_CREATE") === true
  );
  const canReserve = canCreateReservation && asset.availableForReservation && isAvailable;
  const reserveDisabledTitle = !canCreateReservation
    ? "Your account cannot create reservations"
    : isRetired
    ? "Retired items cannot be reserved"
    : isMaintenance
      ? "Maintenance items cannot be reserved"
      : "Reservations are disabled for this item";
  const activeBookingHref = asset.activeBooking
    ? asset.activeBooking.kind === "RESERVATION"
      ? `/reservations/${asset.activeBooking.id}`
      : `/checkouts/${asset.activeBooking.id}`
    : null;
  const activeBookingLabel = asset.activeBooking
    ? asset.computedStatus === "PENDING_PICKUP"
      ? "Open pending pickup"
      : asset.activeBooking.kind === "RESERVATION"
        ? "Open reservation"
        : "Open checkout"
    : null;
  const brandModel = [asset.brand, asset.model].filter(Boolean).join(" ");
  const productLabel = asset.name || brandModel;
  const showBrandModel =
    brandModel &&
    asset.name &&
    !includesLoose(asset.name, asset.brand) &&
    !includesLoose(asset.name, asset.model);
  const metaParts = [
    asset.location?.name,
    asset.category?.name,
    asset.department?.name,
  ].filter(Boolean);
  const updatedAt = asset.updatedAt ? new Date(asset.updatedAt) : null;
  const updatedLabel = updatedAt
    ? `Updated ${updatedAt.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })} at ${updatedAt.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      })}`
    : null;

  useEffect(() => {
    setImageFailed(false);
  }, [imageSrc]);

  return (
    <>
      <DetailPageHeader
        media={
          <>
            {imageSrc && !imageFailed ? (
              <button
                className={`relative flex size-[88px] items-center justify-center overflow-hidden rounded-md border border-border bg-muted shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:size-[96px] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)] ${canEdit ? "cursor-pointer active:scale-[0.96]" : "cursor-default"} group transition-[border-color,background-color,box-shadow,transform]`}
                onClick={() => canEdit && onImageModalOpen()}
                title={canEdit ? "Change image" : undefined}
                aria-label={canEdit ? `Change image for ${asset.assetTag}` : `Image of ${asset.assetTag}`}
              >
                <Image
                  src={imageSrc}
                  alt={asset.assetTag}
                  width={208}
                  height={208}
                  sizes="104px"
                  priority
                  className="aspect-square object-cover"
                  unoptimized={!isOptimizableAssetImageSrc(imageSrc)}
                  onError={() => setImageFailed(true)}
                />
                {canEdit && (
                  <div className="absolute inset-0 bg-black/45 flex items-center justify-center opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity text-white">
                    <PencilIcon className="size-4" />
                  </div>
                )}
              </button>
            ) : canEdit ? (
              <button
                className="group relative flex size-[88px] cursor-pointer items-center justify-center rounded-md border border-dashed border-border bg-muted/40 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)] outline-none transition-[border-color,background-color,box-shadow,transform] hover:border-[var(--wi-red)]/50 hover:bg-[var(--wi-red)]/5 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.96] sm:size-[96px] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
                onClick={onImageModalOpen}
                title="Add image"
                aria-label="Add image"
              >
                <ImageIcon className="size-5 text-muted-foreground/40 group-hover:text-muted-foreground/70 group-focus-visible:text-muted-foreground/70 transition-colors" />
              </button>
            ) : (
              <div className="flex size-[88px] items-center justify-center rounded-md border border-border bg-muted/20 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)] sm:size-[96px] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
                <ImageIcon className="size-5 text-muted-foreground/25" />
              </div>
            )}
          </>
        }
        status={<StatusLine asset={asset} />}
        title={
          <span className="flex items-baseline gap-2.5">
            <InlineTitle
              value={asset.assetTag}
              canEdit={false}
              onSave={(v) => onSaveHeaderField("assetTag", v)}
            />
            {asset.metadata?.uwAssetTag && (
              <span
                className="text-[11px] font-normal tabular-nums tracking-normal text-muted-foreground"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                UW·{asset.metadata.uwAssetTag}
              </span>
            )}
          </span>
        }
        subtitle={
          <InlineTitle
            value={productLabel}
            canEdit={false}
            onSave={(v) => onSaveHeaderField("name", v)}
            className="text-pretty font-medium leading-tight"
            placeholder="Add item name"
          />
        }
        meta={
          <>
            {showBrandModel && (
              <p className="text-[12px] leading-none text-muted-foreground">
                {brandModel}
              </p>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
              {metaParts.map((part, index) => (
                <span key={part} className="inline-flex items-center gap-2">
                  {index > 0 && (
                    <span aria-hidden="true" className="text-muted-foreground/30">
                      /
                    </span>
                  )}
                  <span>{part}</span>
                </span>
              ))}
            </div>
          </>
        }
        actions={
          <div className="flex flex-col gap-2 lg:min-w-[270px] lg:items-end">
            <div className="flex flex-wrap items-center gap-1.5 lg:justify-end">
              {activeBookingHref && activeBookingLabel && (
                <Button variant="default" className="h-10" asChild>
                  <Link href={activeBookingHref}>{activeBookingLabel}</Link>
                </Button>
              )}
              {canReserve ? (
                <Button variant={activeBookingHref ? "outline" : "default"} className="h-10" asChild>
                  <Link href={`/reservations?newFor=${asset.id}`}>Reserve</Link>
                </Button>
              ) : (
                <Button variant="outline" className="h-10" disabled title={reserveDisabledTitle}>
                  Reserve
                </Button>
              )}
              {canEdit && <ActionsMenu asset={asset} disabled={actionBusy} onAction={onAction} />}
            </div>

            <div className="flex items-center gap-1 text-[11px] leading-none text-muted-foreground lg:justify-end">
              {updatedLabel && (
                <span className="hidden sm:inline">
                  {updatedLabel}
                </span>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="size-10 active:scale-[0.96] transition-[background-color,color,box-shadow,transform]"
                onClick={onRefresh}
                disabled={refreshing || actionBusy}
                aria-label={
                  lastRefreshed
                    ? `Refresh. Last refreshed ${lastRefreshed.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
                    : "Refresh"
                }
              >
                <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
              </Button>

              <Button
                variant="ghost"
                size="icon"
                className="size-10 active:scale-[0.96] transition-[background-color,color,box-shadow,transform]"
                onClick={onToggleFavorite}
                disabled={actionBusy}
                aria-label={asset.isFavorited ? "Remove from favorites" : "Add to favorites"}
              >
                <Star
                  className={`size-3.5 ${
                    asset.isFavorited ? "fill-[var(--yellow-text)] text-[var(--yellow-text)]" : "text-muted-foreground"
                  }`}
                />
              </Button>
            </div>
          </div>
        }
      />

      {/* ── Parent banner ─────────────────────────────────────── */}
      {asset.parentAsset && (
        <div className="mb-3 rounded-lg border bg-muted/30 px-3 py-2 flex items-center gap-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Attached to
          </span>
          <ChevronRight className="size-3 text-muted-foreground/30" />
          <Link
            href={`/items/${asset.parentAsset.id}`}
            className="text-[12px] font-semibold hover:underline"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            {asset.parentAsset.assetTag}
          </Link>
          {slotLabel && <Badge variant="blue" size="sm">{slotLabel}</Badge>}
          {attachmentKind && !slotLabel && (
            <Badge variant={attachmentKind === "camera-rig" ? "purple" : "gray"} size="sm">
              Attachment
            </Badge>
          )}
          {(asset.parentAsset.brand || asset.parentAsset.model) && (
            <span className="text-[12px] text-muted-foreground">
              · {[asset.parentAsset.brand, asset.parentAsset.model].filter(Boolean).join(" ")}
            </span>
          )}
        </div>
      )}
    </>
  );
}
