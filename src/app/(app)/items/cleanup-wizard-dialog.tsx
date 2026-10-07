"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Link2, Package, QrCode, RotateCcw, ScanLine } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { FormCombobox } from "@/components/FormCombobox";
import { AssetImage } from "@/components/AssetImage";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import type { CleanupWizardItem, CleanupWizardKind } from "@/lib/services/item-cleanup-wizard";

type Stage = "pick" | "ask" | "enter" | "done";
type Answer = "yes" | "no" | null;

type Counts = {
  legacy_qr: number;
  missing_serial: number;
  attachment_candidate: number;
  deferred: {
    legacy_qr: number;
    missing_serial: number;
    attachment_candidate: number;
  };
};

type ParentSearchHit = {
  id: string;
  assetTag: string;
  brand?: string | null;
  model?: string | null;
  name?: string | null;
  parentAssetId?: string | null;
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialKind?: CleanupWizardKind | null;
  onChanged?: () => void;
}

const KIND_META: Record<
  CleanupWizardKind,
  {
    title: string;
    blurb: string;
    icon: typeof QrCode;
    yesLabel: string;
    noLabel: string;
    deferReason: "no_printed_qr" | "no_serial" | "keep_standalone";
  }
> = {
  legacy_qr: {
    title: "Legacy QR labels",
    blurb: "Shelf codes like E1-041 still sit in scan fields. Confirm whether a printed QR exists.",
    icon: QrCode,
    yesLabel: "Yes — enter the printed QR",
    noLabel: "No printed QR — keep shelf label for now",
    deferReason: "no_printed_qr",
  },
  missing_serial: {
    title: "Missing serial numbers",
    blurb: "Active items with no serial on file. Read it from the gear when you can.",
    icon: ScanLine,
    yesLabel: "Yes — enter the serial",
    noLabel: "No readable serial on this gear",
    deferReason: "no_serial",
  },
  attachment_candidate: {
    title: "Attachment parents",
    blurb: "Cages, plates, caps, and grips that may belong under a camera or lens.",
    icon: Link2,
    yesLabel: "Yes — pick the parent item",
    noLabel: "Keep standalone — staff checks it out alone",
    deferReason: "keep_standalone",
  },
};

function parentOptionLabel(parent: {
  assetTag: string;
  brand?: string | null;
  model?: string | null;
  reason?: string;
}) {
  const product = [parent.brand, parent.model].filter(Boolean).join(" ");
  const base = product ? `${parent.assetTag} · ${product}` : parent.assetTag;
  return parent.reason ? `${base} (${parent.reason})` : base;
}

export function CleanupWizardDialog({ open, onOpenChange, initialKind = null, onChanged }: Props) {
  const [stage, setStage] = useState<Stage>("pick");
  const [kind, setKind] = useState<CleanupWizardKind | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [countError, setCountError] = useState<string | null>(null);
  const [queue, setQueue] = useState<CleanupWizardItem[]>([]);
  const [item, setItem] = useState<CleanupWizardItem | null>(null);
  const [answer, setAnswer] = useState<Answer>(null);
  const [value, setValue] = useState("");
  const [parentId, setParentId] = useState("");
  const [parentSearch, setParentSearch] = useState("");
  const [parentSearchHits, setParentSearchHits] = useState<ParentSearchHit[]>([]);
  const [parentSearching, setParentSearching] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fixed, setFixed] = useState(0);
  const [deferred, setDeferred] = useState(0);
  const [skipped, setSkipped] = useState(0);

  const resetSession = useCallback(() => {
    setStage("pick");
    setKind(null);
    setQueue([]);
    setItem(null);
    setAnswer(null);
    setValue("");
    setParentId("");
    setParentSearch("");
    setParentSearchHits([]);
    setLoading(false);
    setSaving(false);
    setLoadError(null);
    setSaveError(null);
    setFixed(0);
    setDeferred(0);
    setSkipped(0);
  }, []);

  const loadCounts = useCallback(async () => {
    setCountError(null);
    try {
      const res = await fetch("/api/items/cleanup-wizard");
      if (handleAuthRedirect(res)) return;
      if (!res.ok) throw new Error(await parseErrorMessage(res, "Could not count cleanup queues"));
      const json = await parseJsonSafely<{ data?: { counts?: Counts } }>(res);
      if (!json?.data?.counts) throw new Error("Could not read cleanup counts");
      setCounts(json.data.counts);
    } catch (err) {
      setCounts(null);
      setCountError(err instanceof Error ? err.message : "Could not count cleanup queues");
    }
  }, []);

  useEffect(() => {
    if (!open) {
      resetSession();
      return;
    }
    void loadCounts();
  }, [loadCounts, open, resetSession]);

  const loadNext = useCallback(async (nextKind: CleanupWizardKind, remaining: CleanupWizardItem[] = []) => {
    if (remaining.length > 0) {
      setQueue(remaining);
      setItem(remaining[0] ?? null);
      setAnswer(null);
      setValue("");
      setParentId("");
      setParentSearch("");
      setParentSearchHits([]);
      setSaveError(null);
      setStage("ask");
      return;
    }

    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/items/cleanup-wizard?kind=${nextKind}&limit=8`);
      if (handleAuthRedirect(res)) return;
      if (!res.ok) throw new Error(await parseErrorMessage(res, "Could not load the next items"));
      const json = await parseJsonSafely<{ data?: { items?: CleanupWizardItem[]; counts?: Counts } }>(res);
      if (!json?.data || !Array.isArray(json.data.items)) {
        throw new Error("Could not read the cleanup queue");
      }
      if (json.data.counts) setCounts(json.data.counts);
      if (json.data.items.length === 0) {
        setQueue([]);
        setItem(null);
        setStage("done");
        return;
      }
      setQueue(json.data.items);
      setItem(json.data.items[0] ?? null);
      setAnswer(null);
      setValue("");
      setParentId("");
      setParentSearch("");
      setParentSearchHits([]);
      setStage("ask");
    } catch (err) {
      setQueue([]);
      setItem(null);
      setLoadError(err instanceof Error ? err.message : "Could not load the next items");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open || !initialKind || !counts) return;
    if (kind) return;
    if ((counts[initialKind] ?? 0) > 0) {
      setKind(initialKind);
      void loadNext(initialKind);
    }
  }, [counts, initialKind, kind, loadNext, open]);

  useEffect(() => {
    if (stage !== "enter" || kind !== "attachment_candidate") return;
    const query = parentSearch.trim();
    if (query.length < 2) {
      setParentSearchHits([]);
      setParentSearching(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setParentSearching(true);
      try {
        const res = await fetch(
          `/api/assets?q=${encodeURIComponent(query)}&limit=10&include_accessories=true`,
          { signal: controller.signal },
        );
        if (handleAuthRedirect(res)) return;
        if (!res.ok) {
          setParentSearchHits([]);
          return;
        }
        const json = await parseJsonSafely<{ data?: ParentSearchHit[] }>(res);
        const rows = Array.isArray(json?.data) ? json.data : [];
        setParentSearchHits(
          rows.filter((row) => row.id !== item?.id && !row.parentAssetId).slice(0, 8),
        );
      } catch {
        if (!controller.signal.aborted) setParentSearchHits([]);
      } finally {
        if (!controller.signal.aborted) setParentSearching(false);
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [item?.id, kind, parentSearch, stage]);

  const parentOptions = useMemo(() => {
    const byId = new Map<string, { value: string; label: string }>();
    for (const parent of item?.suggestedParents ?? []) {
      byId.set(parent.id, {
        value: parent.id,
        label: parentOptionLabel(parent),
      });
    }
    for (const hit of parentSearchHits) {
      if (byId.has(hit.id)) continue;
      byId.set(hit.id, {
        value: hit.id,
        label: parentOptionLabel(hit),
      });
    }
    return [...byId.values()];
  }, [item?.suggestedParents, parentSearchHits]);

  const startKind = useCallback((nextKind: CleanupWizardKind) => {
    setKind(nextKind);
    setFixed(0);
    setDeferred(0);
    setSkipped(0);
    void loadNext(nextKind);
  }, [loadNext]);

  const advance = useCallback((nextKind: CleanupWizardKind, rest: CleanupWizardItem[]) => {
    void loadNext(nextKind, rest);
  }, [loadNext]);

  const handleSkip = useCallback(() => {
    if (!kind || !item) return;
    setSkipped((value) => value + 1);
    advance(kind, queue.slice(1));
  }, [advance, item, kind, queue]);

  const handleDefer = useCallback(async () => {
    if (!kind || !item) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/items/cleanup-wizard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "defer",
          assetId: item.id,
          kind,
          reason: KIND_META[kind].deferReason,
        }),
      });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) throw new Error(await parseErrorMessage(res, "Could not defer this item"));
      const json = await parseJsonSafely<{ data?: { counts?: Counts } }>(res);
      if (json?.data?.counts) setCounts(json.data.counts);
      setDeferred((value) => value + 1);
      onChanged?.();
      advance(kind, queue.slice(1));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not defer this item";
      setSaveError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }, [advance, item, kind, onChanged, queue]);

  const handleSave = useCallback(async () => {
    if (!kind || !item) return;
    if (kind === "attachment_candidate" && !parentId) return;
    if (kind !== "attachment_candidate" && !value.trim()) return;

    setSaving(true);
    setSaveError(null);
    try {
      const body =
        kind === "legacy_qr"
          ? { action: "set_qr" as const, assetId: item.id, code: value.trim() }
          : kind === "missing_serial"
            ? { action: "set_serial" as const, assetId: item.id, serialNumber: value.trim() }
            : { action: "attach" as const, assetId: item.id, parentAssetId: parentId };
      const res = await fetch("/api/items/cleanup-wizard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) throw new Error(await parseErrorMessage(res, "Could not save"));
      const json = await parseJsonSafely<{ data?: { counts?: Counts } }>(res);
      if (json?.data?.counts) setCounts(json.data.counts);
      setFixed((n) => n + 1);
      onChanged?.();
      toast.success(
        kind === "legacy_qr"
          ? "QR updated"
          : kind === "missing_serial"
            ? "Serial saved"
            : "Attached to parent",
      );
      advance(kind, queue.slice(1));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not save";
      setSaveError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }, [advance, item, kind, onChanged, parentId, queue, value]);

  const meta = kind ? KIND_META[kind] : null;
  const canSave =
    kind === "attachment_candidate" ? Boolean(parentId) : Boolean(value.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        {stage === "pick" && (
          <>
            <DialogHeader>
              <DialogTitle>Cleanup wizard</DialogTitle>
              <DialogDescription>
                Find catalog rows that need a shelf check. Answer one question per item, then save or defer.
              </DialogDescription>
            </DialogHeader>

            {countError && (
              <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                <span className="flex min-w-0 items-center gap-2">
                  <AlertCircle className="size-4 shrink-0" />
                  <span className="truncate">{countError}</span>
                </span>
                <Button className="h-10" variant="outline" onClick={loadCounts}>
                  <RotateCcw className="size-3.5" />
                  Retry
                </Button>
              </div>
            )}

            <div className="mt-1 grid gap-2 sm:grid-cols-2">
              {(Object.keys(KIND_META) as CleanupWizardKind[]).map((queueKind) => {
                const info = KIND_META[queueKind];
                const Icon = info.icon;
                const count = counts?.[queueKind];
                const isLoading = counts === null;
                const isEmpty = count === 0;
                return (
                  <Button
                    key={queueKind}
                    type="button"
                    variant="outline"
                    onClick={() => (!isEmpty && !isLoading ? startKind(queueKind) : undefined)}
                    disabled={isLoading || isEmpty || !!countError}
                    className="h-auto justify-start gap-3 rounded-md p-4 text-left active:scale-[0.96] transition-transform"
                  >
                    <Icon className="size-5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="block text-sm font-medium">{info.title}</span>
                        {!isLoading && !isEmpty && <Badge variant="secondary">{count}</Badge>}
                      </span>
                      <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                        {isLoading
                          ? "Counting..."
                          : isEmpty
                            ? "Queue clear"
                            : `${count} to review`}
                      </span>
                    </span>
                  </Button>
                );
              })}
            </div>
            {counts && (
              counts.deferred.legacy_qr > 0
              || counts.deferred.missing_serial > 0
              || counts.deferred.attachment_candidate > 0
            ) && (
              <p className="text-xs text-muted-foreground">
                Deferred for later: {counts.deferred.legacy_qr} QR, {counts.deferred.missing_serial} serial,{" "}
                {counts.deferred.attachment_candidate} attachment.
              </p>
            )}
          </>
        )}

        {(stage === "ask" || stage === "enter") && meta && (
          <>
            <DialogHeader>
              <DialogTitle>{meta.title}</DialogTitle>
              <DialogDescription>
                {loading
                  ? "Loading..."
                  : `${fixed} fixed · ${deferred} deferred · ${skipped} skipped this session`}
              </DialogDescription>
            </DialogHeader>

            {loadError ? (
              <div className="flex flex-col gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4">
                <div className="flex items-start gap-2 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  <div>
                    <div className="font-medium">Could not load the next item</div>
                    <div className="mt-0.5 text-xs opacity-90">{loadError}</div>
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={resetSession}>Back</Button>
                  <Button onClick={() => kind && loadNext(kind)}>
                    <RotateCcw className="size-3.5" />
                    Retry
                  </Button>
                </div>
              </div>
            ) : loading || !item ? (
              <div className="flex flex-col gap-4 py-3">
                <Skeleton className="h-20 w-full rounded-md" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (
              <div className="flex flex-col gap-5 py-1">
                <div className="rounded-lg border bg-muted/20 p-3 shadow-xs">
                  <div className="flex items-start gap-3">
                    <ItemThumb item={item} />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold" style={{ fontFamily: "var(--font-heading)" }}>
                        {item.assetTag}
                      </div>
                      <div className="mt-1 truncate text-sm text-muted-foreground">
                        {[item.brand, item.model].filter(Boolean).join(" ") || item.name || "Untitled item"}
                      </div>
                      {item.locationName && (
                        <div className="mt-0.5 truncate text-xs text-muted-foreground">{item.locationName}</div>
                      )}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {kind === "legacy_qr" && (
                          <Badge variant="outline" className="h-5 px-1.5 font-mono text-[10px]">
                            {item.primaryScanCode || item.qrCodeValue}
                          </Badge>
                        )}
                        {kind === "missing_serial" && (
                          <Badge variant="outline" className="h-5 px-1.5 text-[10px] text-muted-foreground">
                            No serial on file
                          </Badge>
                        )}
                        {kind === "attachment_candidate" && (
                          <Badge variant="outline" className="h-5 px-1.5 text-[10px] text-muted-foreground">
                            No parent attached
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <p className="text-sm font-medium">{item.question}</p>
                  <p className="text-xs text-muted-foreground">{item.detail}</p>
                </div>

                {stage === "ask" && (
                  <div className="grid gap-2">
                    <Button
                      className="h-11 justify-start"
                      onClick={() => {
                        setAnswer("yes");
                        setStage("enter");
                        setValue("");
                        setParentId(item.suggestedParents?.[0]?.id ?? "");
                        setParentSearch("");
                        setParentSearchHits([]);
                        setSaveError(null);
                      }}
                      disabled={saving}
                    >
                      {meta.yesLabel}
                    </Button>
                    <Button
                      variant="outline"
                      className="h-11 justify-start"
                      onClick={() => void handleDefer()}
                      disabled={saving}
                    >
                      {meta.noLabel}
                    </Button>
                  </div>
                )}

                {stage === "enter" && answer === "yes" && kind !== "attachment_candidate" && (
                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-medium" htmlFor="cleanup-wizard-value">
                      {kind === "legacy_qr" ? "Printed QR / scan code" : "Serial number"}
                    </label>
                    <Input
                      id="cleanup-wizard-value"
                      value={value}
                      onChange={(event) => setValue(event.target.value)}
                      autoFocus
                      className="h-11 font-mono"
                      placeholder={kind === "legacy_qr" ? "Scan or type the code" : "Serial from the plate"}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && value.trim()) void handleSave();
                      }}
                    />
                    {saveError && (
                      <div className="flex items-center gap-1.5 text-xs text-destructive">
                        <AlertCircle className="size-3.5" />
                        {saveError}
                      </div>
                    )}
                  </div>
                )}

                {stage === "enter" && answer === "yes" && kind === "attachment_candidate" && (
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-2">
                      <label className="text-sm font-medium" htmlFor="cleanup-wizard-parent">
                        Parent item
                      </label>
                      <FormCombobox
                        id="cleanup-wizard-parent"
                        value={parentId}
                        onValueChange={setParentId}
                        options={parentOptions}
                        placeholder="Select a parent"
                        searchPlaceholder="Filter suggestions..."
                        emptyLabel="No parents in this list. Search below."
                        triggerClassName="h-11"
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="text-sm font-medium" htmlFor="cleanup-wizard-parent-search">
                        Search other parents
                      </label>
                      <Input
                        id="cleanup-wizard-parent-search"
                        value={parentSearch}
                        onChange={(event) => setParentSearch(event.target.value)}
                        className="h-11"
                        placeholder="Type an asset tag or name"
                      />
                      <p className="text-xs text-muted-foreground">
                        {parentSearching
                          ? "Searching..."
                          : parentSearch.trim().length < 2
                            ? "Type at least 2 characters to search the catalog."
                            : parentSearchHits.length === 0
                              ? "No additional parents found."
                              : `${parentSearchHits.length} added to the list above.`}
                      </p>
                    </div>
                    {saveError && (
                      <div className="flex items-center gap-1.5 text-xs text-destructive">
                        <AlertCircle className="size-3.5" />
                        {saveError}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex items-center justify-between gap-2 pt-1">
                  <Button variant="ghost" onClick={handleSkip} disabled={saving}>
                    Skip for now
                  </Button>
                  <div className="flex gap-2">
                    {stage === "enter" ? (
                      <>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setStage("ask");
                            setAnswer(null);
                            setValue("");
                            setParentId("");
                            setParentSearch("");
                            setParentSearchHits([]);
                            setSaveError(null);
                          }}
                          disabled={saving}
                        >
                          Back
                        </Button>
                        <Button onClick={() => void handleSave()} disabled={!canSave || saving}>
                          {kind === "attachment_candidate" ? "Attach" : "Save"}
                        </Button>
                      </>
                    ) : (
                      <Button variant="outline" onClick={() => setStage("done")} disabled={saving}>
                        Stop
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {stage === "done" && (
          <>
            <DialogHeader>
              <DialogTitle>Queue clear for now</DialogTitle>
              <DialogDescription>
                {fixed} fixed · {deferred} deferred · {skipped} skipped this session.
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={resetSession}>
                Pick another queue
              </Button>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ItemThumb({ item }: { item: CleanupWizardItem }) {
  if (item.imageUrl) {
    return <AssetImage src={item.imageUrl} alt="" size={56} className="shrink-0 rounded-md" />;
  }
  return (
    <div className="flex size-14 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
      <Package className="size-5" aria-hidden="true" />
    </div>
  );
}
