"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useConfirm } from "@/components/ConfirmDialog";
import { AssetImage } from "@/components/AssetImage";
import { handleAuthRedirect, isAbortError, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import type { AssetDetail } from "./types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import EmptyState from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Link2, Loader2, MoveRight, Search, Unlink } from "lucide-react";
import {
  getAttachmentCandidateBlockedReason,
  getAttachmentCandidateState,
  getAttachmentDisplayName,
  getAttachmentStatusWarning,
  getSdCardSlotLabel,
  groupAttachments,
} from "@/lib/asset-attachments";
import { statusBadgeVariantEquipment, statusLabelEquipment } from "@/lib/status-colors";

type AttachmentDialogMode = "attach" | "move";

type AttachmentSearchResult = {
  id: string;
  assetTag: string;
  name: string | null;
  brand: string;
  model: string;
  type: string;
  status: string;
  computedStatus?: string | null;
  parentAssetId?: string | null;
  imageUrl: string | null;
  location?: { id: string; name: string } | null;
  category?: { id: string; name: string } | null;
};

/* ── Attachments Section ────────────────────────────────── */

export function AccessoriesSection({
  asset, canEdit, onRefresh,
}: {
  asset: AssetDetail;
  canEdit: boolean;
  onRefresh: () => void;
}) {
  const confirmDialog = useConfirm();
  const [dialogMode, setDialogMode] = useState<AttachmentDialogMode | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<AttachmentSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [pendingCandidateId, setPendingCandidateId] = useState<string | null>(null);
  const [detachingId, setDetachingId] = useState<string | null>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);

  // Clean up debounce timeout on unmount
  useEffect(() => () => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchAbortRef.current?.abort();
  }, []);

  // Is this item itself an attachment? If so, don't show the attach section.
  const isChild = !!asset.parentAsset;
  const attachments = asset.accessories ?? [];
  const attachmentGroups = groupAttachments(attachments);
  const attachedIds = new Set(attachments.map((a) => a.id));

  function closeAttachmentDialog() {
    searchAbortRef.current?.abort();
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    setDialogMode(null);
    setSearchQuery("");
    setSearchResults([]);
    setSearchError("");
    setSearching(false);
    setPendingCandidateId(null);
  }

  function openAttachmentDialog(mode: AttachmentDialogMode) {
    setDialogMode(mode);
    setSearchQuery("");
    setSearchResults([]);
    setSearchError("");
    setPendingCandidateId(null);
  }

  function handleSearch(q: string) {
    setSearchQuery(q);
    setSearchError("");
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchAbortRef.current?.abort();
    if (q.trim().length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    searchTimeout.current = setTimeout(async () => {
      const controller = new AbortController();
      searchAbortRef.current = controller;
      setSearching(true);
      try {
        const res = await fetch(`/api/assets?q=${encodeURIComponent(q.trim())}&limit=10&include_accessories=true`, {
          signal: controller.signal,
        });
        if (handleAuthRedirect(res)) return;
        if (res.ok) {
          const json = await parseJsonSafely<{ data?: AttachmentSearchResult[] }>(res);
          if (controller.signal.aborted) return;
          if (!Array.isArray(json?.data)) {
            setSearchResults([]);
            setSearchError("Search returned an unreadable response");
            return;
          }
          setSearchResults(
            json.data.slice(0, 8).map((a) => ({
              id: a.id,
              assetTag: a.assetTag,
              name: a.name,
              brand: a.brand,
              model: a.model,
              type: a.type,
              status: a.status,
              computedStatus: a.computedStatus,
              parentAssetId: a.parentAssetId,
              imageUrl: a.imageUrl,
              location: a.location,
              category: a.category,
            }))
          );
        } else {
          setSearchResults([]);
          setSearchError("Search failed");
        }
      } catch (err) {
        if (!isAbortError(err)) {
          setSearchResults([]);
          setSearchError("Search failed");
        }
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 300);
  }

  async function attachAccessory(childId: string) {
    setPendingCandidateId(childId);
    try {
      const res = await fetch(`/api/assets/${asset.id}/accessories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ childAssetId: childId }),
      });
      if (handleAuthRedirect(res)) return;
      if (res.ok) {
        toast.success("Attachment added");
        closeAttachmentDialog();
        onRefresh();
      } else {
        const msg = await parseErrorMessage(res, "Failed to attach");
        toast.error(msg);
      }
    } catch {
      toast.error("Network error");
    } finally {
      setPendingCandidateId(null);
    }
  }

  async function moveAttachment(newParentId: string) {
    setPendingCandidateId(newParentId);
    try {
      const res = await fetch(`/api/assets/${asset.id}/accessories`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newParentAssetId: newParentId }),
      });
      if (handleAuthRedirect(res)) return;
      if (res.ok) {
        toast.success("Attachment moved");
        closeAttachmentDialog();
        onRefresh();
      } else {
        const msg = await parseErrorMessage(res, "Failed to move attachment");
        toast.error(msg);
      }
    } catch {
      toast.error("Network error");
    } finally {
      setPendingCandidateId(null);
    }
  }

  async function detachAccessory(childId: string, childTag: string) {
    const ok = await confirmDialog({
      title: `Detach ${childTag}`,
      message: `Detach ${childTag} from ${asset.assetTag}? It will become a standalone item and can be reserved or checked out on its own again.`,
      confirmLabel: "Detach",
      variant: "danger",
    });
    if (!ok) return;
    setDetachingId(childId);
    try {
      const res = await fetch(`/api/assets/${childId}/accessories`, { method: "DELETE" });
      if (handleAuthRedirect(res)) return;
      if (res.ok) {
        toast.success("Attachment detached");
        onRefresh();
      } else {
        const msg = await parseErrorMessage(res, "Failed to detach");
        toast.error(msg);
      }
    } catch {
      toast.error("Network error");
    } finally {
      setDetachingId(null);
    }
  }

  const dialog = (
    <AttachmentPickerDialog
      mode={dialogMode}
      parentAssetTag={dialogMode === "move" ? asset.parentAsset?.assetTag ?? null : asset.assetTag}
      currentAssetTag={asset.assetTag}
      searchQuery={searchQuery}
      searchResults={searchResults}
      searching={searching}
      searchError={searchError}
      pendingCandidateId={pendingCandidateId}
      attachedIds={dialogMode === "move" && asset.parentAsset ? new Set([asset.parentAsset.id]) : attachedIds}
      blockedParentId={asset.id}
      onOpenChange={(open) => {
        if (!open) closeAttachmentDialog();
      }}
      onSearch={handleSearch}
      onCancel={closeAttachmentDialog}
      onSelect={(candidateId) => {
        if (dialogMode === "move") moveAttachment(candidateId);
        else attachAccessory(candidateId);
      }}
    />
  );

  // For items that are themselves attachments, show parent info
  if (isChild) {
    const slotLabel = getSdCardSlotLabel(asset, asset.parentAsset?.assetTag);
    return (
      <div className="mt-3.5 max-w-3xl">
        <Card className="border-border/40 shadow-none">
          <CardHeader>
            <div>
              <CardTitle>Attachment Relationship</CardTitle>
              <CardDescription>This item travels with a parent item and cannot own attachments.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="rounded-md bg-muted/40 px-4 py-3 text-sm">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Parent item</div>
              <div className="mt-1">
                <Link href={`/items/${asset.parentAsset!.id}`} className="text-primary hover:underline font-mono font-medium">
                  {asset.parentAsset!.assetTag}
                </Link>
                {slotLabel ? ` as ${slotLabel}` : ""}. It cannot have its own attachments.
              </div>
              {canEdit && (
                <Button
                  variant="outline"
                  className="h-10 mt-3 gap-1.5 active:scale-[0.96] transition-transform"
                  onClick={() => openAttachmentDialog("move")}
                >
                  <MoveRight className="size-3.5" aria-hidden="true" />
                  Move to another parent
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
        {dialog}
      </div>
    );
  }

  return (
    <div className="mt-3.5 max-w-4xl flex flex-col gap-3">
      <Card className="border-border/40 shadow-none">
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <CardTitle>Attachments</CardTitle>
              {attachments.length > 0 && (
                <Badge variant="gray" size="sm">{attachments.length}</Badge>
              )}
            </div>
            <CardDescription>Items physically tied to this asset, such as SD cards, cages, and fixed rigging.</CardDescription>
          </div>
          {canEdit && attachments.length > 0 && (
            <Button variant="outline" className="h-10 shrink-0 active:scale-[0.96] transition-transform" onClick={() => openAttachmentDialog("attach")}>
              <Link2 className="size-3.5" aria-hidden="true" />
              Add attachment
            </Button>
          )}
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {attachments.length === 0 && (
            <EmptyState
              inline
              icon="box"
              title="No attached items"
              description="Add fixed accessories only when they should travel with this item instead of being checked out on their own."
              actionLabel={canEdit ? "Add attachment" : undefined}
              onAction={canEdit ? () => openAttachmentDialog("attach") : undefined}
            />
          )}

          {attachments.length > 0 && (
            <div className="flex flex-col gap-5">
              {attachmentGroups.map((group) => (
                <section key={group.key} className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold">{group.label}</h3>
                    <Badge variant={group.key === "sd-card" ? "blue" : group.key === "camera-rig" ? "purple" : "gray"} size="sm">
                      {group.items.length}
                    </Badge>
                  </div>
                  <div className="overflow-hidden rounded-md border border-border/40 divide-y divide-border/30">
                    {group.items.map((acc) => {
                      const slotLabel = getSdCardSlotLabel(acc, asset.assetTag);
                      const displayName = getAttachmentDisplayName(acc);
                      return (
                        <div key={acc.id} className="flex min-h-16 items-center justify-between gap-3 px-3 py-2.5 transition-colors hover:bg-muted/35">
                          <div className="flex min-w-0 items-center gap-3">
                            <AssetImage
                              src={acc.imageUrl}
                              alt={displayName}
                              size={40}
                              className="rounded-md"
                            />
                            <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <Link href={`/items/${acc.id}`} className="text-sm font-medium hover:underline">
                                {displayName}
                              </Link>
                              {slotLabel && (
                                <Badge variant="blue" size="sm">{slotLabel}</Badge>
                              )}
                              <Badge variant={statusBadgeVariantEquipment(acc.status)} size="sm">
                                {statusLabelEquipment(acc.status)}
                              </Badge>
                            </div>
                            </div>
                          </div>
                          {canEdit && (
                            <Button
                              variant="ghost"
                              disabled={detachingId === acc.id}
                              onClick={() => detachAccessory(acc.id, displayName)}
                              title="Detach item"
                              className="h-10 shrink-0 text-muted-foreground hover:text-destructive active:scale-[0.96] transition-[color,transform]"
                            >
                              {detachingId === acc.id ? (
                                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                              ) : (
                                <Unlink className="size-3.5" aria-hidden="true" />
                              )}
                              {detachingId === acc.id ? "Detaching" : "Detach"}
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      {dialog}
    </div>
  );
}

function AttachmentPickerDialog({
  mode,
  parentAssetTag,
  currentAssetTag,
  searchQuery,
  searchResults,
  searching,
  searchError,
  pendingCandidateId,
  attachedIds,
  blockedParentId,
  onOpenChange,
  onSearch,
  onCancel,
  onSelect,
}: {
  mode: AttachmentDialogMode | null;
  parentAssetTag: string | null;
  currentAssetTag: string;
  searchQuery: string;
  searchResults: AttachmentSearchResult[];
  searching: boolean;
  searchError: string;
  pendingCandidateId: string | null;
  attachedIds: Set<string>;
  blockedParentId: string;
  onOpenChange: (open: boolean) => void;
  onSearch: (query: string) => void;
  onCancel: () => void;
  onSelect: (candidateId: string) => void;
}) {
  const open = mode !== null;
  const isMove = mode === "move";
  const title = isMove ? "Move attachment" : "Add attachment";
  const description = isMove
    ? `Choose the new parent item for ${currentAssetTag}. The attachment will travel with that parent instead.`
    : `Choose a standalone item to attach to ${parentAssetTag ?? currentAssetTag}. Attached items stay tracked but are hidden from normal booking flows.`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="pr-10">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </div>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3 py-0">
          <div className="relative">
            <Input
              type="text"
              placeholder={isMove ? "Search parent tag, name, brand, or model" : "Search asset tag, name, brand, or model"}
              value={searchQuery}
              onChange={(e) => onSearch(e.target.value)}
              className="h-10 pl-9"
              autoFocus
            />
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          </div>

          {searchQuery.trim().length < 2 && (
            <div className="rounded-md border border-dashed border-border/70 bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
              Search for the physical item by tag, name, brand, or model.
            </div>
          )}

          {searching && (
            <div className="flex min-h-24 items-center justify-center rounded-md border border-border/50 text-sm text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
              Searching items
            </div>
          )}

          {searchError && !searching && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {searchError}
            </div>
          )}

          {searchQuery.trim().length >= 2 && !searching && !searchError && searchResults.length === 0 && (
            <div className="rounded-md border border-border/50 bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
              No matching items found. Try the asset tag or a shorter product name.
            </div>
          )}

          {searchResults.length > 0 && !searching && (
            <div className="max-h-[420px] overflow-y-auto rounded-md border border-border/60 divide-y divide-border/40">
              {searchResults.map((candidate) => {
                const state = getAttachmentCandidateState(candidate, blockedParentId, attachedIds);
                const blockedReason = getAttachmentCandidateBlockedReason(state);
                const statusWarning = state === "available" ? getAttachmentStatusWarning(candidate) : null;
                const pending = pendingCandidateId === candidate.id;
                const status = candidate.computedStatus || candidate.status;
                const meta = [candidate.category?.name, candidate.location?.name].filter(Boolean).join(" · ");
                return (
                  <button
                    key={candidate.id}
                    type="button"
                    disabled={Boolean(blockedReason) || pendingCandidateId !== null}
                    className="flex min-h-[76px] w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/45 disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() => onSelect(candidate.id)}
                  >
                    <AssetImage
                      src={candidate.imageUrl}
                      alt={candidate.assetTag}
                      size={44}
                      className="rounded-md"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-sm font-semibold">{candidate.assetTag}</span>
                        <Badge variant={statusBadgeVariantEquipment(status)} size="sm">
                          {statusLabelEquipment(status)}
                        </Badge>
                        {blockedReason && <Badge variant="gray" size="sm">{blockedReason}</Badge>}
                      </div>
                      <div className="mt-1 truncate text-sm text-foreground/90">
                        {getAttachmentDisplayName(candidate)}
                      </div>
                      {meta && <div className="mt-0.5 truncate text-xs text-muted-foreground">{meta}</div>}
                      {statusWarning && (
                        <div className="mt-1 text-xs text-[var(--orange-text)]">{statusWarning}</div>
                      )}
                    </div>
                    <div className="flex h-10 min-w-10 items-center justify-center text-muted-foreground">
                      {pending ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      ) : state === "available" ? (
                        <CheckCircle2 className="size-4" aria-hidden="true" />
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} className="h-10 active:scale-[0.96] transition-transform">
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
