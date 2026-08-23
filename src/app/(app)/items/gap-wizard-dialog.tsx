"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, ImageOff, Package, RotateCcw, Sparkles } from "lucide-react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { AssetImage } from "@/components/AssetImage";
import { CategoryCombobox, FormCombobox } from "@/components/FormCombobox";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import { buildCategoryPathOptions } from "@/lib/category-options";
import type { CategoryOption } from "@/types/category";

type GapField = "category" | "department";
type Stage = "pick" | "wizard" | "done";

type GapItem = {
  kind?: "asset" | "bulk";
  id: string;
  assetTag: string;
  name: string | null;
  brand: string;
  model: string;
  imageUrl: string | null;
  suggestedCategoryId?: string | null;
  suggestedDepartmentId?: string | null;
};

type GapSuggestion = {
  id: string;
  name: string;
  score: number;
  reason: string;
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: CategoryOption[];
  departments: { id: string; name: string }[];
  onAssigned?: () => void;
}

const GAP_FIELDS: GapField[] = ["department", "category"];
const QUEUE_LIMIT = 8;

export function GapWizardDialog({ open, onOpenChange, categories, departments, onAssigned }: Props) {
  const [stage, setStage] = useState<Stage>("pick");
  const [field, setField] = useState<GapField | null>(null);
  const [counts, setCounts] = useState<{ category: number | null; department: number | null }>({
    category: null,
    department: null,
  });
  const [countError, setCountError] = useState<string | null>(null);
  const [queue, setQueue] = useState<GapItem[]>([]);
  const [skippedItems, setSkippedItems] = useState<GapItem[]>([]);
  const [assigned, setAssigned] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [selectedValue, setSelectedValue] = useState("");
  const [reviewingSkipped, setReviewingSkipped] = useState(false);
  const [sessionTotal, setSessionTotal] = useState<number | null>(null);
  const [suggestionsLimited, setSuggestionsLimited] = useState(false);

  const item = queue[0] ?? null;

  const loadCounts = useCallback(async () => {
    setCountError(null);
    setCounts({ category: null, department: null });
    try {
      const fetchCount = async (gap: GapField) => {
        const res = await fetch(`/api/assets?missing=${gap}&limit=1`);
        if (handleAuthRedirect(res)) return 0;
        if (!res.ok) throw new Error(await parseErrorMessage(res, `Failed to count missing ${gap}`));
        const json = await parseJsonSafely<{ total?: unknown }>(res);
        if (!json || typeof json.total !== "number") {
          throw new Error(`Could not read missing ${gap} count`);
        }
        return Number(json.total ?? 0);
      };
      const [category, department] = await Promise.all([
        fetchCount("category"),
        fetchCount("department"),
      ]);
      setCounts({ category, department });
    } catch (err) {
      setCounts({ category: 0, department: 0 });
      setCountError(err instanceof Error ? err.message : "Could not count data gaps");
    }
  }, []);

  useEffect(() => {
    if (open) void loadCounts();
  }, [loadCounts, open]);

  useEffect(() => {
    if (!open) {
      setStage("pick");
      setField(null);
      setQueue([]);
      setSkippedItems([]);
      setAssigned(0);
      setSelectedValue("");
      setLoading(false);
      setSaving(false);
      setLoadError(null);
      setSaveError(null);
      setReviewingSkipped(false);
      setSessionTotal(null);
      setSuggestionsLimited(false);
    }
  }, [open]);

  const loadQueue = useCallback(async (gap: GapField, offset: number) => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/assets?missing=${gap}&limit=${QUEUE_LIMIT}&offset=${offset}`);
      if (handleAuthRedirect(res)) return;
      if (!res.ok) throw new Error(await parseErrorMessage(res, "Failed to load items"));
      const json = await parseJsonSafely<{ data?: unknown; total?: unknown; suggestionsLimited?: unknown }>(res);
      if (!json || !Array.isArray(json.data) || typeof json.total !== "number") {
        throw new Error("Could not read the next item queue");
      }
      const items = json.data as GapItem[];
      const total = json.total;
      setSuggestionsLimited(Boolean(json.suggestionsLimited));
      setCounts((prev) => ({ ...prev, [gap]: total }));
      if (offset === 0 && !reviewingSkipped) setSessionTotal(total);
      if (items.length === 0) {
        setQueue([]);
        setStage("done");
      } else {
        setQueue(items);
        setSelectedValue("");
      }
    } catch (err) {
      setQueue([]);
      setLoadError(err instanceof Error ? err.message : "Could not load the next item");
    } finally {
      setLoading(false);
    }
  }, [reviewingSkipped]);

  const startWizard = useCallback(
    (gap: GapField) => {
      setField(gap);
      setStage("wizard");
      setQueue([]);
      setSkippedItems([]);
      setAssigned(0);
      setSelectedValue("");
      setReviewingSkipped(false);
      setSessionTotal(counts[gap]);
      void loadQueue(gap, 0);
    },
    [counts, loadQueue]
  );

  const finishOrContinue = useCallback(
    (nextQueue: GapItem[], nextSkippedItems: GapItem[]) => {
      if (!field) return;
      setQueue(nextQueue);
      setSelectedValue("");

      if (nextQueue.length > 0) return;
      if (reviewingSkipped) {
        setStage("done");
        return;
      }
      void loadQueue(field, nextSkippedItems.length);
    },
    [field, loadQueue, reviewingSkipped]
  );

  const handleSkip = useCallback(() => {
    if (!item) return;
    const nextQueue = queue.slice(1);
    const nextSkippedItems = [...skippedItems, item];
    setSkippedItems(nextSkippedItems);
    finishOrContinue(nextQueue, nextSkippedItems);
  }, [finishOrContinue, item, queue, skippedItems]);

  const handleAssign = useCallback(async () => {
    if (!field || !item || !selectedValue) return;
    setSaving(true);
    setSaveError(null);
    try {
      const isBulk = item.kind === "bulk";
      const body =
        field === "category"
          ? {
              categoryId: selectedValue,
              ...(isBulk ? { category: categories.find((category) => category.id === selectedValue)?.name ?? item.name ?? "general" } : {}),
            }
          : { departmentId: selectedValue };
      const res = await fetch(isBulk ? `/api/bulk-skus/${item.id}` : `/api/assets/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) throw new Error(await parseErrorMessage(res, "Failed to update item"));

      setAssigned((value) => value + 1);
      setCounts((prev) => ({
        ...prev,
        [field]: Math.max(0, (prev[field] ?? 1) - 1),
      }));
      onAssigned?.();
      const nextQueue = queue.slice(1);
      finishOrContinue(nextQueue, skippedItems);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update item";
      setSaveError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }, [categories, field, finishOrContinue, item, onAssigned, queue, selectedValue, skippedItems]);

  const handlePickAnother = useCallback(() => {
    setStage("pick");
    setField(null);
    setQueue([]);
    setSkippedItems([]);
    setSelectedValue("");
    setReviewingSkipped(false);
    setSessionTotal(null);
    setSuggestionsLimited(false);
    void loadCounts();
  }, [loadCounts]);

  const handleReviewSkipped = useCallback(() => {
    if (skippedItems.length === 0) return;
    setQueue(skippedItems);
    setSkippedItems([]);
    setSelectedValue("");
    setReviewingSkipped(true);
    setSessionTotal(skippedItems.length);
    setStage("wizard");
  }, [skippedItems]);

  const departmentOptions = useMemo(
    () => departments.map((d) => ({ value: d.id, label: d.name })),
    [departments]
  );

  const categoryOptions = useMemo(() => buildCategoryPathOptions(categories), [categories]);

  const suggestions = useMemo<GapSuggestion[]>(() => {
    if (!item || !field) return [];

    const currentItem = item;
    const itemWords = tokenize([currentItem.assetTag, currentItem.name, currentItem.brand, currentItem.model].filter(Boolean).join(" "));
    const itemText = itemWords.join(" ");

    function buildSuggestion(id: string, name: string): GapSuggestion | null {
      const optionWords = tokenize(name);
      const matches = optionWords.filter((word) => itemText.includes(word));
      const reverseMatches = itemWords.filter((word) => name.toLowerCase().includes(word));
      const exactProductHit = [currentItem.name, `${currentItem.brand} ${currentItem.model}`]
        .filter(Boolean)
        .some((value) => value!.trim().length > 0 && name.toLowerCase().includes(value!.trim().toLowerCase()));
      const serverCategoryHit = field === "category" && currentItem.suggestedCategoryId === id;
      const departmentPatternHit = field === "department" && currentItem.suggestedDepartmentId === id;
      const categoryKeywordHit = field === "category" ? categoryKeywordScore(currentItem, name) : 0;
      const score =
        matches.length * 2
        + reverseMatches.length
        + (exactProductHit ? 4 : 0)
        + (serverCategoryHit ? 10 : 0)
        + (departmentPatternHit ? 8 : 0)
        + categoryKeywordHit;
      if (score === 0) return null;
      const reason = serverCategoryHit
        ? "Similar categorized items"
        : departmentPatternHit
        ? "Similar category items"
        : categoryKeywordHit > 0
          ? "Gear terms"
        : [...new Set([...matches, ...reverseMatches])].slice(0, 3).join(", ");
      return { id, name, score, reason };
    }

    const source =
      field === "category"
        ? categoryOptions.map((category) => ({
            id: category.value,
            name: category.label,
          }))
        : departments;

    return source
      .map((option) => buildSuggestion(option.id, option.name))
      .filter((suggestion): suggestion is GapSuggestion => Boolean(suggestion))
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .slice(0, 4);
  }, [categoryOptions, departments, field, item]);

  const activeCount = field ? counts[field] : null;
  const currentPosition = sessionTotal
    ? Math.min(sessionTotal, assigned + skippedItems.length + 1)
    : null;
  const remainingLabel = reviewingSkipped
    ? `${queue.length} skipped item${queue.length !== 1 ? "s" : ""} to review`
    : activeCount === null
      ? "Loading..."
      : `${activeCount} open gap${activeCount !== 1 ? "s" : ""}`;
  const progressLabel = currentPosition && sessionTotal
    ? `${currentPosition} of ${sessionTotal}`
    : remainingLabel;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        {stage === "pick" && (
          <>
            <DialogHeader>
              <DialogTitle>Fill data gaps</DialogTitle>
              <DialogDescription>
                Clean up missing category or department values across standard items and item families.
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
              {GAP_FIELDS.map((gap) => {
                const count = counts[gap];
                const label = gap === "category" ? "Category" : "Department";
                const isEmpty = count === 0;
                const isLoading = count === null;
                return (
                  <Button
                    key={gap}
                    type="button"
                    variant="outline"
                    onClick={() => !isEmpty && !isLoading ? startWizard(gap) : undefined}
                    disabled={isLoading || isEmpty || !!countError}
                    className="h-auto justify-between gap-3 rounded-md p-4 text-left active:scale-[0.96] transition-transform"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{label}</span>
                      <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                        {isLoading
                          ? "Counting..."
                          : isEmpty
                            ? "All items have a value"
                            : `${count} item${count !== 1 ? "s" : ""} missing`}
                      </span>
                    </span>
                    {!isLoading && !isEmpty && <Badge variant="secondary">{count}</Badge>}
                  </Button>
                );
              })}
            </div>
          </>
        )}

        {stage === "wizard" && field && (
          <>
            <DialogHeader>
              <DialogTitle>Assign {field}</DialogTitle>
              <DialogDescription>
                {loading ? "Loading..." : `${progressLabel} - ${assigned} assigned this session${suggestionsLimited ? " - suggestions use a capped sample" : ""}`}
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
                  <Button variant="outline" onClick={handlePickAnother}>Back</Button>
                  <Button onClick={() => field && loadQueue(field, skippedItems.length)}>
                    <RotateCcw className="size-3.5" />
                    Retry
                  </Button>
                </div>
              </div>
            ) : loading || !item ? (
              <div className="flex flex-col gap-4 py-3">
                <Skeleton className="h-20 w-full rounded-md" />
                <Skeleton className="h-9 w-full" />
              </div>
            ) : (
              <div className="flex flex-col gap-5 py-1">
                <div className="rounded-lg border bg-muted/20 p-3 shadow-xs">
                  <div className="flex items-start gap-3">
                    <GapItemImage item={item} />
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="truncate text-sm font-semibold" style={{ fontFamily: "var(--font-heading)" }}>
                          {item.assetTag}
                        </div>
                        <Badge variant="secondary" className="h-5 shrink-0 px-1.5 text-[10px]">
                          {getKindLabel(item)}
                        </Badge>
                      </div>
                      <div className="mt-1 truncate text-sm text-muted-foreground">
                        {getProductLine(item)}
                      </div>
                      {item.name && (
                        <div className="mt-0.5 truncate text-xs text-muted-foreground">{item.name}</div>
                      )}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {!item.imageUrl && (
                          <Badge variant="outline" className="h-5 px-1.5 text-[10px] text-muted-foreground">
                            No photo
                          </Badge>
                        )}
                        <Badge variant="outline" className="h-5 px-1.5 text-[10px] text-muted-foreground">
                          Needs {field}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </div>

                {suggestions.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      <Sparkles className="size-3.5" aria-hidden="true" />
                      Suggested matches
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {suggestions.map((suggestion, index) => (
                        <Button
                          key={suggestion.id}
                          type="button"
                          variant={selectedValue === suggestion.id ? "default" : "outline"}
                          className="h-10 gap-1.5 rounded-md active:scale-[0.96] transition-transform"
                          onClick={() => setSelectedValue(suggestion.id)}
                          title={suggestion.reason ? `Matched: ${suggestion.reason}` : undefined}
                        >
                          {suggestion.name}
                          {index === 0 && <Badge variant="secondary" className="h-4 px-1 text-[10px]">Best</Badge>}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                {suggestions.length === 0 && (
                  <div className="rounded-md border border-dashed bg-muted/15 px-3 py-2 text-xs text-muted-foreground">
                    No confident match. Choose a value or skip for later.
                  </div>
                )}

                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium capitalize">{field}</label>
                  {field === "category" ? (
                    <CategoryCombobox
                      value={selectedValue}
                      onValueChange={setSelectedValue}
                      categories={categories}
                    />
                  ) : (
                    <FormCombobox
                      value={selectedValue}
                      onValueChange={setSelectedValue}
                      options={departmentOptions}
                      placeholder="Select department..."
                    />
                  )}
                  {saveError && (
                    <div className="flex items-center gap-1.5 text-xs text-destructive">
                      <AlertCircle className="size-3.5" />
                      {saveError}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between gap-2 pt-1">
                  <Button variant="ghost" onClick={handleSkip} disabled={saving}>
                    Skip
                  </Button>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setStage("done")} disabled={saving}>
                      Stop
                    </Button>
                    <Button onClick={handleAssign} disabled={!selectedValue || saving}>
                      {saving ? "Saving..." : "Assign & next"}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {stage === "done" && (
          <>
            <DialogHeader>
              <DialogTitle>{skippedItems.length > 0 ? "Review skipped items?" : "All done"}</DialogTitle>
              <DialogDescription>
                {assigned > 0
                  ? `Assigned ${assigned} item${assigned !== 1 ? "s" : ""}.`
                  : "No items were changed."}
                {skippedItems.length > 0 && ` ${skippedItems.length} skipped item${skippedItems.length !== 1 ? "s" : ""} remain in this session.`}
              </DialogDescription>
            </DialogHeader>
            <div className="mt-2 flex justify-end gap-2">
              <Button variant="outline" onClick={handlePickAnother}>
                Fill another gap
              </Button>
              {skippedItems.length > 0 && (
                <Button variant="outline" onClick={handleReviewSkipped}>
                  Review skipped
                </Button>
              )}
              <Button onClick={() => onOpenChange(false)}>Close</Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function GapItemImage({ item }: { item: GapItem }) {
  if (item.imageUrl) {
    return (
      <AssetImage
        src={item.imageUrl}
        alt={item.assetTag}
        size={64}
        className="shrink-0 rounded-md"
      />
    );
  }

  return (
    <div
      className="flex size-16 shrink-0 flex-col items-center justify-center gap-1 rounded-md border border-border bg-background text-muted-foreground"
      role="img"
      aria-label={`${item.assetTag} has no photo`}
    >
      {item.kind === "bulk" ? (
        <Package className="size-4" aria-hidden="true" />
      ) : (
        <ImageOff className="size-4" aria-hidden="true" />
      )}
      <span className="text-[10px] font-medium leading-none">No photo</span>
    </div>
  );
}

function getKindLabel(item: GapItem) {
  return item.kind === "bulk" ? "Item family" : "Standard";
}

function getProductLine(item: GapItem) {
  const product = [item.brand, item.model].filter(Boolean).join(" ").trim();
  if (product && product !== "Bulk SKU") return product;
  return item.kind === "bulk" ? "Item family" : "No product metadata";
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[\s/_,.()+-]+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 2 && !/^\d+$/.test(word) && !STOP_WORDS.has(word));
}

function categoryKeywordScore(item: GapItem, categoryName: string) {
  const categoryWords = new Set(tokenizeForCategoryRules(categoryName));
  const itemWords = new Set(tokenizeForCategoryRules([item.assetTag, item.name, item.brand, item.model].filter(Boolean).join(" ")));
  let score = 0;

  for (const rule of CATEGORY_KEYWORD_RULES) {
    const categoryHit = rule.category.some((word) => categoryWords.has(word));
    const itemHit = rule.item.some((word) => itemWords.has(word));
    if (categoryHit && itemHit) score += rule.weight;
  }

  return score;
}

function tokenizeForCategoryRules(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[\s/_,.()+-]+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 1 && !/^\d+$/.test(word));
}

const STOP_WORDS = new Set([
  "and",
  "the",
  "for",
  "with",
  "kit",
  "set",
  "item",
  "gear",
  "camera",
]);

const CATEGORY_KEYWORD_RULES = [
  { category: ["audio", "microphone", "sound"], item: ["audio", "mic", "microphone", "lav", "xlr"], weight: 5 },
  { category: ["battery", "batteries", "power"], item: ["battery", "batteries", "charger", "sony", "vlock", "anton"], weight: 5 },
  { category: ["cable", "cables"], item: ["cable", "hdmi", "sdi", "xlr", "usb", "ethernet"], weight: 5 },
  { category: ["camera", "cameras", "body", "bodies"], item: ["camera", "body", "fx3", "fx6", "a7", "canon"], weight: 5 },
  { category: ["lens", "lenses"], item: ["lens", "mm", "sigma", "canon", "sony", "tamron"], weight: 5 },
  { category: ["light", "lighting"], item: ["light", "lighting", "aputure", "nanlite", "tube"], weight: 5 },
  { category: ["media", "card", "cards", "storage"], item: ["card", "media", "sd", "cfexpress", "reader"], weight: 5 },
  { category: ["monitor", "monitors"], item: ["monitor", "smallhd", "atomos"], weight: 5 },
  { category: ["support", "tripod", "tripods", "grip"], item: ["tripod", "stand", "plate", "head", "grip"], weight: 5 },
];
