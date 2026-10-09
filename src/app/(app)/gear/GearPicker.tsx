"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BarChart3Icon, ChevronDownIcon, ListChecksIcon, LockIcon, SearchIcon, SlidersHorizontalIcon } from "lucide-react";
import EmptyState from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Label } from "@/components/ui/label";
import { FadeUp } from "@/components/ui/motion";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { GEAR_PICKS_ME_QUERY_KEY, useGearPicksMe } from "@/hooks/use-gear-picks";
import { handleAuthRedirect, parseJsonSafely } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import {
  dollarsToCents,
  findGearSku,
  formatUsd,
  GEAR_CATALOG,
  gearSku,
  itemsForFit,
  type GearCatalogItem,
} from "@/lib/gear-picks/catalog";
import type { GearPicksMeResponse, GearPickSubmissionDto } from "@/lib/gear-picks/types";
import { cn } from "@/lib/utils";
import {
  categoryAnchorId,
  defaultSizeFor,
  draftLineId,
  draftLineProblems,
  draftLinesFromServer,
  draftTotalCents,
  itemSearchText,
  type DraftLine,
} from "./gear-pick-state";
import { GearItemCard, gearItemAnchorId } from "./GearItemCard";
import { GearPicksSheet, type GearPicksSheetMode } from "./GearPicksSheet";
import { GearPreviewDialog, type GearPreview } from "./GearPreviewDialog";

const KIT_LABELS = { STANDARD_ISSUE: "Standard issue", CORE_KIT: "Core kit" } as const;

export function GearPicker() {
  const { data, isLoading, isError, refetch } = useGearPicksMe();

  if (isLoading) {
    return (
      <div className="space-y-4" aria-label="Loading your gear picks" aria-busy="true">
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-40 w-full rounded-lg" />
        <Skeleton className="h-96 w-full rounded-lg" />
      </div>
    );
  }

  if (isError && !data) {
    return (
      <EmptyState
        icon="wifi-off"
        title="Couldn't load your gear picks"
        description="Check your connection and try again."
        actionLabel="Retry"
        onAction={() => void refetch()}
      />
    );
  }

  if (!data?.cycle) {
    return (
      <EmptyState
        icon="calendar"
        title="Gear picks aren't open"
        description="There's no Under Armour gear pick window right now."
      />
    );
  }

  if (!data.participant) {
    return (
      <FadeUp>
        <PageHeader title="UA staff gear" description={data.cycle.title}>
          {data.isAdmin && <AdminResultsLink />}
        </PageHeader>
        {data.isAdmin ? (
          <EmptyState
            icon="users"
            title="You're not on this year's pick list"
            description="Add yourself on the results page to try the catalog, review, and submit exactly as staff will. You can remove yourself afterwards."
            actionLabel="Open results"
            actionHref="/gear/admin"
          />
        ) : (
          <EmptyState
            icon="users"
            title="You're not on this year's pick list"
            description="Under Armour staff picks are for full-time creative staff on the 2027–28 roster. If you should be picking, ask an admin to add you."
          />
        )}
      </FadeUp>
    );
  }

  return <GearPickerForm key={`${data.cycle.id}:${data.participant.id}`} data={data} />;
}

/** The color a card shows: the one the person tapped, else the first color already in their list. */
function cardColorCode(
  item: GearCatalogItem,
  selectedColors: Record<string, string>,
  linesByStyle: Map<string, DraftLine[]>,
) {
  const chosen = selectedColors[item.style];
  if (chosen) return chosen;
  const pickedSkus = new Set((linesByStyle.get(item.style) ?? []).map((line) => line.sku));
  return (item.colors.find((color) => pickedSkus.has(gearSku(item.style, color.code))) ?? item.colors[0]!).code;
}

function AdminResultsLink() {
  return (
    <Button asChild variant="outline" className="min-h-10">
      <Link href="/gear/admin">
        <BarChart3Icon data-icon="inline-start" />
        See results
      </Link>
    </Button>
  );
}

function GearPickerForm({ data }: { data: GearPicksMeResponse }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const participant = data.participant!;
  const cycle = data.cycle!;
  const fit = participant.fit;
  const allowanceCents = participant.allowanceCents;
  const readOnly = !cycle.isOpen;
  const submittedAt = data.submission?.submittedAt ?? null;
  const serverVersion = data.submission?.version ?? 0;

  const [lines, setLines] = useState<DraftLine[]>(() => draftLinesFromServer(data));
  const [dirty, setDirty] = useState(false);
  // The version belongs to the list being edited, not the latest query cache.
  const [baseVersion, setBaseVersion] = useState(serverVersion);
  const [reloading, setReloading] = useState(false);
  const [saveIssue, setSaveIssue] = useState<string | null>(null);
  const requestInFlight = useRef(false);
  const [saving, setSaving] = useState<"draft" | "submit" | null>(null);
  const [search, setSearch] = useState("");
  const [collection, setCollection] = useState("all");
  const [category, setCategory] = useState("all");
  const [fitsOnly, setFitsOnly] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedColors, setSelectedColors] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<GearPreview | null>(null);
  const [sheetMode, setSheetMode] = useState<GearPicksSheetMode | null>(null);

  // Refresh clean lists, but never rebase unsaved edits onto another tab's version.
  useEffect(() => {
    if (!dirty && !saving && !reloading) {
      setLines(draftLinesFromServer(data));
      setBaseVersion(serverVersion);
    }
  }, [data, dirty, saving, reloading, serverVersion]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const totalCents = draftTotalCents(lines);
  const pickCount = lines.reduce((sum, line) => sum + line.quantity, 0);
  const remainingCents = allowanceCents - totalCents;
  const over = remainingCents < 0;
  const problems = draftLineProblems(lines);

  const items = useMemo(() => itemsForFit(fit), [fit]);
  const searchIndex = useMemo(() => new Map(items.map((item) => [item.style, itemSearchText(item)])), [items]);
  const linesByStyle = useMemo(() => {
    const map = new Map<string, DraftLine[]>();
    for (const line of lines) {
      const style = findGearSku(line.sku)?.item.style;
      if (!style) continue;
      map.set(style, [...(map.get(style) ?? []), line]);
    }
    return map;
  }, [lines]);

  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  let hiddenForBudget = 0;
  const visible = items.filter((item) => {
    const text = searchIndex.get(item.style) ?? "";
    const matchesSearch = words.every((word) => text.includes(word));
    const matchesCollection =
      (collection === "all" || item.collection === collection) && (category === "all" || item.category === category);
    const picked = linesByStyle.has(item.style);
    const fitsBudget = !fitsOnly || picked || dollarsToCents(item.price) <= Math.max(0, remainingCents);
    if (matchesSearch && matchesCollection && !fitsBudget) hiddenForBudget += 1;
    return matchesSearch && matchesCollection && fitsBudget;
  });
  const sections = GEAR_CATALOG.categories
    .map((category) => ({ category, items: visible.filter((item) => item.category === category) }))
    .filter((section) => section.items.length > 0);
  // Headwear and Footwear collections duplicate their categories, so only the
  // real collections (Sideline, Freedom, Ireland) get a collection filter.
  const collections = GEAR_CATALOG.collections.filter(
    (entry) =>
      !GEAR_CATALOG.categories.includes(entry.label) && items.some((item) => item.collection === entry.key),
  );
  const categories = GEAR_CATALOG.categories.filter((entry) => items.some((item) => item.category === entry));

  const updateLines = useCallback((updater: (current: DraftLine[]) => DraftLine[]) => {
    if (requestInFlight.current) return;
    setLines(updater);
    setDirty(true);
  }, []);

  const addLine = useCallback(
    (sku: string) => {
      const entry = findGearSku(sku);
      if (!entry) return;
      const preferred = defaultSizeFor(entry.item, data.profile);
      updateLines((current) => {
        const taken = current.some((line) => line.sku === sku && line.size === preferred);
        return [...current, { id: draftLineId(), sku, size: taken ? null : preferred, quantity: 1 }];
      });
    },
    [data.profile, updateLines],
  );

  const changeLine = useCallback(
    (id: string, patch: Partial<Pick<DraftLine, "sku" | "size" | "quantity">>) => {
      updateLines((current) => current.map((line) => (line.id === id ? { ...line, ...patch } : line)));
    },
    [updateLines],
  );

  const removeLine = useCallback(
    (id: string) => updateLines((current) => current.filter((line) => line.id !== id)),
    [updateLines],
  );

  const selectColor = useCallback((style: string, code: string) => {
    setSelectedColors((current) => ({ ...current, [style]: code }));
    setPreview((current) => (current?.kind === "item" && current.item.style === style ? { ...current, colorCode: code } : current));
  }, []);

  const openSheet = useCallback((mode: GearPicksSheetMode) => setSheetMode(mode), []);

  // Clear filters that could hide the card, then scroll to it once it renders.
  const jumpToItem = useCallback((style: string) => {
    setSheetMode(null);
    setSearch("");
    setCollection("all");
    setCategory("all");
    window.setTimeout(() => {
      document.getElementById(gearItemAnchorId(style))?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 250);
  }, []);

  // Only an explicit, successful fresh read may replace the local list.
  const reloadFromServer = useCallback(async () => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setReloading(true);
    try {
      await queryClient.cancelQueries({ queryKey: GEAR_PICKS_ME_QUERY_KEY, exact: true });
      const response = await fetch("/api/gear-picks/me", { cache: "no-store" });
      if (handleAuthRedirect(response, "/gear")) return;
      const json = await parseJsonSafely<{ data?: GearPicksMeResponse }>(response);
      if (!response.ok || !json?.data?.cycle || !json.data.participant) {
        throw new Error("Could not reload picks");
      }
      setLines(draftLinesFromServer(json.data));
      setBaseVersion(json.data.submission?.version ?? 0);
      setDirty(false);
      setSaveIssue(null);
      queryClient.setQueryData(GEAR_PICKS_ME_QUERY_KEY, json.data);
    } catch {
      setSaveIssue("Couldn't load the saved list. Your unsaved picks are still here. Try reloading again when you're connected.");
    } finally {
      requestInFlight.current = false;
      setReloading(false);
    }
  }, [queryClient]);

  /** Returns true once the server has the list, so the review panel can close. */
  async function save(submit: boolean): Promise<boolean> {
    if (requestInFlight.current || readOnly || baseVersion !== serverVersion || over || problems.length > 0) return false;
    requestInFlight.current = true;
    setSaveIssue(null);
    setSaving(submit ? "submit" : "draft");
    try {
      await queryClient.cancelQueries({ queryKey: GEAR_PICKS_ME_QUERY_KEY, exact: true });
      const response = await fetch("/api/gear-picks/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lines: lines.map(({ sku, size, quantity }) => ({ sku, size, quantity })),
          submit,
          version: baseVersion,
        }),
      });
      if (handleAuthRedirect(response, "/gear")) return false;
      const json = await parseJsonSafely<{ data?: GearPickSubmissionDto; error?: string; code?: string }>(response);
      if (!response.ok || !json?.data) {
        const message = json?.error ?? "We couldn't confirm the save. Your picks are still here. Retry safely, or reload the saved list to check.";
        setSaveIssue(message);
        if (json?.code === "GEAR_PICKS_CLOSED") {
          queryClient.setQueryData<GearPicksMeResponse | null>(GEAR_PICKS_ME_QUERY_KEY, (current) =>
            current?.cycle ? { ...current, cycle: { ...current.cycle, isOpen: false } } : current,
          );
        }
        return false;
      }
      const saved = json.data;
      setLines(draftLinesFromServer({ ...data, submission: saved }));
      setBaseVersion(saved.version);
      setDirty(false);
      queryClient.setQueryData<GearPicksMeResponse | null>(GEAR_PICKS_ME_QUERY_KEY, (current) =>
        current ? { ...current, submission: saved } : current,
      );
      if (submit && !submittedAt) {
        toast.success("Picks submitted. You can still change them until the deadline.", {
          action: { label: "View on profile", onClick: () => router.push("/profile?tab=gear") },
          duration: 10_000,
        });
      } else {
        toast.success("Picks saved.");
      }
      return true;
    } catch {
      setSaveIssue("We couldn't confirm whether your picks saved. Your list is still here. Retry safely, or reload the saved list to check.");
      return false;
    } finally {
      requestInFlight.current = false;
      setSaving(null);
    }
  }

  const kit = GEAR_CATALOG.kits[fit];
  const allowanceLabel = formatUsd(allowanceCents);
  const busy = saving !== null || reloading;
  const conflict = dirty && baseVersion !== serverVersion;
  const recoveryMessage = saveIssue ?? (conflict
    ? "Your saved picks changed in another tab. Your unsaved list is still here. Reload the saved list before making more changes."
    : null);
  const recovery = recoveryMessage ? (
    <div className="my-3 space-y-2 rounded-lg border border-border bg-muted/40 p-3 text-sm" role="alert">
      <p>{recoveryMessage}</p>
      <p className="text-xs text-muted-foreground">Reloading replaces your unsaved changes with the saved list.</p>
      <Button type="button" variant="outline" disabled={busy} onClick={() => void reloadFromServer()}>
        {reloading ? "Reloading…" : "Discard edits & reload saved picks"}
      </Button>
    </div>
  ) : null;
  const canSave = !readOnly && dirty && !over && problems.length === 0 && !busy && !conflict;
  const canSubmit = !readOnly && lines.length > 0 && !over && problems.length === 0 && !busy && !conflict;

  return (
    <FadeUp>
      <PageHeader
        title="UA staff gear"
        description={
          readOnly
            ? cycle.title
            : `${fit === "MEN" ? "Men’s" : "Women’s"} + unisex · ${allowanceLabel} for your picks${cycle.deadline ? ` · Due ${formatDateTime(cycle.deadline)}` : ""}`
        }
      >
        {data.isAdmin && <AdminResultsLink />}
      </PageHeader>

      {recovery}

      {readOnly && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm" role="status">
          <LockIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p>
            <span className="font-semibold">Picks are closed.</span>{" "}
            {dirty ? "Your unsaved changes are still shown below. Reload the saved list to see what was recorded." : submittedAt ? "This is the list you submitted." : lines.length > 0 ? "This draft was never submitted; ask an admin if you still need gear." : "You didn't pick anything this year."}
          </p>
        </div>
      )}

      <Collapsible className="mb-8 rounded-lg border border-border bg-card">
        <CollapsibleTrigger className="group flex min-h-20 w-full items-center gap-4 rounded-lg px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
          <span className="hidden shrink-0 -space-x-2 sm:flex" aria-hidden="true">
            {kit.slice(0, 3).map((entry) => (
              <span key={`${entry.style}-${entry.code}`} className="relative block size-12 overflow-hidden rounded-md border border-border bg-white">
                <Image src={entry.image} alt="" fill sizes="48px" className="object-contain p-1" />
              </span>
            ))}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">Standard issue</span>
            <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{kit.length} essentials covered by the department. Separate from your pick allowance.</span>
          </span>
          <span className="hidden text-xs font-medium text-muted-foreground sm:block">View kit</span>
          <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul className="flex gap-3 overflow-x-auto border-t border-border p-4">
            {kit.map((entry) => (
              <li key={`${entry.style}-${entry.code}`} className="w-28 shrink-0">
                <button
                  type="button"
                  className="group flex h-full w-full flex-col overflow-hidden rounded-md border border-border bg-card text-left focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  onClick={() => setPreview({ kind: "kit", name: entry.name, label: KIT_LABELS[entry.kind], sku: `${entry.style}-${entry.code}`, image: entry.image })}
                  aria-label={`${entry.name}, ${KIT_LABELS[entry.kind].toLowerCase()}. Preview larger`}
                >
                  <span className="relative block aspect-square w-full bg-white">
                    <Image src={entry.image} alt="" fill sizes="112px" className="object-contain p-2" />
                  </span>
                  <span className="block px-2 py-2 text-xs font-medium leading-snug">{entry.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>

      <section aria-label="Catalog">
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h2 className="text-xl font-semibold tracking-tight">Choose your gear</h2>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground" role="status">{visible.length} styles</span>
        </div>
        <div className="mb-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1 basis-48 md:basis-60">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by name, color or item number"
                aria-label="Search gear by name, color, or item number"
                className="pl-9"
              />
            </div>
            <Button type="button" variant="outline" className="min-h-10 md:hidden" aria-expanded={filtersOpen} aria-controls="gear-catalog-filters" onClick={() => setFiltersOpen((open) => !open)}>
              <SlidersHorizontalIcon data-icon="inline-start" />
              Filters{collection !== "all" || category !== "all" ? ` (${Number(collection !== "all") + Number(category !== "all")})` : ""}
            </Button>
            <div id="gear-catalog-filters" className={cn("order-3 w-full flex-wrap gap-2 md:order-none md:flex md:w-auto", filtersOpen ? "flex" : "hidden")}>
              {collections.length > 1 && (
                <NativeSelect value={collection} onChange={(event) => setCollection(event.target.value)} aria-label="Collection" className="h-11 w-auto min-w-0 flex-1 md:h-10 md:flex-none">
                  <option value="all">All collections</option>
                  {collections.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}
                </NativeSelect>
              )}
              <NativeSelect value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Category" className="h-11 w-auto min-w-0 flex-1 md:hidden">
                <option value="all">All categories</option>
                {categories.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
              </NativeSelect>
            </div>
            <div className="order-2 flex min-h-10 basis-full items-center gap-2 md:order-none md:basis-auto">
              <Switch id="gear-fits-budget" checked={fitsOnly} onCheckedChange={setFitsOnly} />
              <Label htmlFor="gear-fits-budget" className="text-sm">
                Within my allowance
                {hiddenForBudget > 0 && (
                  <span className="font-normal tabular-nums text-muted-foreground"> ({hiddenForBudget} hidden)</span>
                )}
              </Label>
            </div>
          </div>
          <div
            className="hidden flex-wrap gap-1.5 md:flex"
            role="group"
            aria-label="Category"
          >
            {["all", ...categories].map((entry) => (
              <Button
                key={entry}
                type="button"
                size="sm"
                variant={category === entry ? "default" : "outline"}
                aria-pressed={category === entry}
                className="min-h-10 shrink-0 rounded-full"
                onClick={() => setCategory(entry)}
              >
                {entry === "all" ? "All" : entry}
              </Button>
            ))}
          </div>
        </div>

        {sections.length === 0 ? (
          <EmptyState
            icon="search"
            compact
            title="No items match"
            actionLabel="Show all gear"
            onAction={() => {
              setSearch("");
              setCollection("all");
              setCategory("all");
              setFitsOnly(false);
            }}
            description={
              fitsOnly && hiddenForBudget > 0
                ? "Everything that matches costs more than you have left. Turn off Within my allowance to see it."
                : "Clear the search or change the filters."
            }
          />
        ) : (
          sections.map((section) => (
            <section key={section.category} id={categoryAnchorId(section.category)} className="mb-8 scroll-mt-20">
              {category === "all" && (
                <h2 className="mb-3 text-sm font-semibold">
                  {section.category}
                  <span className="ml-1.5 font-normal tabular-nums text-muted-foreground">{section.items.length}</span>
                </h2>
              )}
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
                {section.items.map((item: GearCatalogItem) => (
                  <GearItemCard
                    key={item.style}
                    item={item}
                    selectedCode={cardColorCode(item, selectedColors, linesByStyle)}
                    lines={linesByStyle.get(item.style) ?? []}
                    readOnly={readOnly || busy}
                    onSelectColor={(code) => selectColor(item.style, code)}
                    onPreview={() =>
                      setPreview({ kind: "item", item, colorCode: cardColorCode(item, selectedColors, linesByStyle) })
                    }
                    onAddLine={addLine}
                    onChangeLine={changeLine}
                    onRemoveLine={removeLine}
                  />
                ))}
              </div>
            </section>
          ))
        )}
      </section>

      <div
        className={cn(
          "sticky bottom-0 z-10 -mx-8 mt-6 border-t bg-background/95 px-8 py-3 backdrop-blur max-md:-mx-4 max-md:bottom-[calc(64px+env(safe-area-inset-bottom,0px))] max-md:px-4 max-md:py-2",
          over ? "border-[var(--red-text)]/40" : "border-border",
        )}
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-6">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <span className={cn("text-lg font-semibold tabular-nums", over && "text-[var(--red-text)]")}>
                {over ? `${formatUsd(-remainingCents)} over budget` : `${formatUsd(remainingCents)} left`}
              </span>
              <span className="text-xs tabular-nums text-muted-foreground">{formatUsd(totalCents)} of {allowanceLabel} picked</span>
            </div>
            <Progress
              value={allowanceCents > 0 ? (totalCents / allowanceCents) * 100 : 0}
              aria-label="Allowance used"
              className={cn("mt-1.5 h-1.5", over && "[&>[data-slot=progress-indicator]]:bg-[var(--red-text)]")}
            />
            <div className="mt-1.5 flex min-h-4 items-center">
              <FooterStatus readOnly={readOnly} dirty={dirty} submittedAt={submittedAt} hasSaved={Boolean(data.submission)} />
            </div>
            {!readOnly && problems.length > 0 && (
              <p className="mt-1 text-xs text-[var(--orange-text)]">{problems[0]}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button type="button" variant="outline" className="min-h-11 max-md:flex-1" onClick={() => openSheet("list")}>
              <ListChecksIcon data-icon="inline-start" className="max-sm:hidden" />
              <span>Your picks</span>
              <Badge variant="gray" size="sm" className="tabular-nums">{pickCount}</Badge>
            </Button>
            {!readOnly && !submittedAt && (
              <Button
                type="button"
                variant="ghost"
                className="min-h-11 max-sm:px-3"
                disabled={!canSave}
                onClick={() => void save(false)}
              >
                {saving === "draft" ? (
                  "Saving…"
                ) : (
                  <>
                    <span className="sm:hidden">Save</span>
                    <span className="max-sm:hidden">Save draft</span>
                  </>
                )}
              </Button>
            )}
            {!readOnly && (
              <Button
                type="button"
                className="min-h-11 max-md:flex-1"
                disabled={busy || lines.length === 0 || (Boolean(submittedAt) && !dirty)}
                onClick={() => openSheet("review")}
              >
                <span className="sm:hidden">Review</span>
                <span className="max-sm:hidden">{submittedAt ? "Review changes" : "Review & submit"}</span>
              </Button>
            )}
          </div>
        </div>
      </div>

      <GearPicksSheet
        open={sheetMode !== null}
        mode={sheetMode ?? "list"}
        onOpenChange={(open) => {
          if (!open) setSheetMode(null);
        }}
        lines={lines}
        readOnly={readOnly}
        busy={busy}
        feedback={recovery}
        totalCents={totalCents}
        allowanceCents={allowanceCents}
        deadline={cycle.deadline ? formatDateTime(cycle.deadline) : null}
        problems={problems}
        submitLabel={submittedAt ? "Save changes" : "Submit picks"}
        submitting={saving === "submit"}
        canSubmit={submittedAt ? canSave && lines.length > 0 : canSubmit}
        onSubmit={async () => {
          if (await save(true)) setSheetMode(null);
        }}
        onJump={jumpToItem}
        onRemoveLine={removeLine}
        onChangeLine={changeLine}
      />

      <GearPreviewDialog
        preview={preview}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
        onSelectColor={selectColor}
      />
    </FadeUp>
  );
}

function FooterStatus({
  readOnly,
  dirty,
  submittedAt,
  hasSaved,
}: {
  readOnly: boolean;
  dirty: boolean;
  submittedAt: string | null;
  hasSaved: boolean;
}) {
  if (readOnly) return <Badge variant="gray" size="sm">Locked</Badge>;
  if (dirty) return <Badge variant="orange" size="sm">Unsaved changes</Badge>;
  if (submittedAt) return <Badge variant="green" size="sm">Submitted {formatDateTime(submittedAt)}</Badge>;
  if (hasSaved) return <Badge variant="blue" size="sm">Draft saved</Badge>;
  return null;
}
