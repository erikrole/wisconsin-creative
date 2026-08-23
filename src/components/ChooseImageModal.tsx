"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
} from "@/components/ui/dialog";
import { ExternalLinkIcon, ImageIcon, SearchIcon } from "lucide-react";
import { useConfirm } from "./ConfirmDialog";
import { toast } from "sonner";
import { handleAuthRedirect, isAbortError, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  buildBandHImageSearchQuery,
  buildBiasedImageSearchQuery,
  buildImageSearchSuggestions,
  mergeImageSearchResults,
} from "@/lib/image-search-modal";
import type { DraftItemImage } from "@/lib/item-image-draft";

type ImageSearchResult = {
  id: string;
  url: string;
  thumbnailUrl: string;
  title: string;
  sourceUrl: string;
  sourceDomain: string;
  width: number | null;
  height: number | null;
};

type ImageSearchResponse = {
  data?: {
    configured?: boolean;
    quotaExceeded?: boolean;
    results?: ImageSearchResult[];
  };
};

type ImageMutationResponse = {
  imageUrl?: string | null;
};

type CommonProps = {
  open: boolean;
  onClose: () => void;
  searchQuery?: string;
};

type PersistedProps = CommonProps & {
  mode: "persisted";
  /** Base upload endpoint, e.g. `/api/assets/{id}/image` or `/api/bulk-skus/{id}/image` */
  uploadEndpoint: string;
  currentImageUrl: string | null;
  onImageChanged: (newUrl: string | null) => void;
};

type DraftProps = CommonProps & {
  mode: "draft";
  initialSelection: DraftItemImage | null;
  onDraftChanged: (selection: DraftItemImage) => void;
};

type Props = PersistedProps | DraftProps;

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_SIZE = 4.5 * 1024 * 1024;
const B_AND_H_FALLBACK_THRESHOLD = 4;
const B_AND_H_DISPLAY_LIMIT = 3;

type ImageTab = "url" | "upload" | "search";
type SearchState = "idle" | "loading" | "empty" | "quota" | "failed" | "ready";
type SourceCue = "manufacturer" | "retailer" | "marketplace" | "unknown";
type ImageSavingAction = "search" | "url" | "upload" | "remove";

const SOURCE_CUE_STYLES: Record<SourceCue, string> = {
  manufacturer: "border-transparent bg-[var(--green-bg)] text-[var(--green-text)]",
  retailer: "border-transparent bg-[var(--blue-bg)] text-[var(--blue-text)]",
  marketplace: "border-transparent bg-[var(--orange-bg)] text-[var(--orange-text)]",
  unknown: "border-border bg-muted text-muted-foreground",
};

const SOURCE_CUE_LABELS: Record<SourceCue, string> = {
  manufacturer: "Manufacturer",
  retailer: "Retailer",
  marketplace: "Marketplace",
  unknown: "Unknown",
};

function classifySourceDomain(domain: string): SourceCue {
  const normalized = domain.toLowerCase();
  if (!normalized) return "unknown";
  if (/(amazon|ebay|walmart|aliexpress|temu|etsy|facebook|marketplace)/.test(normalized)) return "marketplace";
  if (/(bhphotovideo|adorama|bestbuy|crutchfield|sweetwater|guitarcenter|target|costco|newegg)/.test(normalized)) return "retailer";
  if (/(sony|canon|nikon|panasonic|fujifilm|blackmagicdesign|dji|apple|rode|sennheiser|shure|gopro|manfrotto|smallrig|teradek|aputure|nanlite)/.test(normalized)) {
    return "manufacturer";
  }
  return "unknown";
}

function SearchEmptyNotice({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Empty className="min-h-[180px] border border-dashed bg-background/60 p-4 md:p-6">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SearchIcon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle className="text-base">{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

async function fetchSearchData(query: string, controller: AbortController) {
  const res = await fetch(`/api/image-search?q=${encodeURIComponent(query)}`, { signal: controller.signal });
  if (handleAuthRedirect(res)) return null;
  if (res.status === 429) return { quotaExceeded: true };
  if (!res.ok) {
    const msg = await parseErrorMessage(res, "Image search failed");
    throw new Error(msg);
  }
  const json = await parseJsonSafely<ImageSearchResponse>(res);
  return json?.data ?? {};
}

export default function ChooseImageModal(props: Props) {
  const { open, onClose, searchQuery } = props;
  const persisted = props.mode === "persisted";
  const endpoint = persisted ? props.uploadEndpoint : null;
  const currentImageUrl = persisted ? props.currentImageUrl : null;
  const initialSelection = props.mode === "draft" ? props.initialSelection : null;
  const [tab, setTab] = useState<ImageTab>("url");
  const [url, setUrl] = useState("");
  const [urlPreview, setUrlPreview] = useState<string | null>(null);
  const [urlError, setUrlError] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [fileError, setFileError] = useState("");
  const [savingAction, setSavingAction] = useState<ImageSavingAction | null>(null);
  const [dragging, setDragging] = useState(false);
  const [searchConfigured, setSearchConfigured] = useState(false);
  const [searchText, setSearchText] = useState(searchQuery ?? "");
  const [searchResults, setSearchResults] = useState<ImageSearchResult[]>([]);
  const [selectedSearchResult, setSelectedSearchResult] = useState<ImageSearchResult | null>(null);
  const [searchState, setSearchState] = useState<SearchState>("idle");
  const [searching, setSearching] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const savingRef = useRef(false);
  const confirm = useConfirm();
  const searchSuggestions = buildImageSearchSuggestions(searchText);
  const saving = savingAction !== null;

  const reset = useCallback(() => {
    searchAbortRef.current?.abort();
    searchAbortRef.current = null;
    setTab("url");
    setUrl("");
    setUrlPreview(null);
    setUrlError(false);
    setFile(null);
    setFilePreview(null);
    setFileError("");
    setSavingAction(null);
    setDragging(false);
    setSearchConfigured(false);
    setSearchText("");
    setSearchResults([]);
    setSelectedSearchResult(null);
    setSearchState("idle");
    setSearching(false);
  }, []);

  const runSearch = useCallback(async (query: string) => {
    const trimmed = query.trim();
    const bandHQuery = buildBandHImageSearchQuery(trimmed);
    const broadQuery = buildBiasedImageSearchQuery(trimmed);
    if (!bandHQuery || !broadQuery) {
      setSearchResults([]);
      setSelectedSearchResult(null);
      setSearchState("idle");
      return;
    }

    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    setSearching(true);
    setSearchState("loading");
    setSelectedSearchResult(null);

    try {
      const data = await fetchSearchData(bandHQuery, controller);
      if (!data) return;

      let results = data.results ?? [];
      if (!data.quotaExceeded) {
        const fallbackData = await fetchSearchData(broadQuery, controller);
        if (!fallbackData) return;
        if (fallbackData.quotaExceeded) {
          setSearchResults(results);
          setSearchState(results.length ? "ready" : "quota");
          return;
        }
        results = mergeImageSearchResults(results, fallbackData.results ?? [], {
          primaryLimit: results.length >= B_AND_H_FALLBACK_THRESHOLD ? B_AND_H_DISPLAY_LIMIT : undefined,
        });
      }

      if (data.quotaExceeded) {
        setSearchResults([]);
        setSearchState("quota");
        return;
      }
      setSearchResults(results);
      setSearchState(results.length ? "ready" : "empty");
    } catch (err) {
      if (isAbortError(err)) return;
      setSearchResults([]);
      setSearchState("failed");
    } finally {
      if (searchAbortRef.current === controller) {
        searchAbortRef.current = null;
      }
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;

    const seed = searchQuery?.trim() ?? "";
    setSearchText(seed);
    if (initialSelection?.kind === "file") {
      setTab("upload");
      setFile(initialSelection.file);
      setFilePreview(initialSelection.previewUrl);
    } else if (initialSelection?.kind === "remote") {
      setTab("url");
      setUrl(initialSelection.url);
      setUrlPreview(initialSelection.previewUrl);
    }

    if (!seed) {
      setSearchConfigured(false);
      if (!initialSelection) setTab("url");
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    async function probeSearch() {
      try {
        const res = await fetch("/api/image-search?probe=1", { signal: controller.signal });
        if (handleAuthRedirect(res)) return;
        if (!res.ok) return;
        const json = await parseJsonSafely<ImageSearchResponse>(res);
        const configured = !!json?.data?.configured;
        if (cancelled) return;
        setSearchConfigured(configured);
        if (configured && !initialSelection) {
          setTab("search");
          void runSearch(seed);
        }
      } catch (err) {
        if (!isAbortError(err) && !cancelled) {
          setSearchConfigured(false);
        }
      }
    }

    void probeSearch();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [initialSelection, open, runSearch, searchQuery]);

  function handleClose() {
    reset();
    onClose();
  }

  function handleUrlChange(value: string) {
    setUrl(value);
    setUrlError(false);
    if (value.startsWith("https://") && value.length > 10) {
      setUrlPreview(value);
    } else {
      setUrlPreview(null);
    }
  }

  function validateFile(f: File): string | null {
    if (!ALLOWED_TYPES.has(f.type)) return "File must be JPEG, PNG, WebP, or GIF";
    if (f.size > MAX_SIZE) return "File must be under 4.5 MB";
    return null;
  }

  function handleFileSelect(f: File) {
    const err = validateFile(f);
    if (err) {
      setFileError(err);
      setFile(null);
      setFilePreview(null);
      return;
    }
    setFileError("");
    setFile(f);
    const reader = new FileReader();
    reader.onload = () => setFilePreview(reader.result as string);
    reader.readAsDataURL(f);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFileSelect(f);
  }

  async function putImageUrl(imageUrl: string): Promise<string | null> {
    if (!endpoint) throw new Error("Image persistence is unavailable.");
    const res = await fetch(endpoint, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: imageUrl }),
    });
    if (handleAuthRedirect(res)) return null;
    if (!res.ok) {
      const msg = await parseErrorMessage(res, "Failed to save image URL");
      throw new Error(msg);
    }
    const json = await parseJsonSafely<ImageMutationResponse>(res);
    if (!json?.imageUrl) {
      throw new Error("Image was saved, but the response could not be read. Refresh before continuing.");
    }
    return json.imageUrl;
  }

  async function saveUrl() {
    if (!urlPreview || savingRef.current) return;
    if (props.mode === "draft") {
      props.onDraftChanged({
        kind: "remote",
        url: urlPreview,
        previewUrl: urlPreview,
      });
      handleClose();
      return;
    }
    savingRef.current = true;
    setSavingAction("url");
    try {
      const imageUrl = await putImageUrl(urlPreview);
      if (!imageUrl) return;
      toast.success("Image updated");
      props.onImageChanged(imageUrl);
      handleClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save image");
    } finally {
      savingRef.current = false;
      setSavingAction(null);
    }
  }

  async function saveSearchResult() {
    if (!selectedSearchResult || savingRef.current) return;
    if (props.mode === "draft") {
      props.onDraftChanged({
        kind: "remote",
        url: selectedSearchResult.url,
        fallbackUrl: selectedSearchResult.thumbnailUrl || undefined,
        previewUrl: selectedSearchResult.thumbnailUrl || selectedSearchResult.url,
      });
      handleClose();
      return;
    }
    savingRef.current = true;
    setSavingAction("search");
    try {
      let imageUrl: string | null = null;
      try {
        imageUrl = await putImageUrl(selectedSearchResult.url);
      } catch (err) {
        if (selectedSearchResult.thumbnailUrl && selectedSearchResult.thumbnailUrl !== selectedSearchResult.url) {
          imageUrl = await putImageUrl(selectedSearchResult.thumbnailUrl);
        } else {
          throw err;
        }
      }
      if (!imageUrl) return;
      toast.success("Image updated");
      props.onImageChanged(imageUrl);
      handleClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save image");
    } finally {
      savingRef.current = false;
      setSavingAction(null);
    }
  }

  async function uploadFile() {
    if (!file || !filePreview || savingRef.current) return;
    if (props.mode === "draft") {
      props.onDraftChanged({
        kind: "file",
        file,
        previewUrl: filePreview,
      });
      handleClose();
      return;
    }
    savingRef.current = true;
    setSavingAction("upload");
    try {
      const formData = new FormData();
      formData.append("file", file);
      if (!endpoint) throw new Error("Image persistence is unavailable.");
      const res = await fetch(endpoint, {
        method: "POST",
        body: formData,
      });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) {
        const msg = await parseErrorMessage(res, "Upload failed");
        throw new Error(msg);
      }
      const json = await parseJsonSafely<ImageMutationResponse>(res);
      if (!json?.imageUrl) throw new Error("Upload finished, but no image URL was returned");
      toast.success("Image uploaded");
      props.onImageChanged(json.imageUrl);
      handleClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      savingRef.current = false;
      setSavingAction(null);
    }
  }

  async function removeImage() {
    if (savingRef.current || props.mode !== "persisted") return;
    const ok = await confirm({
      title: "Remove image",
      message: "Remove the image from this item?",
      confirmLabel: "Remove",
      variant: "danger",
    });
    if (!ok) return;
    savingRef.current = true;
    setSavingAction("remove");
    try {
      if (!endpoint) throw new Error("Image persistence is unavailable.");
      const res = await fetch(endpoint, { method: "DELETE" });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) {
        const msg = await parseErrorMessage(res, "Failed to remove image");
        throw new Error(msg);
      }
      toast.success("Image removed");
      props.onImageChanged(null);
      handleClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove image");
    } finally {
      savingRef.current = false;
      setSavingAction(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) handleClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Choose image</DialogTitle>
          <DialogDescription className="sr-only">Upload or paste a URL for the item image</DialogDescription>
        </DialogHeader>
        <DialogBody className="pb-6">
          <Tabs value={tab} onValueChange={(v) => setTab(v as ImageTab)}>
            <TabsList className="mb-1">
              {searchConfigured && <TabsTrigger value="search">Search</TabsTrigger>}
              <TabsTrigger value="url">Paste URL</TabsTrigger>
              <TabsTrigger value="upload">Upload</TabsTrigger>
            </TabsList>

            {searchConfigured && (
              <TabsContent value="search">
                <div className="flex gap-2">
                  <Input
                    id="image-search-query"
                    name="imageSearchQuery"
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void runSearch(searchText);
                      }
                    }}
                    placeholder="Search by product title"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => runSearch(searchText)}
                    disabled={searching || !searchText.trim()}
                    aria-label="Search images"
                  >
                    <SearchIcon className="size-4" />
                    Search
                  </Button>
                </div>
                {searchSuggestions.length > 1 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {searchSuggestions.slice(1).map((suggestion) => (
                      <Button
                        key={suggestion}
                        type="button"
                        variant="outline"
                        className="h-10 px-2 text-xs"
                        onClick={() => {
                          setSearchText(suggestion);
                          void runSearch(suggestion);
                        }}
                        disabled={searching}
                      >
                        {suggestion.replace(searchSuggestions[0] ?? "", "").trim() || suggestion}
                      </Button>
                    ))}
                  </div>
                )}

                <div className="mt-4 min-h-[220px]">
                  {searchState === "loading" && (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      {Array.from({ length: 8 }).map((_, index) => (
                        <div key={index} className="flex flex-col gap-2">
                          <Skeleton className="aspect-square w-full" />
                          <Skeleton className="h-3 w-2/3" />
                        </div>
                      ))}
                    </div>
                  )}

                  {searchState === "ready" && (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      {searchResults.map((result) => {
                        const selected = selectedSearchResult?.id === result.id;
                        const sourceCue = classifySourceDomain(result.sourceDomain);
                        return (
                          <div
                            key={result.id}
                            className={`group flex min-h-0 flex-col rounded-md border p-1 transition ${
                              selected ? "border-primary ring-2 ring-primary/20" : "border-border hover:border-primary/60"
                            }`}
                          >
                            <Button
                              type="button"
                              variant="ghost"
                              className="relative aspect-square h-auto w-full overflow-hidden rounded bg-muted p-0 shadow-none transition-[box-shadow] hover:bg-muted focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                              onClick={() => setSelectedSearchResult(result)}
                              aria-label={`Select image: ${result.title}`}
                              aria-pressed={selected}
                            >
                              <Image
                                src={result.thumbnailUrl || result.url}
                                alt={result.title}
                                fill
                                sizes="(min-width: 640px) 25vw, 50vw"
                                className="object-contain"
                                loading="lazy"
                                referrerPolicy="no-referrer"
                                unoptimized
                                onError={(event) => {
                                  const img = event.currentTarget;
                                  if (result.url && img.src !== result.url) {
                                    img.src = result.url;
                                    return;
                                  }
                                  img.style.display = "none";
                                }}
                              />
                            </Button>
                            <span className="mt-1 min-h-8 overflow-hidden text-xs leading-4 text-foreground">
                              {result.title}
                            </span>
                            <div className="mt-1 flex min-w-0 items-center justify-between gap-1">
                              <span className="truncate text-xs text-muted-foreground">
                                {result.sourceDomain || "Unknown source"}
                              </span>
                              {result.sourceUrl && (
                                <a
                                  href={result.sourceUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex size-10 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                                  aria-label={`Open source for ${result.title}`}
                                  title="Open source"
                                >
                                  <ExternalLinkIcon className="size-3.5" />
                                </a>
                              )}
                            </div>
                            <span className={`mt-1 w-fit rounded border px-1.5 py-0.5 text-[10px] font-medium ${SOURCE_CUE_STYLES[sourceCue]}`}>
                              {SOURCE_CUE_LABELS[sourceCue]}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {searchState === "empty" && (
                    <SearchEmptyNotice title="No images found" description="Try a more specific brand, model, or product name." />
                  )}
                  {searchState === "quota" && (
                    <SearchEmptyNotice title="Search temporarily limited" description="Paste a URL or upload a file instead." />
                  )}
                  {searchState === "failed" && (
                    <SearchEmptyNotice title="Image search failed" description="Paste a URL or upload a file instead." />
                  )}
                  {searchState === "idle" && (
                    <SearchEmptyNotice title="Search product photos" description="Search by brand and model to find manufacturer or product images." />
                  )}
                </div>

                <p className="mt-3 text-xs text-muted-foreground">Pick a manufacturer or product photo.</p>
                <div className="mt-4 flex justify-end gap-2">
                  {currentImageUrl && (
                    <Button variant="destructive" onClick={removeImage} loading={savingAction === "remove"} disabled={saving && savingAction !== "remove"} className="mr-auto">
                      Remove
                    </Button>
                  )}
                  <Button variant="outline" onClick={handleClose}>Cancel</Button>
                  <Button onClick={saveSearchResult} loading={savingAction === "search"} disabled={!selectedSearchResult || (saving && savingAction !== "search")}>
                    {persisted ? "Save" : "Use image"}
                  </Button>
                </div>
              </TabsContent>
            )}

            {/* Paste URL tab */}
            <TabsContent value="url">
              <Input
                id="image-url"
                name="imageUrl"
                type="url"
                placeholder="https://example.com/product-image.jpg"
                value={url}
                onChange={(e) => handleUrlChange(e.target.value)}
                style={{ width: "100%" }}
              />
              {urlPreview && (
                <div className="image-preview-container mt-4">
                  <div className="relative h-[240px] w-full">
                    <Image
                      src={urlPreview}
                      alt="Preview"
                      fill
                      sizes="min(100vw, 640px)"
                      className="object-contain"
                      unoptimized
                      onError={() => { setUrlError(true); setUrlPreview(null); }}
                      onLoad={() => setUrlError(false)}
                    />
                  </div>
                </div>
              )}
              {urlError && <p className="text-sm mt-2" style={{ color: "var(--red)" }}>Could not load image from this URL</p>}
              <div className="flex justify-end gap-2 mt-4">
                {currentImageUrl && (
                  <Button variant="destructive" onClick={removeImage} loading={savingAction === "remove"} disabled={saving && savingAction !== "remove"} className="mr-auto">
                    Remove
                  </Button>
                )}
                <Button variant="outline" onClick={handleClose}>Cancel</Button>
                <Button onClick={saveUrl} loading={savingAction === "url"} disabled={!urlPreview || urlError || (saving && savingAction !== "url")}>
                  {persisted ? "Save" : "Use image"}
                </Button>
              </div>
            </TabsContent>

            {/* Upload tab */}
            <TabsContent value="upload">
              <div
                className={`image-drop-zone ${dragging ? "dragging" : ""}`}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                {filePreview ? (
                  <div className="relative h-[200px] w-full">
                    <Image
                      src={filePreview}
                      alt="Preview"
                      fill
                      sizes="min(100vw, 640px)"
                      className="object-contain"
                      unoptimized
                    />
                  </div>
                ) : (
                  <div className="text-center">
                    <ImageIcon className="size-12 text-[var(--text-tertiary)] mb-2" />
                    <p className="text-sm text-muted-foreground mb-2">Drop an image here</p>
                    <Button className="h-10" variant="outline" asChild><span>Pick from computer</span></Button>
                  </div>
                )}
              </div>
              <input
                ref={fileInputRef}
                id="image-file"
                name="imageFile"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFileSelect(f);
                }}
              />
              {fileError && <p className="text-sm mt-2" style={{ color: "var(--red)" }}>{fileError}</p>}
              <div className="flex justify-end gap-2 mt-4">
                {currentImageUrl && (
                  <Button variant="destructive" onClick={removeImage} loading={savingAction === "remove"} disabled={saving && savingAction !== "remove"} className="mr-auto">
                    Remove
                  </Button>
                )}
                <Button variant="outline" onClick={handleClose}>Cancel</Button>
                <Button onClick={uploadFile} loading={savingAction === "upload"} disabled={!file || !!fileError || (saving && savingAction !== "upload")}>
                  {persisted ? "Upload" : "Use image"}
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
