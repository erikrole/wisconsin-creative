"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Archive, ArrowRight, Download, Eye, EyeOff, FileCode2, FileImage, FilePenLine, FolderPen, Plus, RefreshCw, Trash2, UsersRound } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { OperationalRowActions } from "@/components/OperationalRowActions";
import { FadeUp } from "@/components/ui/motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from "@/components/ui/dropdown-menu";
import EmptyState from "@/components/EmptyState";
import { useFetch } from "@/hooks/use-fetch";
import { handleAuthRedirect, parseErrorMessage } from "@/lib/errors";
import { isCurrentDeviceIpad } from "@/lib/signatures/capture";
import { invalidateSignatureCollectionCaches } from "@/lib/signatures/client-cache";
import {
  DEFAULT_SIGNATURE_SEASON,
  SIGNATURE_AD_HOC_SPORT_CODE,
  SIGNATURE_CREATIVE_STAFF_SPORT_CODE,
  SIGNATURE_IMPORTED_SPORT_CODES,
  SIGNATURE_MBB_SPORT_CODE,
  isStandaloneStaffSignatureCollection,
  signatureCollectionTitle,
  type SignatureImportedSportCode,
} from "@/lib/signatures/types";

type Collection = {
  id: string;
  sportCode: string;
  season: string;
  status: "OPEN" | "ARCHIVED";
  collectionVersion: number;
  activeMemberCount: number;
  completeness: { complete: number; required: number; percent: number };
  staffCompleteness?: { complete: number; total: number };
  downloadableCount?: number;
  hasRetainedSignatures?: boolean;
  updatedAt: string;
};

type Preview = {
  collectionId: string;
  sportCode: SignatureImportedSportCode;
  season: string;
  collectionVersion: number;
  snapshotId: string;
  candidateCount: number;
  alreadyApplied?: boolean;
  sourceHash: string;
  entries: Array<{ name: string; roleGroup: string; jerseyNumber: number | null }>;
};

type SignatureZipFormat = "png" | "svg";

const CAPTURE_ON_IPAD_TOOLTIP = "Capture can only be done on an iPad with an Apple Pencil.";

const SIGNATURE_SEASON_OPTIONS = Array.from({ length: 9 }, (_, index) => {
  const startYear = 2024 + index;
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
});

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (handleAuthRedirect(response)) throw new Error("Session expired");
  if (!response.ok) throw new Error(await parseErrorMessage(response, "Signature request failed"));
  return response.json() as Promise<Record<string, unknown>>;
}

async function deleteJson(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (handleAuthRedirect(response)) throw new Error("Session expired");
  if (!response.ok) throw new Error(await parseErrorMessage(response, "Signature request failed"));
  return response.json() as Promise<Record<string, unknown>>;
}

export default function SignatureCollectionsPage({ isAdmin }: { isAdmin: boolean }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);
  const [season, setSeason] = useState(DEFAULT_SIGNATURE_SEASON);
  const [importSportCode, setImportSportCode] = useState<SignatureImportedSportCode>(SIGNATURE_MBB_SPORT_CODE);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [importAction, setImportAction] = useState<"preview" | "apply" | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const working = importAction !== null;
  const [workingCollectionId, setWorkingCollectionId] = useState<string | null>(null);
  const [syncingCollectionId, setSyncingCollectionId] = useState<string | null>(null);
  const [adHocOpen, setAdHocOpen] = useState(false);
  const [adHocName, setAdHocName] = useState("");
  const [adHocCategory, setAdHocCategory] = useState("");
  const [adHocSeason, setAdHocSeason] = useState(DEFAULT_SIGNATURE_SEASON);
  const [addingAdHoc, setAddingAdHoc] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Collection | null>(null);
  const [isIpad, setIsIpad] = useState(false);
  const automaticSyncAttempt = useRef<string | null>(null);
  const { data, loading, refreshing, error, reload } = useFetch<Collection[]>({
    url: "/api/signatures/collections" + (showArchived ? "?includeArchived=true" : ""),
    transform: (json) => (json.collections as Collection[]) ?? [],
  });
  const collections = useMemo(() => data ?? [], [data]);

  useEffect(() => {
    setIsIpad(isCurrentDeviceIpad());
  }, []);

  useEffect(() => {
    if (loading) return;
    const creativeStaffRoster = collections.find((collection) => collection.sportCode === SIGNATURE_CREATIVE_STAFF_SPORT_CODE && collection.status === "OPEN");
    if (!creativeStaffRoster) return;
    const attemptKey = `${creativeStaffRoster.id}:${creativeStaffRoster.collectionVersion}`;
    if (automaticSyncAttempt.current === attemptKey) return;
    automaticSyncAttempt.current = attemptKey;
    setSyncingCollectionId(creativeStaffRoster.id);
    void postJson(`/api/signatures/collections/${creativeStaffRoster.id}/creative-staff`, {
      expectedCollectionVersion: creativeStaffRoster.collectionVersion,
    }).then(async (result) => {
      if (!result.unchanged) {
        await invalidateSignatureCollectionCaches(queryClient, creativeStaffRoster.id);
        reload();
      }
    }).catch((requestError) => {
      toast.error(requestError instanceof Error ? requestError.message : "Creative Staff was not updated");
    }).finally(() => {
      setSyncingCollectionId(null);
    });
  }, [collections, loading, queryClient, reload]);

  async function addAdHocSigner() {
    if (!isIpad) {
      toast.error(CAPTURE_ON_IPAD_TOOLTIP);
      return;
    }
    setAddingAdHoc(true);
    try {
      const result = await postJson("/api/signatures/collections", {
        season: adHocSeason,
        name: adHocName,
        category: adHocCategory,
      });
      setAdHocOpen(false);
      setAdHocName("");
      setAdHocCategory("");
      const collectionId = String(result.collectionId);
      await invalidateSignatureCollectionCaches(queryClient, collectionId);
      router.push(`/signatures/${collectionId}/capture/${String(result.memberId)}`);
    } catch (requestError) {
      toast.error(requestError instanceof Error ? requestError.message : "Ad-hoc signer was not added");
    } finally {
      setAddingAdHoc(false);
    }
  }

  async function previewRoster() {
    setImportAction("preview");
    setPreview(null);
    setImportError(null);
    try {
      const result = await postJson("/api/signatures/import/preview", { sportCode: importSportCode, season });
      setPreview(result as unknown as Preview);
      toast.success("Roster preview ready: " + result.candidateCount + " members");
    } catch (requestError) {
      setImportError(requestError instanceof Error ? requestError.message : "Roster preview failed");
    } finally {
      setImportAction(null);
    }
  }

  async function applyPreview() {
    if (!preview || preview.sportCode !== importSportCode || preview.season !== season) return;
    setImportAction("apply");
    setImportError(null);
    try {
      await postJson("/api/signatures/import/apply", {
        snapshotId: preview.snapshotId,
        expectedCollectionVersion: preview.collectionVersion,
      });
      await invalidateSignatureCollectionCaches(queryClient, preview.collectionId);
      setPreview(null);
      reload();
      toast.success("Roster applied");
    } catch (requestError) {
      setImportError(requestError instanceof Error ? requestError.message : "Roster apply failed");
    } finally {
      setImportAction(null);
    }
  }

  async function archiveCollection(collection: Collection) {
    if (!window.confirm("Remove " + collection.season + " from active signature rosters? It will remain available as read-only history.")) return;
    setWorkingCollectionId(collection.id);
    try {
      await postJson("/api/signatures/collections/" + collection.id + "/archive", {
        expectedCollectionVersion: collection.collectionVersion,
      });
      await invalidateSignatureCollectionCaches(queryClient, collection.id);
      reload();
      toast.success(collection.season + " was archived");
    } catch (requestError) {
      toast.error(requestError instanceof Error ? requestError.message : "Collection was not archived");
    } finally {
      setWorkingCollectionId(null);
    }
  }

  async function restoreCollection(collection: Collection) {
    if (!window.confirm("Restore " + collection.season + " to active signature rosters?")) return;
    setWorkingCollectionId(collection.id);
    try {
      await postJson("/api/signatures/collections/" + collection.id + "/restore", {
        expectedCollectionVersion: collection.collectionVersion,
      });
      await invalidateSignatureCollectionCaches(queryClient, collection.id);
      reload();
      toast.success(collection.season + " was restored");
    } catch (requestError) {
      toast.error(requestError instanceof Error ? requestError.message : "Collection was not restored");
    } finally {
      setWorkingCollectionId(null);
    }
  }

  async function downloadAll(collection: Collection, format: SignatureZipFormat) {
    setWorkingCollectionId(collection.id);
    try {
      const response = await fetch(`/api/signatures/collections/${collection.id}/download?format=${format}`);
      if (handleAuthRedirect(response)) throw new Error("Session expired");
      if (!response.ok) throw new Error(await parseErrorMessage(response, "Signature archive could not be downloaded"));
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${collection.sportCode.toLowerCase()}-${collection.season}-signatures-${format}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      toast.success(`${signatureCollectionTitle(collection.sportCode)} ${format.toUpperCase()} signatures downloaded`);
    } catch (requestError) {
      toast.error(requestError instanceof Error ? requestError.message : "Signature archive could not be downloaded");
    } finally {
      setWorkingCollectionId(null);
    }
  }

  function requestDelete(collection: Collection) {
    if (collection.hasRetainedSignatures || (collection.downloadableCount ?? 0) > 0) {
      setDeleteTarget(collection);
      return;
    }
    void deleteCollection(collection);
  }

  async function deleteCollection(collection: Collection) {
    setWorkingCollectionId(collection.id);
    try {
      await deleteJson(`/api/signatures/collections/${collection.id}`, {
        expectedCollectionVersion: collection.collectionVersion,
      });
      await invalidateSignatureCollectionCaches(queryClient, collection.id);
      setDeleteTarget(null);
      await reload();
      toast.success(`${signatureCollectionTitle(collection.sportCode)} was deleted`);
    } catch (requestError) {
      toast.error(requestError instanceof Error ? requestError.message : "Collection was not deleted");
      setDeleteTarget(null);
      setShowArchived(true);
      await invalidateSignatureCollectionCaches(queryClient, collection.id);
      reload();
    } finally {
      setWorkingCollectionId(null);
    }
  }

  return (
    <FadeUp>
      <PageHeader title="Signatures">
        <Dialog open={adHocOpen} onOpenChange={(open) => { if (!addingAdHoc) setAdHocOpen(open); }}>
          {isIpad ? (
            <DialogTrigger asChild>
              <Button size="sm" className="h-10"><Plus data-icon="inline-start" />Add Signature</Button>
            </DialogTrigger>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0} aria-label="Add signature on iPad" className="inline-flex">
                  <Button type="button" size="sm" className="h-10" disabled><Plus data-icon="inline-start" />Add on iPad</Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>{CAPTURE_ON_IPAD_TOOLTIP}</TooltipContent>
            </Tooltip>
          )}
          <DialogContent>
            <DialogHeader className="flex-col items-start gap-1 pr-14">
              <DialogTitle>Add ad-hoc signature</DialogTitle>
              <DialogDescription>Create a one-off signer and go straight to the capture surface.</DialogDescription>
            </DialogHeader>
            <DialogBody className="space-y-4 py-5">
              <div className="space-y-2">
                <Label htmlFor="ad-hoc-signature-name">Name</Label>
                <Input id="ad-hoc-signature-name" name="name" autoComplete="name" value={adHocName} onChange={(event) => setAdHocName(event.target.value)} placeholder="Full name" maxLength={160} disabled={addingAdHoc} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ad-hoc-signature-category">Sport or category</Label>
                <Input id="ad-hoc-signature-category" name="category" value={adHocCategory} onChange={(event) => setAdHocCategory(event.target.value)} placeholder="Football, donor, alumni…" maxLength={160} disabled={addingAdHoc} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ad-hoc-signature-season">Season</Label>
                <Select value={adHocSeason} onValueChange={setAdHocSeason} disabled={addingAdHoc}>
                  <SelectTrigger id="ad-hoc-signature-season"><SelectValue /></SelectTrigger>
                  <SelectContent>{SIGNATURE_SEASON_OPTIONS.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </DialogBody>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAdHocOpen(false)} disabled={addingAdHoc}>Cancel</Button>
              <Button onClick={addAdHocSigner} disabled={addingAdHoc || !adHocName.trim() || !adHocCategory.trim()}>
                <FilePenLine data-icon="inline-start" />{addingAdHoc ? "Adding…" : "Add and capture"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Button variant="outline" size="sm" className="h-10" onClick={reload} disabled={loading || refreshing || Boolean(workingCollectionId)}>
          <RefreshCw data-icon="inline-start" className={loading || refreshing ? "animate-spin" : undefined} />
          Refresh
        </Button>
      </PageHeader>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section aria-labelledby="signature-collections-heading">
          <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 id="signature-collections-heading" className="text-lg font-semibold">Rosters</h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {isAdmin && (
                <Button variant="ghost" size="sm" className="h-10" onClick={() => setShowArchived((value) => !value)}>
                  {showArchived ? <EyeOff data-icon="inline-start" /> : <Eye data-icon="inline-start" />}
                  {showArchived ? "Hide archived" : "Show archived"}
                </Button>
              )}
              <Select onValueChange={(value) => router.push("/signatures/" + value)}>
                <SelectTrigger className="h-10 w-44" aria-label="Choose a signature roster"><SelectValue placeholder="Choose roster" /></SelectTrigger>
                <SelectContent>{collections.map((collection) => <SelectItem key={collection.id} value={collection.id}>{signatureCollectionTitle(collection.sportCode)} · {collection.season}</SelectItem>)}</SelectContent>
              </Select>
              <Badge variant="outline">{collections.length} {collections.length === 1 ? "roster" : "rosters"}</Badge>
            </div>
          </div>

          {loading && <Card><CardContent className="p-5 text-sm text-muted-foreground">Loading rosters…</CardContent></Card>}
          {!loading && error && <EmptyState icon="wifi-off" title="Couldn’t load rosters" description="Try again before importing a roster." actionLabel="Retry" onAction={reload} />}
          {!loading && !error && collections.length === 0 && (
            <Card>
              <CardContent className="p-2">
                <EmptyState
                  icon="folder"
                  title={showArchived ? "No rosters" : "No active rosters"}
                  description={showArchived ? "No signature collections are available." : "Archived years are hidden. Import a roster to start a new season."}
                />
              </CardContent>
            </Card>
          )}
          {!loading && !error && collections.length > 0 && (
            <div className="grid gap-3 md:grid-cols-2">
              {collections.map((collection) => {
                const isWorking = Boolean(workingCollectionId) || syncingCollectionId === collection.id;
                const isCreativeStaffRoster = collection.sportCode === SIGNATURE_CREATIVE_STAFF_SPORT_CODE;
                const isStandaloneStaffRoster = isStandaloneStaffSignatureCollection(collection.sportCode);
                const isAdHocRoster = collection.sportCode === SIGNATURE_AD_HOC_SPORT_CODE;
                const hasSyncedMembers = collection.activeMemberCount > 0;
                const staffCompleteness = collection.staffCompleteness ?? { complete: 0, total: 0 };
                const downloadableCount = collection.downloadableCount ?? 0;
                return (
                  <Card key={collection.id} className={collection.status === "ARCHIVED" ? "h-full opacity-75" : "h-full"}>
                    <CardHeader className="flex-row items-start justify-between gap-3 pb-3">
                      <div className="min-w-0">
                        <CardTitle className="text-base">
                          <Link href={"/signatures/" + collection.id} className="inline-flex items-center gap-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                            {isStandaloneStaffRoster && <UsersRound className="size-4 text-muted-foreground" aria-hidden="true" />}
                            {isAdHocRoster && <FilePenLine className="size-4 text-muted-foreground" aria-hidden="true" />}
                            {signatureCollectionTitle(collection.sportCode)}
                          </Link>
                        </CardTitle>
                        <p className="mt-1 text-sm text-muted-foreground">{isAdHocRoster ? `${collection.season} one-off captures` : collection.season}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Badge variant={collection.status === "OPEN" ? "default" : "outline"}>{collection.status === "OPEN" ? "Open" : "Archived"}</Badge>
                        <OperationalRowActions label={`Actions for ${signatureCollectionTitle(collection.sportCode)} ${collection.season}`}>
                          <DropdownMenuSub>
                            <DropdownMenuSubTrigger disabled={isWorking || downloadableCount === 0}>
                              <Download />
                              Download All{downloadableCount === 0 ? " (none yet)" : ""}
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent>
                              <DropdownMenuItem disabled={isWorking} onSelect={() => void downloadAll(collection, "png")}>
                                <FileImage />
                                PNG files
                              </DropdownMenuItem>
                              <DropdownMenuItem disabled={isWorking} onSelect={() => void downloadAll(collection, "svg")}>
                                <FileCode2 />
                                SVG files
                              </DropdownMenuItem>
                            </DropdownMenuSubContent>
                          </DropdownMenuSub>
                          {isAdmin && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem disabled={isWorking} onSelect={() => void (collection.status === "OPEN" ? archiveCollection(collection) : restoreCollection(collection))}>
                                <Archive />
                                {collection.status === "OPEN" ? "Archive" : "Restore"}
                              </DropdownMenuItem>
                              <DropdownMenuItem variant="destructive" disabled={isWorking} onSelect={() => requestDelete(collection)}>
                                <Trash2 />
                                Delete
                              </DropdownMenuItem>
                            </>
                          )}
                        </OperationalRowActions>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">{!hasSyncedMembers ? "Roster status" : "Complete"}</span>
                        <span className="font-semibold tabular-nums">{!hasSyncedMembers ? "Not applied" : `${collection.completeness.complete}/${collection.completeness.required}`}</span>
                      </div>
                      <Progress
                        value={hasSyncedMembers ? collection.completeness.percent : 0}
                        className="mt-2 h-2"
                        aria-label={`${signatureCollectionTitle(collection.sportCode)} readiness`}
                      />
                      {!isCreativeStaffRoster && !isAdHocRoster && staffCompleteness.total > 0 && (
                        <div className="mt-2 text-right text-xs text-muted-foreground tabular-nums">
                          {staffCompleteness.complete}/{staffCompleteness.total} Staff
                        </div>
                      )}
                      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                        <span>{isCreativeStaffRoster ? (hasSyncedMembers ? "Automatically synced" : "Syncing automatically") : hasSyncedMembers ? `${collection.completeness.percent}% ready` : "Apply a roster to begin"}</span>
                        <Link href={"/signatures/" + collection.id} className="inline-flex items-center gap-1 font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          Open roster <ArrowRight className="size-3.5" aria-hidden="true" />
                        </Link>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </section>

        <Card className="h-fit">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><FolderPen className="size-4 text-[var(--wi-red)]" />Import roster</CardTitle>
            <p className="text-sm text-muted-foreground">UWBadgers · {signatureCollectionTitle(importSportCode)}</p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="signature-import-sport">Roster source</Label>
              <Select value={importSportCode} disabled={working} onValueChange={(value) => { setImportSportCode(value as SignatureImportedSportCode); setPreview(null); setImportError(null); }}>
                <SelectTrigger id="signature-import-sport" className="h-10 w-full" aria-label="Import roster source">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SIGNATURE_IMPORTED_SPORT_CODES.map((sportCode) => (
                    <SelectItem key={sportCode} value={sportCode}>{signatureCollectionTitle(sportCode)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="signature-season">Season</Label>
              <Select value={season} disabled={working} onValueChange={(value) => { setSeason(value); setPreview(null); setImportError(null); }}>
                <SelectTrigger id="signature-season" className="h-10 w-full" aria-label="Season">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SIGNATURE_SEASON_OPTIONS.map((seasonOption) => (
                    <SelectItem key={seasonOption} value={seasonOption}>{seasonOption}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button className="h-10 w-full" onClick={previewRoster} disabled={working || !/^\d{4}-\d{2}$/.test(season)}>
              {importAction === "preview" ? "Checking roster…" : "Preview roster"}
            </Button>
            {importError && <Alert variant="destructive"><AlertDescription className="col-start-2">{importError}</AlertDescription></Alert>}
            {preview && (
              <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                <p className="font-medium">{signatureCollectionTitle(preview.sportCode)} · {preview.season}</p>
                <p className="mt-1 text-xs text-muted-foreground">{preview.candidateCount} members · {preview.alreadyApplied ? "Already applied" : "Review before applying"}</p>
                <ul aria-label="Roster preview" className="mt-3 max-h-64 space-y-2 overflow-y-auto text-xs">
                  {preview.entries.map((entry, index) => (
                    <li key={index} className="flex items-baseline justify-between gap-2">
                      <span>{entry.name}</span>
                      <span className="shrink-0 text-muted-foreground">{entry.roleGroup === "PLAYER" ? (entry.jerseyNumber === null ? "Player" : `#${entry.jerseyNumber}`) : "Staff"}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" className="h-10" onClick={applyPreview} disabled={working || preview.alreadyApplied}>{importAction === "apply" ? "Applying…" : "Apply roster"}</Button>
                  <Button size="sm" variant="outline" className="h-10" onClick={() => setPreview(null)} disabled={working}>Dismiss</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => { if (!open && !workingCollectionId) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this signature roster?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget ? `${signatureCollectionTitle(deleteTarget.sportCode)} · ${deleteTarget.season} and its captured signatures will be permanently removed. This cannot be undone.` : "This signature roster will be permanently removed."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(workingCollectionId)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={!deleteTarget || workingCollectionId === deleteTarget.id}
              onClick={(event) => {
                event.preventDefault();
                if (deleteTarget) void deleteCollection(deleteTarget);
              }}
            >
              {deleteTarget && workingCollectionId === deleteTarget.id ? "Deleting…" : "Delete roster"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </FadeUp>
  );
}
