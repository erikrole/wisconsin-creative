"use client";

import { useEffect, useMemo, useState, type ComponentType } from "react";
import { toast } from "sonner";
import { Award, BadgeCheck, Flame, Handshake, PackageCheck, ShieldCheck, Trophy, UserCheck, UsersRound } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { customBadgeIconOptions, formatBadgeCategoryLabel, type CustomBadgeIcon } from "@/lib/badges/display";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import type { UserDirectoryFilters } from "@/lib/user-directory-query";
import { cn } from "@/lib/utils";

type BadgeDefinition = {
  id: string;
  key: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  kind: string;
  trigger: string;
  threshold: number | null;
};

type BulkAwardResult = {
  userId: string;
  name: string;
  status: "awarded" | "skipped" | "failed";
  reason?: string;
};

export type BulkAwardResponse = {
  definitionId: string | null;
  requested: number;
  awarded: number;
  skipped: number;
  failed: number;
  results: BulkAwardResult[];
};

type ApiEnvelope<T> = {
  data?: T;
  error?: string;
};

type IconComponent = ComponentType<{ className?: string }>;

const customIconMap: Record<CustomBadgeIcon, IconComponent> = {
  Trophy,
  BadgeCheck,
  ShieldCheck,
  UserCheck,
  Handshake,
  Flame,
  PackageCheck,
};

export type BulkBadgeAwardDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetCount: number;
  filterSummary: string;
  filters: UserDirectoryFilters;
};

function countLabel(count: number) {
  return `${count} active ${count === 1 ? "user" : "users"}`;
}

export default function BulkBadgeAwardDialog({
  open,
  onOpenChange,
  targetCount,
  filterSummary,
  filters,
}: BulkBadgeAwardDialogProps) {
  const [definitions, setDefinitions] = useState<BadgeDefinition[]>([]);
  const [definitionsLoading, setDefinitionsLoading] = useState(false);
  const [definitionsError, setDefinitionsError] = useState<string | null>(null);
  const [awardMode, setAwardMode] = useState<"existing" | "custom">("existing");
  const [selectedDefinitionId, setSelectedDefinitionId] = useState("");
  const [customName, setCustomName] = useState("");
  const [customDescription, setCustomDescription] = useState("");
  const [customIcon, setCustomIcon] = useState<CustomBadgeIcon>("Trophy");
  const [note, setNote] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkAwardResponse | null>(null);

  useEffect(() => {
    if (!open) return;

    const controller = new AbortController();
    setDefinitionsLoading(true);
    setDefinitionsError(null);
    setError(null);
    setResult(null);
    setConfirmOpen(false);
    setAwardMode("existing");
    setSelectedDefinitionId("");
    setCustomName("");
    setCustomDescription("");
    setCustomIcon("Trophy");
    setNote("");

    void (async () => {
      try {
        const response = await fetch("/api/badges?manualOnly=true", { signal: controller.signal });
        if (handleAuthRedirect(response)) return;
        if (!response.ok) {
          setDefinitionsError(await parseErrorMessage(response, "Could not load manual badges"));
          return;
        }
        const json = await parseJsonSafely<ApiEnvelope<BadgeDefinition[]>>(response);
        const nextDefinitions = json?.data ?? [];
        setDefinitions(nextDefinitions);
        setSelectedDefinitionId(nextDefinitions[0]?.id ?? "");
        if (nextDefinitions.length === 0) setAwardMode("custom");
      } catch (fetchError) {
        if (fetchError instanceof DOMException && fetchError.name === "AbortError") return;
        setDefinitionsError("Could not load manual badges");
      } finally {
        if (!controller.signal.aborted) setDefinitionsLoading(false);
      }
    })();

    return () => controller.abort();
  }, [open]);

  const selectedDefinition = useMemo(
    () => definitions.find((definition) => definition.id === selectedDefinitionId) ?? null,
    [definitions, selectedDefinitionId],
  );
  const awardName = awardMode === "existing" ? selectedDefinition?.name ?? "" : customName.trim();
  const awardDescription = awardMode === "existing"
    ? selectedDefinition?.description ?? ""
    : customDescription.trim();

  function handleDialogOpenChange(nextOpen: boolean) {
    if (busy) return;
    if (!nextOpen) setConfirmOpen(false);
    onOpenChange(nextOpen);
  }

  function handleReview() {
    setError(null);
    if (targetCount <= 0) {
      setError("No active users match the current filters.");
      return;
    }
    if (awardMode === "existing" && !selectedDefinitionId) {
      setError("Choose a badge before continuing.");
      return;
    }
    if (awardMode === "custom" && (!customName.trim() || !customDescription.trim())) {
      setError("Enter a custom badge name and description before continuing.");
      return;
    }
    setConfirmOpen(true);
  }

  async function confirmAward() {
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/badges/award/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filters,
          definitionId: awardMode === "existing" ? selectedDefinitionId : undefined,
          customDefinition: awardMode === "custom" ? {
            name: customName.trim(),
            description: customDescription.trim(),
            icon: customIcon,
          } : undefined,
          note: note.trim() || undefined,
        }),
      });

      if (handleAuthRedirect(response)) return;
      if (!response.ok) {
        setError(await parseErrorMessage(response, "Could not award the badge"));
        return;
      }

      const json = await parseJsonSafely<ApiEnvelope<BulkAwardResponse>>(response);
      if (!json?.data) {
        setError("The server returned an incomplete award result.");
        return;
      }

      setResult(json.data);
      setConfirmOpen(false);
      if (json.data.awarded > 0) {
        toast.success(`${json.data.awarded} ${json.data.awarded === 1 ? "badge" : "badges"} awarded`);
      }
    } catch (requestError) {
      if (requestError instanceof DOMException && requestError.name === "AbortError") return;
      setError("Could not read the server response. Some awards may have completed; refresh the group before retrying.");
    } finally {
      setBusy(false);
    }
  }

  const problemResults = result?.results.filter((item) => item.status !== "awarded") ?? [];

  return (
    <>
      <Dialog open={open} onOpenChange={handleDialogOpenChange}>
        <DialogContent className="grid max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-lg">
          {result ? (
            <>
              <DialogHeader>
                <div>
                  <DialogTitle>Badge award complete</DialogTitle>
                  <DialogDescription className="mt-1">The server rechecked the group before awarding.</DialogDescription>
                </div>
              </DialogHeader>
              <DialogBody className="min-h-0 space-y-4 py-5">
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-lg border bg-muted/40 p-3 text-center">
                    <p className="text-xl font-semibold tabular-nums">{result.awarded}</p>
                    <p className="text-xs text-muted-foreground">Awarded</p>
                  </div>
                  <div className="rounded-lg border bg-muted/40 p-3 text-center">
                    <p className="text-xl font-semibold tabular-nums">{result.skipped}</p>
                    <p className="text-xs text-muted-foreground">Already had it</p>
                  </div>
                  <div className="rounded-lg border bg-muted/40 p-3 text-center">
                    <p className="text-xl font-semibold tabular-nums">{result.failed}</p>
                    <p className="text-xs text-muted-foreground">Failed</p>
                  </div>
                </div>
                {problemResults.length > 0 && (
                  <div className="rounded-lg border border-[var(--orange-text)]/25 bg-[var(--orange-bg)]/50 p-3 text-sm">
                    <p className="font-medium">Needs review</p>
                    <ul className="mt-2 space-y-1 text-muted-foreground">
                      {problemResults.slice(0, 12).map((item) => (
                        <li key={item.userId} className="flex justify-between gap-3">
                          <span className="truncate">{item.name}</span>
                          <span className="shrink-0 text-xs">{item.reason}</span>
                        </li>
                      ))}
                    </ul>
                    {problemResults.length > 12 && (
                      <p className="mt-2 text-xs text-muted-foreground">+ {problemResults.length - 12} more</p>
                    )}
                  </div>
                )}
                <p className="text-sm text-muted-foreground">
                  {result.requested} active {result.requested === 1 ? "user was" : "users were"} in the server-side group.
                </p>
              </DialogBody>
              <DialogFooter className="border-t pt-4">
                <Button type="button" onClick={() => onOpenChange(false)}>Done</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <div>
                  <DialogTitle>Award badge to matching users</DialogTitle>
                  <DialogDescription className="mt-1">
                    {countLabel(targetCount)} · {filterSummary}
                  </DialogDescription>
                </div>
              </DialogHeader>
              <DialogBody className="min-h-0 space-y-4 py-5">
                <Alert>
                  <UsersRound className="size-4" />
                  <AlertDescription>
                    This awards the same recognition to every active user matching the current Users filters. Inactive users are excluded.
                  </AlertDescription>
                </Alert>

                <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted p-1">
                  <Button
                    type="button"
                    variant={awardMode === "existing" ? "secondary" : "ghost"}
                    className="h-10"
                    onClick={() => setAwardMode("existing")}
                    disabled={busy || definitionsLoading || definitions.length === 0}
                  >
                    Existing
                  </Button>
                  <Button
                    type="button"
                    variant={awardMode === "custom" ? "secondary" : "ghost"}
                    className="h-10"
                    onClick={() => setAwardMode("custom")}
                    disabled={busy}
                  >
                    Custom
                  </Button>
                </div>

                {definitionsError && (
                  <Alert variant="destructive">
                    <Award className="size-4" />
                    <AlertDescription>{definitionsError}</AlertDescription>
                  </Alert>
                )}

                {awardMode === "existing" ? (
                  <div className="grid gap-2">
                    <label htmlFor="bulk-badge-definition" className="text-sm font-medium">Badge</label>
                    <Select
                      value={selectedDefinitionId}
                      onValueChange={setSelectedDefinitionId}
                      disabled={definitionsLoading || busy || definitions.length === 0}
                    >
                      <SelectTrigger id="bulk-badge-definition">
                        <SelectValue placeholder={definitionsLoading ? "Loading badges..." : "Select a badge"} />
                      </SelectTrigger>
                      <SelectContent>
                        {definitions.map((definition) => (
                          <SelectItem key={definition.id} value={definition.id}>{definition.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {selectedDefinition && (
                      <div className="rounded-lg bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
                        <p>{selectedDefinition.description}</p>
                        <Badge variant="outline" size="sm" className="mt-2">{formatBadgeCategoryLabel(selectedDefinition.category)}</Badge>
                      </div>
                    )}
                    {!definitionsLoading && definitions.length === 0 && (
                      <p className="text-sm text-muted-foreground">No reusable manual badges are available. Use Custom instead.</p>
                    )}
                  </div>
                ) : (
                  <div className="grid gap-3">
                    <div className="grid gap-2">
                      <label htmlFor="bulk-custom-badge-name" className="text-sm font-medium">Badge name</label>
                      <Input
                        id="bulk-custom-badge-name"
                        value={customName}
                        onChange={(event) => setCustomName(event.target.value)}
                        placeholder="New crew MVP"
                        maxLength={80}
                        disabled={busy}
                      />
                    </div>
                    <div className="grid gap-2">
                      <label htmlFor="bulk-custom-badge-description" className="text-sm font-medium">Description</label>
                      <Input
                        id="bulk-custom-badge-description"
                        value={customDescription}
                        onChange={(event) => setCustomDescription(event.target.value)}
                        placeholder="Recognized for making the whole group better."
                        maxLength={180}
                        disabled={busy}
                      />
                    </div>
                    <div className="grid gap-2">
                      <span className="text-sm font-medium">Icon</span>
                      <div className="grid grid-cols-4 gap-2">
                        {customBadgeIconOptions.map((iconName) => {
                          const Icon = customIconMap[iconName];
                          const selected = customIcon === iconName;
                          return (
                            <Button
                              key={iconName}
                              type="button"
                              variant={selected ? "secondary" : "outline"}
                              className={cn("h-11", selected && "ring-2 ring-ring/30")}
                              onClick={() => setCustomIcon(iconName)}
                              aria-label={`Use ${iconName} icon`}
                              aria-pressed={selected}
                              disabled={busy}
                            >
                              <Icon className="size-4" />
                            </Button>
                          );
                        })}
                      </div>
                    </div>
                    <p className="text-xs leading-5 text-muted-foreground">The custom badge is saved to the active catalog for reuse.</p>
                  </div>
                )}

                <div className="grid gap-2">
                  <label htmlFor="bulk-badge-note" className="text-sm font-medium">
                    Note <span className="font-normal text-muted-foreground">(optional)</span>
                  </label>
                  <Textarea
                    id="bulk-badge-note"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="Why this group deserves this recognition..."
                    maxLength={500}
                    rows={3}
                    disabled={busy}
                  />
                </div>

                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
              </DialogBody>
              <DialogFooter className="border-t pt-4">
                <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
                <Button type="button" onClick={handleReview} disabled={busy || definitionsLoading || targetCount <= 0}>
                  Review award
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={(nextOpen) => { if (!busy) setConfirmOpen(nextOpen); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm group award</AlertDialogTitle>
            <AlertDialogDescription>
              Award <strong>{awardName || "this badge"}</strong> to {countLabel(targetCount)} matching {filterSummary.toLowerCase()}? The server will skip anyone who already has it.
              {awardDescription ? ` ${awardDescription}` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Go back</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void confirmAward();
              }}
              disabled={busy}
            >
              {busy ? <><Spinner /> Awarding…</> : `Award to ${targetCount} users`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
