"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useBreadcrumbLabel } from "@/components/BreadcrumbContext";
import { toast } from "sonner";
import {
  PlusIcon,
  Trash2Icon,
  SearchIcon,
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowLeftIcon,
  XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import EmptyState from "@/components/EmptyState";
import { FadeUp } from "@/components/ui/motion";
import { PageHeader } from "@/components/PageHeader";
import { SaveableField, useSaveField } from "@/components/SaveableField";
import { OperationalRowActions } from "@/components/OperationalRowActions";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import { useFetch } from "@/hooks/use-fetch";
import { classifyAssetType, EQUIPMENT_SECTIONS } from "@/lib/equipment-sections";
import type { EquipmentSectionKey } from "@/lib/equipment-sections";

// ── Types ─────────────────────────────────────────────────

type KitMember = {
  id: string; // membership id
  createdAt: string;
  asset: {
    id: string;
    assetTag: string;
    name: string | null;
    type: string;
    brand: string;
    model: string;
    status: string;
    imageUrl: string | null;
    category: { id: string; name: string } | null;
  };
};

type KitBulkMember = {
  id: string;
  quantity: number;
  bulkSku: {
    id: string;
    name: string;
    category: string;
    unit: string;
    imageUrl: string | null;
  };
};

type KitDetail = {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  location: { id: string; name: string };
  members: KitMember[];
  bulkMembers: KitBulkMember[];
};

type SearchResult = {
  id: string;
  assetTag: string;
  name: string | null;
  brand: string;
  model: string;
  type: string;
  imageUrl: string | null;
};

type BulkSkuOption = {
  id: string;
  name: string;
  category: string | null;
  unit: string;
  availableQuantity?: number;
};

// ── Component ─────────────────────────────────────────────

export default function KitDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { setBreadcrumbLabel } = useBreadcrumbLabel();
  const queryClient = useQueryClient();

  const kitUrl = `/api/kits/${id}`;
  const { data: kit, loading, error: loadError } = useFetch<KitDetail>({
    url: kitUrl,
    transform: (json) => (json as Record<string, unknown>).data as KitDetail,
  });

  // Set breadcrumb label when kit loads
  useEffect(() => {
    if (kit?.name) setBreadcrumbLabel(kit.name);
  }, [kit?.name, setBreadcrumbLabel]);

  // Helper to optimistically update kit in the React Query cache
  const setKit = useCallback(
    (updater: KitDetail | ((prev: KitDetail | null) => KitDetail | null)) => {
      queryClient.setQueryData(["fetch", kitUrl], (prev: Record<string, unknown> | undefined) => {
        const prevKit = prev ? (prev as Record<string, unknown>).data as KitDetail : null;
        const next = typeof updater === "function" ? updater(prevKit) : updater;
        return next ? { data: next } : prev;
      });
    },
    [queryClient, kitUrl],
  );

  // Add member search
  const [addSearch, setAddSearch] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [addingIds, setAddingIds] = useState<Set<string>>(new Set());
  const addingIdsRef = useRef<Set<string>>(new Set());
  const togglingActiveRef = useRef(false);
  const deletingRef = useRef(false);
  const searchAbort = useRef<AbortController | null>(null);

  // Add item family (bulk SKU) — lazy-loaded location options, client-filtered
  const [bulkAddSearch, setBulkAddSearch] = useState("");
  const [bulkOptions, setBulkOptions] = useState<BulkSkuOption[] | null>(null);
  const [bulkOptionsLoading, setBulkOptionsLoading] = useState(false);
  const [bulkOptionsError, setBulkOptionsError] = useState("");
  const [bulkQty, setBulkQty] = useState<Record<string, string>>({});
  const [bulkAddingIds, setBulkAddingIds] = useState<Set<string>>(new Set());
  const bulkAddingIdsRef = useRef<Set<string>>(new Set());

  // Remove member
  const [removingId, setRemovingId] = useState<string | null>(null);
  const removingRef = useRef(false);
  const [removeTarget, setRemoveTarget] = useState<KitMember | null>(null);
  const [bulkRemoveTarget, setBulkRemoveTarget] = useState<KitBulkMember | null>(null);

  // Delete kit
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [togglingActive, setTogglingActive] = useState(false);

  // ── Inline save handlers ────────────────────────────────

  const saveName = useSaveField(
    useCallback(async (value: string) => {
      const res = await fetch(`/api/kits/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: value }),
      });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) throw new Error(await parseErrorMessage(res, "Failed to save kit name"));
      const json = await parseJsonSafely<{ data?: KitDetail }>(res);
      if (!json?.data) throw new Error("Kit was saved, but the response was incomplete");
      setKit(json.data);
    }, [id, setKit])
  );

  const saveDescription = useSaveField(
    useCallback(async (value: string) => {
      const res = await fetch(`/api/kits/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: value || null }),
      });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) throw new Error(await parseErrorMessage(res, "Failed to save kit description"));
      const json = await parseJsonSafely<{ data?: KitDetail }>(res);
      if (!json?.data) throw new Error("Kit was saved, but the response was incomplete");
      setKit(json.data);
    }, [id, setKit])
  );

  // ── Search for assets to add ────────────────────────────

  useEffect(() => {
    if (!addSearch.trim() || addSearch.trim().length < 2) {
      setSearchResults([]);
      setSearchError("");
      return;
    }
    const timer = setTimeout(async () => {
      searchAbort.current?.abort();
      const controller = new AbortController();
      searchAbort.current = controller;
      setSearching(true);
      setSearchError("");
      try {
        const res = await fetch(
          `/api/assets?q=${encodeURIComponent(addSearch.trim())}&limit=10`,
          { signal: controller.signal }
        );
        if (handleAuthRedirect(res)) return;
        if (!res.ok) throw new Error(await parseErrorMessage(res, "Failed to search items"));
        const json = await parseJsonSafely<{ data?: SearchResult[] }>(res);
        if (controller.signal.aborted) return;
        // Filter out assets already in kit
        const existingIds = new Set(kit?.members.map((m) => m.asset.id) ?? []);
        setSearchResults(
          (json?.data ?? []).filter((a) => !existingIds.has(a.id))
        );
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setSearchResults([]);
          setSearchError((err as Error).message || "Failed to search items");
        }
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [addSearch, kit?.members]);

  // ── Lazy-load location item families when the bulk add-search is first used ──

  useEffect(() => {
    if (!kit) return;
    if (!bulkAddSearch.trim()) return;
    if (bulkOptions !== null || bulkOptionsLoading) return;
    let cancelled = false;
    (async () => {
      setBulkOptionsLoading(true);
      setBulkOptionsError("");
      try {
        const res = await fetch(
          `/api/bulk-skus?location_id=${encodeURIComponent(kit.location.id)}&limit=200`,
        );
        if (handleAuthRedirect(res)) return;
        if (!res.ok) throw new Error(await parseErrorMessage(res, "Failed to load item families"));
        const json = await parseJsonSafely<{ data?: BulkSkuOption[] }>(res);
        if (cancelled) return;
        setBulkOptions(json?.data ?? []);
      } catch (err) {
        if (!cancelled) {
          setBulkOptions([]);
          setBulkOptionsError((err as Error).message || "Failed to load item families");
        }
      } finally {
        if (!cancelled) setBulkOptionsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [bulkAddSearch, bulkOptions, bulkOptionsLoading, kit]);

  // ── Add member ──────────────────────────────────────────

  async function handleAddMember(assetId: string) {
    if (addingIdsRef.current.has(assetId)) return;
    addingIdsRef.current.add(assetId);
    setAddingIds((s) => new Set(s).add(assetId));
    try {
      const res = await fetch(`/api/kits/${id}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetIds: [assetId] }),
      });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) {
        throw new Error(await parseErrorMessage(res, "Failed to add item"));
      }
      const json = await parseJsonSafely<{ data?: KitDetail }>(res);
      if (!json?.data) throw new Error("Kit was updated, but the response was incomplete");
      setKit(json.data);
      setSearchResults((r) => r.filter((a) => a.id !== assetId));
      toast.success("Item added to kit");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      addingIdsRef.current.delete(assetId);
      setAddingIds((s) => { const n = new Set(s); n.delete(assetId); return n; });
    }
  }

  // ── Add item family (bulk SKU) ──────────────────────────

  async function handleAddBulkMember(opt: BulkSkuOption) {
    if (bulkAddingIdsRef.current.has(opt.id)) return;
    const parsed = Math.floor(Number(bulkQty[opt.id] ?? "1"));
    const quantity = Number.isFinite(parsed) ? Math.min(999, Math.max(1, parsed)) : 1;
    bulkAddingIdsRef.current.add(opt.id);
    setBulkAddingIds((s) => new Set(s).add(opt.id));
    try {
      const res = await fetch(`/api/kits/${id}/bulk-members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bulkSkuId: opt.id, quantity }),
      });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) throw new Error(await parseErrorMessage(res, "Failed to add item family"));
      const json = await parseJsonSafely<{ data?: KitBulkMember }>(res);
      if (!json?.data) throw new Error("Kit was updated, but the response was incomplete");
      const membership = json.data;
      setKit((prev) =>
        prev ? { ...prev, bulkMembers: [...(prev.bulkMembers ?? []), membership] } : prev,
      );
      setBulkQty((m) => { const n = { ...m }; delete n[opt.id]; return n; });
      toast.success(`Added ${membership.bulkSku.name}`);
    } catch (err) {
      toast.error((err as Error).message || "Failed to add item family");
    } finally {
      bulkAddingIdsRef.current.delete(opt.id);
      setBulkAddingIds((s) => { const n = new Set(s); n.delete(opt.id); return n; });
    }
  }

  // ── Remove member ───────────────────────────────────────

  async function handleRemoveMember(member: KitMember) {
    if (removingRef.current) return;
    removingRef.current = true;
    setRemovingId(member.id);
    try {
      const res = await fetch(`/api/kits/${id}/members/${member.id}`, { method: "DELETE" });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) throw new Error(await parseErrorMessage(res, "Failed to remove item"));
      setKit((prev) =>
        prev ? { ...prev, members: prev.members.filter((m) => m.id !== member.id) } : prev
      );
      toast.success(`Removed ${member.asset.assetTag}`);
    } catch (err) {
      toast.error((err as Error).message || "Failed to remove item");
    } finally {
      removingRef.current = false;
      setRemovingId(null);
      setRemoveTarget(null);
    }
  }

  async function handleRemoveBulkMember(member: KitBulkMember) {
    if (removingRef.current) return;
    removingRef.current = true;
    setRemovingId(member.id);
    try {
      const res = await fetch(`/api/kits/${id}/bulk-members?membershipId=${member.id}`, { method: "DELETE" });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) throw new Error(await parseErrorMessage(res, "Failed to remove item family"));
      setKit((prev) =>
        prev ? { ...prev, bulkMembers: prev.bulkMembers.filter((m) => m.id !== member.id) } : prev
      );
      toast.success(`Removed ${member.bulkSku.name}`);
    } catch (err) {
      toast.error((err as Error).message || "Failed to remove item family");
    } finally {
      removingRef.current = false;
      setRemovingId(null);
      setBulkRemoveTarget(null);
    }
  }

  // ── Archive / Restore ───────────────────────────────────

  async function handleToggleActive() {
    if (!kit) return;
    if (togglingActiveRef.current) return;
    togglingActiveRef.current = true;
    setTogglingActive(true);
    try {
      const res = await fetch(`/api/kits/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !kit.active }),
      });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) throw new Error(await parseErrorMessage(res, "Failed to update kit"));
      const json = await parseJsonSafely<{ data?: KitDetail }>(res);
      if (!json?.data) throw new Error("Kit was updated, but the response was incomplete");
      const data = json.data;
      setKit(data);
      toast.success(data.active ? "Kit restored" : "Kit archived");
    } catch (err) {
      toast.error((err as Error).message || "Failed to update kit");
    } finally {
      togglingActiveRef.current = false;
      setTogglingActive(false);
    }
  }

  // ── Delete kit ──────────────────────────────────────────

  async function handleDelete() {
    if (deletingRef.current) return;
    deletingRef.current = true;
    setDeleting(true);
    try {
      const res = await fetch(`/api/kits/${id}`, { method: "DELETE" });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) throw new Error(await parseErrorMessage(res, "Failed to delete kit"));
      toast.success("Kit deleted");
      router.replace("/kits");
    } catch (err) {
      toast.error((err as Error).message || "Failed to delete kit");
    } finally {
      deletingRef.current = false;
      setDeleting(false);
      setDeleteOpen(false);
    }
  }

  // ── Group members by section ────────────────────────────

  const groupedMembers = kit
    ? groupMembersBySection(kit.members)
    : null;

  // ── Loading state ───────────────────────────────────────

  if (loading) {
    return (
      <>
        <div className="mb-8 flex flex-col gap-2">
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="grid gap-4">
          <Card className="flex flex-col gap-4 p-6">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-20 w-full" />
          </Card>
          <Card className="flex flex-col gap-3 p-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </Card>
        </div>
      </>
    );
  }

  if (loadError || !kit) {
    return (
      <Card>
        <EmptyState
          icon="wifi-off"
          title="Failed to load kit"
          description="Check your connection and try again."
          actionLabel="Back to Kits"
          actionHref="/kits"
        />
      </Card>
    );
  }

  const existingBulkIds = new Set(kit.bulkMembers?.map((m) => m.bulkSku.id) ?? []);
  const bulkQuery = bulkAddSearch.trim().toLowerCase();
  const bulkSearchResults = (bulkOptions ?? [])
    .filter((o) => !existingBulkIds.has(o.id))
    .filter(
      (o) =>
        !bulkQuery ||
        o.name.toLowerCase().includes(bulkQuery) ||
        (o.category ?? "").toLowerCase().includes(bulkQuery),
    )
    .slice(0, 10);

  return (
    <FadeUp>
      <PageHeader
        title={kit.name}
        description={`${kit.location.name} · ${kit.members.length + kit.bulkMembers.length} total contents`}
      >
        <Button variant="outline" className="h-10" onClick={() => router.push("/kits")}>
          <ArrowLeftIcon className="size-4" />
          Back
        </Button>
        {!kit.active && <Badge variant="outline" className="h-10 px-3">Archived</Badge>}
        <Button variant="outline" className="h-10" onClick={handleToggleActive} disabled={togglingActive || deleting}>
            {togglingActive && <Spinner data-icon="inline-start" />}
            {kit.active ? (
              <><ArchiveIcon className="mr-2 size-4" />Archive</>
            ) : (
              <><ArchiveRestoreIcon className="mr-2 size-4" />Restore</>
            )}
        </Button>
        <Button variant="destructive" className="h-10" onClick={() => setDeleteOpen(true)} disabled={togglingActive || deleting}>
          <Trash2Icon className="mr-2 size-4" />Delete
        </Button>
      </PageHeader>

      <div className="grid gap-4">
        {/* Info Card */}
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle className="text-base">Kit Info</CardTitle>
          </CardHeader>
          <CardContent className="flex min-w-0 flex-col gap-1">
            <SaveableField label="Name" status={saveName.status} htmlFor="kit-name">
              <Input
                id="kit-name"
                defaultValue={kit.name}
                onBlur={(e) => {
                  const val = e.target.value.trim();
                  if (val && val !== kit.name) saveName.save(val);
                }}
              />
            </SaveableField>
            <SaveableField label="Description" status={saveDescription.status} htmlFor="kit-desc">
              <Input
                id="kit-desc"
                defaultValue={kit.description ?? ""}
                placeholder="Optional description"
                onBlur={(e) => {
                  const val = e.target.value.trim();
                  if (val !== (kit.description ?? "")) saveDescription.save(val);
                }}
              />
            </SaveableField>
            <SaveableField label="Location">
              <Badge variant="secondary">{kit.location.name}</Badge>
            </SaveableField>
            <SaveableField label="Created">
              <span className="text-sm">{new Date(kit.createdAt).toLocaleDateString()}</span>
            </SaveableField>
          </CardContent>
        </Card>

        {/* Members Card */}
        <Card className="min-w-0">
          <CardHeader className="flex-row items-center justify-between flex flex-col gap-0">
            <CardTitle className="text-base">
              Equipment ({kit.members.length} item{kit.members.length !== 1 ? "s" : ""})
            </CardTitle>
          </CardHeader>
          <CardContent className="flex min-w-0 flex-col gap-4">
            {/* Add member search */}
            <div className="flex flex-col gap-2">
              <div className="relative">
                <Label htmlFor="kit-add-member-search" className="sr-only">
                  Search items to add
                </Label>
                <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                  id="kit-add-member-search"
                  name="kitAddMemberSearch"
                  aria-label="Search items to add"
                  placeholder="Search items to add…"
                  value={addSearch}
                  onChange={(e) => setAddSearch(e.target.value)}
                  className="pl-9 pr-9"
                />
                {addSearch && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-1/2 size-10 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label="Clear item search"
                    onClick={() => { setAddSearch(""); setSearchResults([]); }}
                  >
                    <XIcon className="size-4" />
                  </Button>
                )}
              </div>
              {searching && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground px-1">
                  <Spinner className="size-3.5" /> Searching…
                </div>
              )}
              {searchError && (
                <p className="px-1 text-sm text-destructive">{searchError}</p>
              )}
              {searchResults.length > 0 && (
                <ScrollArea className="border rounded-md divide-y max-h-[240px]">
                  {searchResults.map((asset) => (
                    <div
                      key={asset.id}
                      className="flex items-center justify-between px-3 py-2 hover:bg-muted/50"
                    >
                      <div>
                        <span className="font-medium text-sm">{asset.assetTag}</span>
                        <span className="text-muted-foreground text-sm ml-2">
                          {asset.brand} {asset.model}
                        </span>
                      </div>
                      <Button className="h-10"
                        variant="outline"
                        disabled={addingIds.has(asset.id)}
                        onClick={() => handleAddMember(asset.id)}
                      >
                        {addingIds.has(asset.id) ? (
                          <Spinner className="size-3.5" />
                        ) : (
                          <><PlusIcon className="size-3.5 mr-1" />Add</>
                        )}
                      </Button>
                    </div>
                  ))}
                </ScrollArea>
              )}
              {addSearch.trim().length >= 2 && !searching && !searchError && searchResults.length === 0 && (
                <EmptyState
                  icon="search"
                  title="No matching items"
                  description="Try a different tag, name, brand, or model."
                  inline
                />
              )}
            </div>

            {/* Members grouped by section */}
            {kit.members.length === 0 ? (
              <EmptyState
                icon="box"
                title="No items in this kit"
                description="Search above to add equipment to this kit."
              />
            ) : (
              groupedMembers &&
              EQUIPMENT_SECTIONS.filter((s) => (groupedMembers[s.key]?.length ?? 0) > 0).map(
                (section) => (
                  <div key={section.key}>
                    <h3 className="text-sm font-medium text-muted-foreground mb-2">
                      {section.label} ({groupedMembers[section.key].length})
                    </h3>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Tag</TableHead>
                            <TableHead>Description</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="w-[60px]" />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {groupedMembers[section.key].map((member) => (
                            <TableRow key={member.id}>
                              <TableCell className="font-medium">
                                {member.asset.assetTag}
                              </TableCell>
                              <TableCell className="text-muted-foreground">
                                {member.asset.brand} {member.asset.model}
                              </TableCell>
                              <TableCell>
                                <AssetStatusBadge status={member.asset.status} />
                              </TableCell>
                              <TableCell>
                                <OperationalRowActions label={`Actions for ${member.asset.assetTag}`}>
                                  <DropdownMenuItem
                                    className="text-destructive focus:text-destructive"
                                    disabled={removingId !== null}
                                    onSelect={() => setRemoveTarget(member)}
                                  >
                                    {removingId === member.id ? (
                                      <Spinner data-icon="inline-start" />
                                    ) : (
                                      <Trash2Icon className="mr-2 size-4" aria-hidden="true" />
                                    )}
                                    Remove from kit
                                  </DropdownMenuItem>
                                </OperationalRowActions>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )
              )
            )}
          </CardContent>
        </Card>
      </div>

      {/* Bulk members section */}
      {(kit.bulkMembers?.length > 0 || kit.active) && (
        <div className="mt-6">
          <Card className="min-w-0">
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="text-base">Bulk Items</CardTitle>
            </CardHeader>
            <CardContent className="flex min-w-0 flex-col gap-4">
              {/* Add item family search */}
              {kit.active && (
                <div className="flex flex-col gap-2">
                  <div className="relative">
                    <Label htmlFor="kit-add-bulk-search" className="sr-only">
                      Search item families to add
                    </Label>
                    <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                    <Input
                      id="kit-add-bulk-search"
                      name="kitAddBulkSearch"
                      aria-label="Search item families to add"
                      placeholder="Search item families to add…"
                      value={bulkAddSearch}
                      onChange={(e) => setBulkAddSearch(e.target.value)}
                      className="pl-9 pr-9"
                    />
                    {bulkAddSearch && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-0 top-1/2 size-10 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        aria-label="Clear item family search"
                        onClick={() => setBulkAddSearch("")}
                      >
                        <XIcon className="size-4" />
                      </Button>
                    )}
                  </div>
                  {bulkOptionsLoading && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground px-1">
                      <Spinner className="size-3.5" /> Loading…
                    </div>
                  )}
                  {bulkOptionsError && (
                    <p className="px-1 text-sm text-destructive">{bulkOptionsError}</p>
                  )}
                  {bulkSearchResults.length > 0 && (
                    <ScrollArea className="border rounded-md divide-y max-h-[240px]">
                      {bulkSearchResults.map((opt) => (
                        <div
                          key={opt.id}
                          className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-muted/50"
                        >
                          <div className="min-w-0">
                            <span className="font-medium text-sm">{opt.name}</span>
                            {opt.category && (
                              <span className="text-muted-foreground text-sm ml-2">{opt.category}</span>
                            )}
                            {typeof opt.availableQuantity === "number" && (
                              <span className="block text-xs text-muted-foreground">
                                {opt.availableQuantity} {opt.unit} available
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <Label htmlFor={`kit-bulk-qty-${opt.id}`} className="sr-only">
                              Quantity for {opt.name}
                            </Label>
                            <Input
                              id={`kit-bulk-qty-${opt.id}`}
                              type="number"
                              min={1}
                              max={999}
                              value={bulkQty[opt.id] ?? "1"}
                              onChange={(e) =>
                                setBulkQty((m) => ({ ...m, [opt.id]: e.target.value }))
                              }
                              className="h-10 w-20"
                              aria-label={`Quantity for ${opt.name}`}
                            />
                            <Button className="h-10"
                              variant="outline"
                              disabled={bulkAddingIds.has(opt.id)}
                              onClick={() => handleAddBulkMember(opt)}
                            >
                              {bulkAddingIds.has(opt.id) ? (
                                <Spinner className="size-3.5" />
                              ) : (
                                <><PlusIcon className="size-3.5 mr-1" />Add</>
                              )}
                            </Button>
                          </div>
                        </div>
                      ))}
                    </ScrollArea>
                  )}
                  {bulkQuery.length >= 1 &&
                    !bulkOptionsLoading &&
                    !bulkOptionsError &&
                    bulkSearchResults.length === 0 && (
                      <EmptyState
                        icon="search"
                        title={
                          bulkOptions && bulkOptions.length > 0
                            ? "No matching item families"
                            : "No item families available"
                        }
                        description={
                          bulkOptions && bulkOptions.length > 0
                            ? "Try another item family name."
                            : "Add item families at this kit location before adding them to the kit."
                        }
                        inline
                      />
                    )}
                </div>
              )}
              {kit.bulkMembers?.length > 0 ? (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="w-12" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {kit.bulkMembers.map((bm) => (
                        <TableRow key={bm.id}>
                          <TableCell className="font-medium">{bm.bulkSku.name}</TableCell>
                          <TableCell className="text-muted-foreground">{bm.bulkSku.category}</TableCell>
                          <TableCell className="text-right">
                            <Badge variant="secondary" size="sm">{bm.quantity} {bm.bulkSku.unit}</Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            {kit.active && (
                              <OperationalRowActions label={`Actions for ${bm.bulkSku.name}`}>
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  disabled={removingId !== null}
                                  onSelect={() => setBulkRemoveTarget(bm)}
                                >
                                  {removingId === bm.id ? (
                                    <Spinner data-icon="inline-start" />
                                  ) : (
                                    <Trash2Icon className="mr-2 size-4" aria-hidden="true" />
                                  )}
                                  Remove from kit
                                </DropdownMenuItem>
                              </OperationalRowActions>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <EmptyState
                  icon="box"
                  title="No item families in this kit"
                  description="Search above to add quantity-tracked or unit-tracked item families."
                  inline
                />
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Remove member confirmation */}
      <AlertDialog open={!!removeTarget} onOpenChange={(v) => { if (!v) setRemoveTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove from kit?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove <strong>{removeTarget?.asset.assetTag}</strong> from this kit?
              The item won&apos;t be deleted — just removed from the kit.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={removingId === removeTarget?.id}
              onClick={() => removeTarget && handleRemoveMember(removeTarget)}
            >
              {removingId === removeTarget?.id && <Spinner data-icon="inline-start" />}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Remove bulk member confirmation */}
      <AlertDialog open={!!bulkRemoveTarget} onOpenChange={(v) => { if (!v) setBulkRemoveTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove item family from kit?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove <strong>{bulkRemoveTarget?.quantity} {bulkRemoveTarget?.bulkSku.unit} of {bulkRemoveTarget?.bulkSku.name}</strong> from this kit?
              The item family and stock counts won&apos;t be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removingId === bulkRemoveTarget?.id}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={removingId === bulkRemoveTarget?.id}
              onClick={() => bulkRemoveTarget && handleRemoveBulkMember(bulkRemoveTarget)}
            >
              {removingId === bulkRemoveTarget?.id && <Spinner data-icon="inline-start" />}
              Remove from Kit
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete kit confirmation */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete kit?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{kit.name}</strong> and remove all member
              associations. The items themselves won&apos;t be affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting && <Spinner data-icon="inline-start" />}
              Delete Kit
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </FadeUp>
  );
}

// ── Helpers ───────────────────────────────────────────────

function AssetStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
    AVAILABLE: { label: "Available", variant: "default" },
    MAINTENANCE: { label: "Maintenance", variant: "outline" },
    RETIRED: { label: "Retired", variant: "secondary" },
  };
  const info = map[status] ?? { label: status, variant: "secondary" as const };
  return <Badge variant={info.variant}>{info.label}</Badge>;
}

function groupMembersBySection(members: KitMember[]): Record<EquipmentSectionKey, KitMember[]> {
  const groups: Record<EquipmentSectionKey, KitMember[]> = {
    cameras: [],
    lenses: [],
    batteries: [],
    audio: [],
    tripods: [],
    lighting: [],
    other: [],
  };
  for (const member of members) {
    const section = classifyAssetType(
      member.asset.type,
      member.asset.category?.name
    );
    groups[section].push(member);
  }
  return groups;
}
