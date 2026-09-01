"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Archive, CheckCircle2, ChevronDown, Download, FilePenLine, History, LockKeyhole, RefreshCw, RotateCcw, Settings2, ShieldCheck, Trash2, UserRound, UsersRound } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { useBreadcrumbLabel } from "@/components/BreadcrumbContext";
import { FadeUp } from "@/components/ui/motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import EmptyState from "@/components/EmptyState";
import { OperationalRowActions } from "@/components/OperationalRowActions";
import { SignaturePenPreview } from "@/components/signatures/SignaturePenPreview";
import { useFetch } from "@/hooks/use-fetch";
import { handleAuthRedirect, parseErrorMessage } from "@/lib/errors";
import { isCurrentDeviceIpad } from "@/lib/signatures/capture";
import { invalidateSignatureCollectionCaches } from "@/lib/signatures/client-cache";
import { compareSignatureRosterMembers } from "@/lib/signatures/roster";
import {
  SIGNATURE_AD_HOC_SPORT_CODE,
  SIGNATURE_ADMINISTRATION_SPORT_CODE,
  SIGNATURE_CREATIVE_STAFF_SPORT_CODE,
  isStandaloneStaffSignatureCollection,
  signatureCollectionTitle,
} from "@/lib/signatures/types";
import { cn } from "@/lib/utils";

type Member = {
  id: string;
  name: string;
  jerseyNumber: number | null;
  title: string | null;
  roleGroup: "PLAYER" | "COACHING_STAFF" | "CREATIVE_STAFF" | "SUPPORT_STAFF";
  sourceOrder: number | null;
  required: boolean;
  active: boolean;
  captureVersion: number;
  settingsVersion: number;
  artifact: { id: string; revision: number; width: number; height: number; committedAt: string | null; replacedAt: string | null } | null;
  revisions?: Array<{ id: string; revision: number; width: number; height: number; committedAt: string | null; replacedAt: string | null }>;
  revisionCount?: number;
  revisionHistoryTruncated?: boolean;
};

type Collection = {
  id: string;
  sportCode: string;
  season: string;
  status: "OPEN" | "ARCHIVED";
  collectionVersion: number;
  settingsVersion: number;
  penSettings: { strokeColor: string; strokeWidth: number; cropPadding: number; maxWidth: number; maxHeight: number };
  completeness: { complete: number; required: number; percent: number };
  staffCompleteness?: { complete: number; total: number };
  members: Member[];
};

function roleLabel(role: Member["roleGroup"]) {
  if (role === "PLAYER") return "Student-Athlete";
  if (role === "COACHING_STAFF") return "Coaching Staff";
  if (role === "CREATIVE_STAFF") return "Creative Staff";
  return "Support Staff";
}

const GROUP_META: Record<Member["roleGroup"], { label: string; icon: typeof UserRound }> = {
  PLAYER: { label: "Student-Athletes", icon: UserRound },
  COACHING_STAFF: { label: "Coaching Staff", icon: ShieldCheck },
  CREATIVE_STAFF: { label: "Creative Staff", icon: UsersRound },
  SUPPORT_STAFF: { label: "Support Staff", icon: UsersRound },
};

const CAPTURE_ON_IPAD_TOOLTIP = "Capture can only be done on an iPad with an Apple Pencil.";

function CaptureAction({ collectionId, member, isIpad, primaryCapture }: { collectionId: string; member: Member; isIpad: boolean; primaryCapture: boolean }) {
  if (isIpad) {
    return (
      <Button size="sm" variant={primaryCapture ? "brand" : "outline"} className="h-11 w-40" asChild>
        <Link href={`/signatures/${collectionId}/capture/${member.id}`}><FilePenLine data-icon="inline-start" />Capture</Link>
      </Button>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} aria-label="Capture on iPad" className="inline-flex">
          <Button type="button" size="sm" variant={primaryCapture ? "brand" : "outline"} className="h-11 w-40" disabled>
            <FilePenLine data-icon="inline-start" />Capture on iPad
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{CAPTURE_ON_IPAD_TOOLTIP}</TooltipContent>
    </Tooltip>
  );
}

async function mutate(url: string, method: string, body?: unknown) {
  const response = await fetch(url, {
    method,
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  if (handleAuthRedirect(response)) throw new Error("Session expired");
  if (!response.ok) throw new Error(await parseErrorMessage(response, "Signature action failed"));
  return response.json() as Promise<Record<string, unknown>>;
}

export default function SignatureCollectionPage({ collectionId, isAdmin }: { collectionId: string; isAdmin: boolean }) {
  const { setBreadcrumbLabel } = useBreadcrumbLabel();
  const queryClient = useQueryClient();
  const { data: collection, loading, refreshing, error, reload } = useFetch<Collection>({ url: `/api/signatures/collections/${collectionId}` });
  const [group, setGroup] = useState<"ALL" | Member["roleGroup"]>("ALL");
  const [search, setSearch] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [resettingCollection, setResettingCollection] = useState(false);
  const [settings, setSettings] = useState<Collection["penSettings"] | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [previewMember, setPreviewMember] = useState<Member | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<Member["roleGroup"]>>(new Set());
  const [isIpad, setIsIpad] = useState(false);
  const isCreativeStaffRoster = collection?.sportCode === SIGNATURE_CREATIVE_STAFF_SPORT_CODE;
  const isAdministrationRoster = collection?.sportCode === SIGNATURE_ADMINISTRATION_SPORT_CODE;
  const isStandaloneStaffRoster = collection ? isStandaloneStaffSignatureCollection(collection.sportCode) : false;
  const isAdHocRoster = collection?.sportCode === SIGNATURE_AD_HOC_SPORT_CODE;
  const rosterGroupOrder = useMemo<Member["roleGroup"][]>(
    () => isCreativeStaffRoster ? ["CREATIVE_STAFF"] : isStandaloneStaffRoster ? ["SUPPORT_STAFF"] : isAdHocRoster ? ["SUPPORT_STAFF"] : ["PLAYER", "COACHING_STAFF", "SUPPORT_STAFF"],
    [isAdHocRoster, isStandaloneStaffRoster, isCreativeStaffRoster],
  );

  useEffect(() => {
    setGroup("ALL");
    setSearch("");
    setCollapsedGroups(new Set());
    setSettingsOpen(false);
  }, [collection?.id]);

  useEffect(() => {
    setIsIpad(isCurrentDeviceIpad());
  }, []);

  useEffect(() => {
    if (collection) setBreadcrumbLabel(signatureCollectionTitle(collection.sportCode));
  }, [collection, setBreadcrumbLabel]);

  const groupSections = useMemo(() => rosterGroupOrder
    .map((roleGroup) => {
      const normalizedSearch = search.trim().toLocaleLowerCase();
      const members = (collection?.members ?? []).filter((member) => {
        if (!member.active || member.roleGroup !== roleGroup) return false;
        if (!normalizedSearch) return true;
        return [member.name, member.title, member.jerseyNumber === null ? "" : String(member.jerseyNumber)]
          .some((value) => value?.toLocaleLowerCase().includes(normalizedSearch));
      }).sort(compareSignatureRosterMembers);
      const complete = members.filter((member) => member.artifact).length;
      return {
        roleGroup,
        members,
        complete,
        percent: members.length === 0 ? 100 : Math.round((complete / members.length) * 100),
      };
    })
    .filter((section) => (group === "ALL" || section.roleGroup === group) && (section.members.length > 0 || (!search.trim() && isCreativeStaffRoster && section.roleGroup === "CREATIVE_STAFF"))), [collection?.members, group, isCreativeStaffRoster, rosterGroupOrder, search]);
  const effectiveSettings = settings ?? collection?.penSettings;
  const hasCapturedSignatures = collection?.members.some((member) => Boolean(member.artifact)) ?? false;
  const settingsLocked = hasCapturedSignatures;

  async function saveSettings() {
    if (!collection || !effectiveSettings) return;
    setSavingSettings(true);
    try {
      await mutate(`/api/signatures/collections/${collection.id}`, "PATCH", { ...effectiveSettings, expectedCollectionVersion: collection.collectionVersion, expectedSettingsVersion: collection.settingsVersion });
      setSettings(null);
      await invalidateSignatureCollectionCaches(queryClient, collection.id);
      reload();
      toast.success("Pen settings saved");
    } catch (requestError) {
      toast.error(requestError instanceof Error ? requestError.message : "Pen settings were not saved");
    } finally {
      setSavingSettings(false);
    }
  }

  async function remove(member: Member) {
    if (!collection || !member.artifact || !window.confirm(`Remove ${member.name}'s current signature?`)) return;
    try {
      await mutate(`/api/signatures/collections/${collection.id}/capture/${member.id}`, "DELETE", { expectedCaptureVersion: member.captureVersion });
      await invalidateSignatureCollectionCaches(queryClient, collection.id);
      reload();
      toast.success(`${member.name}'s signature was removed`);
    } catch (requestError) {
      toast.error(requestError instanceof Error ? requestError.message : "Signature was not removed");
    }
  }

  async function removeFromRoster(member: Member) {
    if (!collection || collection.status !== "OPEN" || member.roleGroup !== "PLAYER") return;
    if (!window.confirm(`Remove ${member.name} from this active roster? Their saved signature history will be kept. A future roster import may add this player again.`)) return;
    try {
      await mutate(`/api/signatures/collections/${collection.id}/members/${member.id}`, "DELETE", { expectedCollectionVersion: collection.collectionVersion });
      await invalidateSignatureCollectionCaches(queryClient, collection.id);
      reload();
      toast.success(`${member.name} was removed from this roster`);
    } catch (requestError) {
      toast.error(requestError instanceof Error ? requestError.message : "Player was not removed from the roster");
    }
  }

  async function toggleRequired(member: Member) {
    if (!collection) return;
    try {
      await mutate(`/api/signatures/collections/${collection.id}/members/${member.id}/required`, "PATCH", { required: !member.required, expectedCollectionVersion: collection.collectionVersion });
      await invalidateSignatureCollectionCaches(queryClient, collection.id);
      reload();
      toast.success(`${member.name} is now ${member.required ? "optional" : "required"}`);
    } catch (requestError) {
      toast.error(requestError instanceof Error ? requestError.message : "Required state was not changed");
    }
  }

  async function resetCollection() {
    if (!collection) return;
    setResettingCollection(true);
    try {
      await mutate(`/api/signatures/collections/${collection.id}/reset`, "POST", { expectedCollectionVersion: collection.collectionVersion });
      await invalidateSignatureCollectionCaches(queryClient, collection.id);
      reload();
      toast.success("Collection reset");
    } catch (requestError) {
      toast.error(requestError instanceof Error ? requestError.message : "Collection was not reset");
    } finally {
      setResettingCollection(false);
    }
  }

  function setGroupOpen(roleGroup: Member["roleGroup"], open: boolean) {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (open) next.delete(roleGroup);
      else next.add(roleGroup);
      return next;
    });
  }

 async function archiveCollection() {
   if (!collection || !window.confirm("Archive this collection? It will become read-only.")) return;
   try {
      await mutate("/api/signatures/collections/" + collection.id + "/archive", "POST", { expectedCollectionVersion: collection.collectionVersion });
      await invalidateSignatureCollectionCaches(queryClient, collection.id);
     reload();
     toast.success("Collection archived");
    } catch (requestError) {
      toast.error(requestError instanceof Error ? requestError.message : "Collection was not archived");
    }
  }

  if (loading) return <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading signature roster…</CardContent></Card>;
  if (error || !collection) return <EmptyState icon="wifi-off" title="Couldn’t load this signature collection" description="The collection may have moved or the connection failed." actionLabel="Retry" onAction={reload} />;

  const teamRoster = !isStandaloneStaffRoster && !isAdHocRoster;
  const staffCompleteness = collection.staffCompleteness ?? { complete: 0, total: 0 };

  return (
    <FadeUp>
     <PageHeader
       title={signatureCollectionTitle(collection.sportCode)}
        description={collection.season}
     >
        <Button variant="outline" size="sm" className="h-10" onClick={reload} disabled={loading || refreshing}><RefreshCw data-icon="inline-start" className={refreshing ? "animate-spin" : undefined} />Refresh</Button>
        {isAdmin && collection.status === "OPEN" && <Button variant="outline" size="sm" className="h-10" onClick={archiveCollection}><Archive data-icon="inline-start" />Archive</Button>}
      </PageHeader>

      <div className="space-y-4">
       <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
         <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold">Roster</h2>
            {teamRoster && (
              <div className="mt-3 max-w-xl">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <p className="text-sm font-semibold tabular-nums">{collection.completeness.complete}/{collection.completeness.required} Student-Athletes</p>
                  {staffCompleteness.total > 0 && <p className="text-xs text-muted-foreground tabular-nums">{staffCompleteness.complete}/{staffCompleteness.total} Staff</p>}
                </div>
                <Progress value={collection.completeness.percent} className="mt-2 h-2" aria-label={`${signatureCollectionTitle(collection.sportCode)} student-athlete readiness`} />
              </div>
            )}
         </div>
          <div className="grid w-full gap-2 sm:w-auto sm:grid-cols-[minmax(14rem,22rem)_13rem]">
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, number, or title"
              aria-label="Search signature roster"
              className="h-10"
            />
            {teamRoster ? (
              <Select value={group} onValueChange={(value) => setGroup(value as typeof group)}>
                <SelectTrigger className="h-10 w-full" aria-label="Filter signature roster"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="ALL">All roster groups</SelectItem><SelectItem value="PLAYER">Players</SelectItem><SelectItem value="COACHING_STAFF">Coaching staff</SelectItem><SelectItem value="SUPPORT_STAFF">Support staff</SelectItem></SelectContent>
              </Select>
            ) : <div className="hidden sm:block" aria-hidden="true" />}
          </div>
        </div>

        {groupSections.length === 0 ? <EmptyState icon="users" title="No roster members in this view" description={search.trim() ? "Try another name, number, or title." : "Try another roster group."} /> : (
         <div className="space-y-7">
           {groupSections.map((section) => {
              const meta = isAdHocRoster
                ? { label: "Ad-hoc signers", icon: FilePenLine }
                : isAdministrationRoster
                  ? { label: "Administration", icon: UsersRound }
                  : GROUP_META[section.roleGroup];
              const Icon = meta.icon;
              const sectionOpen = !collapsedGroups.has(section.roleGroup);
             return (
               <Collapsible key={section.roleGroup} open={sectionOpen} onOpenChange={(open) => setGroupOpen(section.roleGroup, open)} asChild>
                 <section aria-labelledby={`signature-group-${section.roleGroup.toLowerCase()}`}>
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="mb-2 flex min-h-12 w-full items-center gap-3 border-b pb-2 text-left outline-none transition-colors hover:text-foreground focus-visible:rounded-md focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      aria-label={`${sectionOpen ? "Collapse" : "Expand"} ${meta.label}`}
                    >
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-md border bg-muted/40 text-muted-foreground"><Icon className="size-5" aria-hidden="true" /></div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2"><h3 id={`signature-group-${section.roleGroup.toLowerCase()}`} className="text-base font-semibold">{meta.label}</h3><Badge variant="outline" size="sm">{section.members.length}</Badge></div>
                      </div>
                      <div className="ml-auto flex shrink-0 items-center gap-3 text-right">
                        <div><p className="text-sm font-semibold tabular-nums">{section.members.length === 0 ? "Not added" : `${section.complete}/${section.members.length} signed`}</p><p className="text-xs text-muted-foreground">{section.members.length === 0 ? "Internal staff" : `${section.percent}% complete`}</p></div>
                        <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", sectionOpen && "rotate-180")} aria-hidden="true" />
                      </div>
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                 {section.members.length === 0 ? (
                   <Card className="border-dashed bg-muted/15">
                     <CardContent className="flex flex-col items-start gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                       <div>
                         <p className="font-medium">{isCreativeStaffRoster ? "Creative Staff is syncing automatically" : "No Administration members are active"}</p>
                         <p className="mt-1 text-sm text-muted-foreground">{isCreativeStaffRoster ? "Active full-time Video, Photo, and Graphics staff will appear here." : "Apply a fresh UWBadgers Administration roster snapshot to populate this group."}</p>
                       </div>
                     </CardContent>
                   </Card>
                 ) : (
                 <div className="overflow-x-auto rounded-lg border">
                   <div className="min-w-[640px]">
                     <div className="grid h-11 grid-cols-[minmax(16rem,1fr)_11rem_3.5rem] items-center border-b bg-muted/20 px-4 text-xs font-medium text-muted-foreground">
                       <span>Person</span>
                       <span className="text-center">Signature</span>
                       <span className="sr-only">Actions</span>
                     </div>
                     {section.members.map((member) => {
                       const priorRevisions = (member.revisions ?? []).filter((revision) => revision.id !== member.artifact?.id);
                       const canChangeRequirement = Boolean(isAdmin && collection.status === "OPEN" && member.roleGroup !== "PLAYER");
                       const canRemoveFromRoster = collection.status === "OPEN" && member.roleGroup === "PLAYER";
                       const showRowActions = Boolean(member.artifact || priorRevisions.length > 0 || canChangeRequirement || canRemoveFromRoster);
                       return (
                         <div
                           key={member.id}
                           className={cn(
                             "grid h-16 grid-cols-[minmax(16rem,1fr)_11rem_3.5rem] items-center border-b px-4 transition-colors last:border-b-0",
                             member.artifact
                               ? "border-[var(--green)]/20 bg-[var(--green-bg)] hover:bg-[var(--green-bg)]"
                               : "hover:bg-muted/15",
                           )}
                         >
                           <div className="flex min-w-0 items-center gap-3">
                             <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-muted font-bold text-muted-foreground" aria-label={member.jerseyNumber === null ? "No jersey number" : `Jersey ${member.jerseyNumber}`}>
                               {member.jerseyNumber === null ? (
                                 <UserRound className="size-4" aria-hidden="true" />
                               ) : (
                                 <span
                                   className="translate-x-[0.03em] text-2xl leading-none tracking-[0.06em] tabular-nums"
                                   style={{ fontFamily: "var(--font-jersey)", fontWeight: 400 }}
                                 >
                                   {member.jerseyNumber}
                                 </span>
                               )}
                             </div>
                             <div className="min-w-0 flex-1">
                               <div className="flex min-w-0 items-center gap-2">
                                 <span className="min-w-0 truncate whitespace-nowrap text-sm leading-5" style={{ fontFamily: "var(--font-heading)", fontWeight: 800 }}>{member.name}</span>
                                 {member.artifact && (
                                   <span className="inline-flex size-6 shrink-0 items-center justify-center text-[var(--green-text)]" title="Signature complete">
                                     <CheckCircle2 className="size-4" aria-hidden="true" />
                                     <span className="sr-only">Signature complete</span>
                                   </span>
                                 )}
                               </div>
                               {!isCreativeStaffRoster && <span className="block max-w-full truncate whitespace-nowrap text-xs leading-4 text-muted-foreground" title={member.title || roleLabel(member.roleGroup)}>{member.title || roleLabel(member.roleGroup)}</span>}
                             </div>
                           </div>

                           <div className="flex items-center justify-center">
                             {member.artifact ? (
                               <button type="button" className="flex min-h-11 min-w-24 items-center justify-center rounded-md outline-none transition-colors hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/50" onClick={() => setPreviewMember(member)} aria-label={`Quick Look ${member.name}'s signature`}>
                                 <Image
                                   src={`/api/signatures/artifacts/${member.artifact.id}/png`}
                                   alt=""
                                   width={member.artifact.width}
                                   height={member.artifact.height}
                                   unoptimized
                                   className="h-auto max-h-8 w-auto max-w-28 object-contain brightness-0 dark:invert"
                                   decoding="async"
                                 />
                               </button>
                             ) : collection.status === "OPEN" ? (
                               <CaptureAction collectionId={collection.id} member={member} isIpad={isIpad} primaryCapture={member.roleGroup === "PLAYER" || member.roleGroup === "CREATIVE_STAFF" || isAdministrationRoster} />
                             ) : null}
                           </div>

                           <div className="flex items-center justify-center">
                             {showRowActions && (
                               <OperationalRowActions label={`Actions for ${member.name}'s signature`} triggerClassName="size-11">
                                 {member.artifact && collection.status === "OPEN" && (isIpad ? (
                                   <DropdownMenuItem asChild>
                                     <Link href={`/signatures/${collection.id}/capture/${member.id}`}><FilePenLine />Replace signature</Link>
                                   </DropdownMenuItem>
                                 ) : (
                                   <DropdownMenuItem disabled title={CAPTURE_ON_IPAD_TOOLTIP}><FilePenLine />Replace on iPad</DropdownMenuItem>
                                 ))}
                                 {member.artifact && (
                                   <>
                                     <DropdownMenuItem asChild>
                                       <a href={`/api/signatures/artifacts/${member.artifact.id}/png?download=1`}><Download />Download PNG</a>
                                     </DropdownMenuItem>
                                     <DropdownMenuItem asChild>
                                       <a href={`/api/signatures/artifacts/${member.artifact.id}/svg?download=1`}><Download />Download SVG</a>
                                     </DropdownMenuItem>
                                   </>
                                 )}
                                 {priorRevisions.length > 0 && (
                                   <>
                                     <DropdownMenuSeparator />
                                     <DropdownMenuLabel className="flex items-center gap-2 text-xs text-muted-foreground"><History className="size-4" />Previous versions</DropdownMenuLabel>
                                     {member.revisionHistoryTruncated && (
                                       <DropdownMenuItem disabled>
                                         Showing {priorRevisions.length} of {Math.max(0, (member.revisionCount ?? priorRevisions.length + 1) - 1)} previous versions
                                       </DropdownMenuItem>
                                     )}
                                     {priorRevisions.flatMap((revision, index) => [
                                       <DropdownMenuItem key={`${revision.id}-png`} asChild>
                                         <a href={`/api/signatures/artifacts/${revision.id}/png?download=1`}><Download />Version {revision.revision} PNG</a>
                                       </DropdownMenuItem>,
                                       <DropdownMenuItem key={`${revision.id}-svg`} asChild>
                                         <a href={`/api/signatures/artifacts/${revision.id}/svg?download=1`}><Download />Version {revision.revision} SVG</a>
                                       </DropdownMenuItem>,
                                       index < priorRevisions.length - 1 ? <DropdownMenuSeparator key={`${revision.id}-separator`} /> : null,
                                     ])}
                                   </>
                                 )}
                                 {member.artifact && collection.status === "OPEN" && <DropdownMenuItem variant="destructive" onSelect={() => remove(member)}><Trash2 />Remove signature</DropdownMenuItem>}
                                 {canChangeRequirement && <DropdownMenuItem onSelect={() => toggleRequired(member)}>{member.required ? "Exclude from readiness" : "Include in readiness"}</DropdownMenuItem>}
                                 {canRemoveFromRoster && (
                                   <>
                                     {(member.artifact || priorRevisions.length > 0) && <DropdownMenuSeparator />}
                                     <DropdownMenuItem variant="destructive" onSelect={() => removeFromRoster(member)}><Trash2 />Remove from roster</DropdownMenuItem>
                                   </>
                                 )}
                               </OperationalRowActions>
                             )}
                           </div>
                         </div>
                       );
                     })}
                   </div>
                 </div>
                 )}
                  </CollapsibleContent>
                 </section>
               </Collapsible>
              );
            })}
          </div>
        )}

       {isAdmin && collection.status === "OPEN" && (
         <Collapsible open={settingsOpen} onOpenChange={setSettingsOpen}>
           <Card>
              <CollapsibleTrigger asChild>
                <button type="button" className="flex min-h-14 w-full items-center gap-3 rounded-md px-4 text-left outline-none hover:bg-muted/15 focus-visible:ring-[3px] focus-visible:ring-ring/50">
                  {settingsLocked ? <LockKeyhole className="size-4 text-muted-foreground" aria-hidden="true" /> : <Settings2 className="size-4 text-muted-foreground" aria-hidden="true" />}
                  <span className="font-medium">Capture settings</span>
                  <span className="text-sm text-muted-foreground">{settingsLocked ? "Locked after first signature" : "Admin controls"}</span>
                  <ChevronDown className={cn("ml-auto size-4 text-muted-foreground transition-transform", settingsOpen && "rotate-180")} aria-hidden="true" />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
              <CardContent className="space-y-4 border-t pt-4">
                {settingsLocked ? (
                  <div className="flex items-start gap-3 rounded-md border bg-muted/15 p-3 text-sm">
                    <LockKeyhole className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <div><p className="font-medium">Pen settings are locked</p><p className="mt-1 text-muted-foreground">Reset the collection to remove saved signatures before changing capture settings.</p></div>
                  </div>
                ) : (
                  <>
                    <div><CardTitle className="flex items-center gap-2 text-base">Signature output</CardTitle><p className="mt-1 text-sm text-muted-foreground">Controls the ink and transparent PNG/SVG generated for every capture in this roster. These settings lock after the first saved signature.</p></div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  <div className="space-y-2"><Label htmlFor="signature-color">Ink color</Label><Input id="signature-color" type="color" className="h-10 p-1" value={effectiveSettings?.strokeColor ?? "#111827"} onChange={(event) => setSettings({ ...(effectiveSettings ?? collection.penSettings), strokeColor: event.target.value })} /><p className="text-xs text-muted-foreground">Color saved in PNG and SVG files.</p></div>
                  <div className="space-y-2"><Label htmlFor="signature-width">Line thickness</Label><Input id="signature-width" type="number" min={1} max={24} value={effectiveSettings?.strokeWidth ?? 4} onChange={(event) => setSettings({ ...(effectiveSettings ?? collection.penSettings), strokeWidth: Number(event.target.value) })} /><p className="text-xs text-muted-foreground">Width of each signature stroke.</p></div>
                  <div className="space-y-2"><Label htmlFor="signature-padding">Trim margin</Label><Input id="signature-padding" type="number" min={0} max={128} value={effectiveSettings?.cropPadding ?? 24} onChange={(event) => setSettings({ ...(effectiveSettings ?? collection.penSettings), cropPadding: Number(event.target.value) })} /><p className="text-xs text-muted-foreground">Transparent space kept around the ink.</p></div>
                  <div className="space-y-2"><Label htmlFor="signature-width-limit">Maximum width</Label><Input id="signature-width-limit" type="number" min={128} max={2000} value={effectiveSettings?.maxWidth ?? 1600} onChange={(event) => setSettings({ ...(effectiveSettings ?? collection.penSettings), maxWidth: Number(event.target.value) })} /><p className="text-xs text-muted-foreground">Largest exported PNG width in pixels.</p></div>
                  <div className="space-y-2"><Label htmlFor="signature-height-limit">Maximum height</Label><Input id="signature-height-limit" type="number" min={128} max={2000} value={effectiveSettings?.maxHeight ?? 900} onChange={(event) => setSettings({ ...(effectiveSettings ?? collection.penSettings), maxHeight: Number(event.target.value) })} /><p className="text-xs text-muted-foreground">Largest exported PNG height in pixels.</p></div>
                </div>
                    <Button className="h-10" onClick={saveSettings} disabled={savingSettings || !settings}>Save settings</Button>
                  </>
                )}
                {effectiveSettings && <SignaturePenPreview settings={effectiveSettings} />}
                <Separator />
                <div className="flex flex-col gap-3 rounded-md border border-destructive/30 bg-destructive/[0.03] p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div><p className="text-sm font-semibold text-destructive">Danger zone</p><p className="mt-1 text-xs text-muted-foreground">Remove every saved signature and queue its files for cleanup.</p></div>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                       <Button variant="destructive" className="h-10 shrink-0" disabled={!hasCapturedSignatures || resettingCollection}><RotateCcw data-icon="inline-start" />Reset all captures</Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Reset every captured signature?</AlertDialogTitle>
                        <AlertDialogDescription>This removes all saved signatures from {signatureCollectionTitle(collection.sportCode)} and queues the current PNG and SVG files for cleanup. This cannot be undone.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel disabled={resettingCollection}>Cancel</AlertDialogCancel>
                        <AlertDialogAction variant="destructive" onClick={resetCollection} disabled={resettingCollection}>Reset all captures</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </CardContent>
              </CollapsibleContent>
            </Card>
         </Collapsible>
       )}
      </div>

      <Dialog open={Boolean(previewMember)} onOpenChange={(open) => { if (!open) setPreviewMember(null); }}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader className="block pr-14">
            <DialogTitle>{previewMember?.name}</DialogTitle>
            <DialogDescription className="sr-only">Automatically cropped signature preview and private downloads.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <div className="flex min-h-72 items-center justify-center rounded-lg border bg-[linear-gradient(45deg,var(--muted)_25%,transparent_25%),linear-gradient(-45deg,var(--muted)_25%,transparent_25%),linear-gradient(45deg,transparent_75%,var(--muted)_75%),linear-gradient(-45deg,transparent_75%,var(--muted)_75%)] bg-[length:24px_24px] bg-[position:0_0,0_12px,12px_-12px,-12px_0px] p-8">
              {previewMember?.artifact && <Image src={`/api/signatures/artifacts/${previewMember.artifact.id}/png`} alt={`${previewMember.name} signature`} width={previewMember.artifact.width} height={previewMember.artifact.height} unoptimized className="h-auto max-h-[55vh] w-auto max-w-full object-contain brightness-0 dark:invert" priority />}
            </div>
          </DialogBody>
          {previewMember?.artifact && (
            <DialogFooter>
              <Button variant="outline" className="h-11 sm:min-w-40" asChild><a href={`/api/signatures/artifacts/${previewMember.artifact.id}/svg?download=1`}><Download data-icon="inline-start" />Download SVG</a></Button>
              <Button className="h-11 sm:min-w-40" asChild><a href={`/api/signatures/artifacts/${previewMember.artifact.id}/png?download=1`}><Download data-icon="inline-start" />Download PNG</a></Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

    </FadeUp>
  );
}
