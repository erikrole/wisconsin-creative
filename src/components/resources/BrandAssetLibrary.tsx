"use client";

/* eslint-disable @next/next/no-img-element -- private authenticated asset URLs cannot use next/image's public optimizer path. */

import { upload } from "@vercel/blob/client";
import {
  ArrowDownUpIcon,
  ArrowUpIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  Clock3Icon,
  DownloadIcon,
  EyeIcon,
  FileIcon,
  FileTextIcon,
  FolderIcon,
  FolderPlusIcon,
  HardDriveIcon,
  HistoryIcon,
  HomeIcon,
  ImageIcon,
  LinkIcon,
  ListFilterIcon,
  Loader2Icon,
  PlusIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SearchIcon,
  StarIcon,
  TypeIcon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ResourceAssetKind } from "@prisma/client";
import { toast } from "sonner";
import EmptyState from "@/components/EmptyState";
import { OperationalRowActions } from "@/components/OperationalRowActions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
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
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useFetch } from "@/hooks/use-fetch";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import {
  RESOURCE_ASSET_KIND_LABELS,
  RESOURCE_ASSET_KIND_OPTIONS,
} from "@/lib/resource-assets-client";
import { cn } from "@/lib/utils";

type FolderSummary = {
  id: string;
  name: string;
  path: string;
  assetCount: number;
};

type VersionSummary = {
  id: string;
  versionNumber: number;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  etag: string | null;
  versionNote: string | null;
  createdAt: string;
  uploadedBy: { id: string; name: string };
};

type AssetSummary = {
  id: string;
  name: string;
  kind: ResourceAssetKind;
  description: string | null;
  folderId: string;
  folder: { id: string; name: string; path: string };
  isFavorite: boolean;
  createdAt: string;
  updatedAt: string;
  versionCount: number;
  currentVersion: VersionSummary | null;
};

type Breadcrumb = { id: string; name: string; path: string };

type LibraryData = {
  folder: Breadcrumb;
  breadcrumbs: Breadcrumb[];
  folders: FolderSummary[];
  assets: AssetSummary[];
};

type AssetDetail = AssetSummary & {
  folder: Breadcrumb;
  versions: VersionSummary[];
};

type ApiEnvelope<T> = { data?: T; error?: string };

type RecentAsset = Pick<AssetSummary, "id" | "name" | "kind" | "folderId" | "folder" | "updatedAt" | "currentVersion">;

type UploadQueueStatus = "queued" | "uploading" | "completed" | "failed" | "conflict" | "skipped";

type UploadQueueItem = {
  id: string;
  file: File;
  assetId?: string;
  status: UploadQueueStatus;
  progress: number;
  error?: string;
  existingAssetId?: string;
};

type UploadConflictError = Error & { existingAssetId?: string };

const ACCEPTED_EXTENSIONS = [
  ".ai",
  ".aco",
  ".ase",
  ".docx",
  ".eot",
  ".eps",
  ".gif",
  ".idml",
  ".indd",
  ".jpeg",
  ".jpg",
  ".mov",
  ".mp4",
  ".otf",
  ".pdf",
  ".png",
  ".pptx",
  ".psd",
  ".svg",
  ".ttf",
  ".webp",
  ".woff",
  ".woff2",
  ".xlsx",
  ".zip",
];

const ACCEPTED_FILE_TYPES = ACCEPTED_EXTENSIONS.join(",");

/** Mirrors RESOURCE_ASSET_MAX_BYTES so a doomed upload fails before it starts. */
const MAX_UPLOAD_BYTES = 250 * 1024 * 1024;

/** Row thumbnails stream the full original, so fall back to the kind icon for large files. */
const MAX_THUMBNAIL_BYTES = 4 * 1024 * 1024;

/** A row-sized specimen is not worth downloading a very large font face for. */
const MAX_INLINE_FONT_BYTES = 8 * 1024 * 1024;

/**
 * Client-side mirror of the server's file contract. The server stays the
 * authority; this only avoids burning an upload intent and a slow transfer on
 * a file that is already known to be rejected.
 */
function fileRejectionReason(file: File): string | null {
  const extension = file.name.includes(".") ? `.${(file.name.split(".").pop() ?? "").toLowerCase()}` : "";
  if (!ACCEPTED_EXTENSIONS.includes(extension)) return "unsupported file type";
  if (file.size <= 0) return "empty file";
  if (file.size > MAX_UPLOAD_BYTES) return "larger than the 250 MB limit";
  return null;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB"];
  let size = value / 1024;
  let unit = "KB";
  for (let index = 0; index < units.length - 1 && size >= 1024; index += 1) {
    size /= 1024;
    unit = units[index + 1] ?? unit;
  }
  return `${size < 10 ? size.toFixed(1) : Math.round(size)} ${unit}`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function assetHref(assetId: string, versionId?: string, download = false): string {
  const params = new URLSearchParams();
  if (download) params.set("download", "1");
  if (versionId) params.set("versionId", versionId);
  const query = params.toString();
  return `/api/resources/assets/${assetId}/download${query ? `?${query}` : ""}`;
}

function isBrowserViewable(contentType: string): boolean {
  return contentType === "application/pdf";
}

function isImagePreviewable(contentType: string): boolean {
  return contentType.startsWith("image/");
}

function isFontPreviewable(contentType: string): boolean {
  return contentType.startsWith("font/")
    || contentType === "application/x-font-opentype"
    || contentType === "application/x-font-ttf"
    || contentType === "application/vnd.ms-fontobject";
}

function isPreviewable(contentType: string): boolean {
  return isBrowserViewable(contentType) || isImagePreviewable(contentType) || isFontPreviewable(contentType);
}

function isVersionInlineViewable(contentType: string): boolean {
  return isBrowserViewable(contentType) || isImagePreviewable(contentType);
}

function fontFormat(contentType: string): string {
  if (contentType.includes("woff2")) return "woff2";
  if (contentType.includes("woff")) return "woff";
  if (contentType.includes("ttf")) return "truetype";
  return "opentype";
}

function versionLabel(version: VersionSummary | null): string {
  return version ? `v${version.versionNumber}` : "No version";
}

function folderDisplayPath(path: string): string {
  return path.replace(/^brand-assets\/?/, "") || "Brand assets";
}

function recentStorageKey(): string {
  return "wisconsin-creative.resource-assets.recent";
}

function AssetIcon({ kind, className }: { kind: ResourceAssetKind; className?: string }) {
  const Icon = kind === ResourceAssetKind.PHOTO
    ? ImageIcon
    : kind === ResourceAssetKind.FONT
      ? TypeIcon
      : kind === ResourceAssetKind.LOGO
        ? ImageIcon
        : kind === ResourceAssetKind.GRAPHIC_ELEMENT
          ? ImageIcon
          : kind === ResourceAssetKind.VIDEO
            ? FileIcon
            : kind === ResourceAssetKind.DOCUMENT || kind === ResourceAssetKind.TEMPLATE
              ? FileTextIcon
              : FileIcon;
  return <Icon className={cn("size-4", className)} aria-hidden="true" />;
}

function FontSpecimen({ asset, compact = false }: { asset: AssetSummary; compact?: boolean }) {
  const version = asset.currentVersion;
  if (!version || !isFontPreviewable(version.contentType)) return null;
  if (compact && version.sizeBytes > MAX_INLINE_FONT_BYTES) return <AssetIcon kind={asset.kind} />;
  const family = `resource-asset-font-${asset.id.replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <div className={cn("min-w-0 overflow-hidden", compact ? "text-lg" : "w-full") }>
      <style>{`@font-face{font-family:"${family}";src:url("${assetHref(asset.id, version.id)}") format("${fontFormat(version.contentType)}");font-display:swap;font-weight:400;font-style:normal}`}</style>
      <span className={cn("block truncate", compact ? "text-lg" : "text-5xl sm:text-6xl")} style={{ fontFamily: `"${family}"` }}>
        Aa Bb Cc 123
      </span>
      {!compact && <p className="mt-3 text-sm text-muted-foreground">The font is previewed in-browser and is not installed on your device.</p>}
    </div>
  );
}

function AssetPreviewContent({ asset }: { asset: AssetSummary }) {
  const current = asset.currentVersion;
  if (!current) {
    return (
      <div className="flex min-h-44 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-muted/20 p-8 text-center">
        <AssetIcon kind={asset.kind} className="size-8" />
        <p className="text-sm text-muted-foreground">There is no uploaded version to preview yet.</p>
      </div>
    );
  }
  if (isImagePreviewable(current.contentType)) {
    return (
      <div className="flex min-h-44 items-center justify-center overflow-hidden rounded-lg border border-border/80 bg-[linear-gradient(45deg,hsl(var(--muted))_25%,transparent_25%),linear-gradient(-45deg,hsl(var(--muted))_25%,transparent_25%),linear-gradient(45deg,transparent_75%,hsl(var(--muted))_75%),linear-gradient(-45deg,transparent_75%,hsl(var(--muted))_75%)] bg-[length:24px_24px] bg-[position:0_0,0_12px,12px_-12px,-12px_0px] p-4">
        <img
          src={assetHref(asset.id, current.id)}
          alt={asset.name}
          className="max-h-[min(52vh,520px)] max-w-full object-contain"
        />
      </div>
    );
  }
  if (isBrowserViewable(current.contentType)) {
    return (
      <iframe
        src={assetHref(asset.id, current.id)}
        title={`${asset.name} preview`}
        className="h-[min(62vh,620px)] min-h-80 w-full rounded-lg border border-border/80 bg-muted/20"
      />
    );
  }
  if (isFontPreviewable(current.contentType)) {
    return (
      <div className="flex min-h-44 items-center justify-center rounded-lg border border-border/80 bg-muted/20 p-8 text-center">
        <FontSpecimen asset={asset} />
      </div>
    );
  }
  return (
    <div className="flex min-h-44 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-muted/20 p-8 text-center">
      <div className="flex size-14 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <AssetIcon kind={asset.kind} className="size-7" />
      </div>
      <p className="max-w-sm text-sm text-muted-foreground">Preview is not available for this file type. Download the current version to open it in its native application.</p>
    </div>
  );
}

async function readUploadError(response: Response, fallback: string): Promise<UploadConflictError> {
  const body = await parseJsonSafely<ApiEnvelope<{ existingAssetId?: string }>>(response);
  const error = new Error(body?.error ?? fallback) as UploadConflictError;
  error.existingAssetId = body?.data?.existingAssetId;
  return error;
}

function LibrarySkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-28 rounded-lg" />)}
      </div>
      <Skeleton className="h-20 rounded-lg" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-20 rounded-lg" />)}
      </div>
    </div>
  );
}

function NewFolderDialog({
  open,
  parentId,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  parentId: string;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setSaving(false);
    }
  }, [open]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      const response = await fetch("/api/resources/assets/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), parentId }),
      });
      if (handleAuthRedirect(response)) return;
      if (!response.ok) throw new Error(await parseErrorMessage(response, "Could not create folder."));
      toast.success(`Created ${name.trim()}`);
      onOpenChange(false);
      onCreated();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create folder.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New folder</DialogTitle>
          <DialogDescription>Create a focused place for related brand files.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <DialogBody className="py-5">
            <Label htmlFor="brand-asset-folder-name">Folder name</Label>
            <Input
              id="brand-asset-folder-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-2 h-10"
              placeholder="Campaign exports"
              autoFocus
              maxLength={80}
            />
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" className="h-10" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" className="h-10" disabled={!name.trim() || saving}>
              {saving ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <PlusIcon data-icon="inline-start" />}
              Create folder
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function UploadAssetDialog({
  open,
  folderId,
  asset,
  initialFiles,
  onOpenChange,
  onCompleted,
}: {
  open: boolean;
  folderId: string;
  asset: AssetSummary | null;
  initialFiles: File[];
  onOpenChange: (open: boolean) => void;
  onCompleted: () => void;
}) {
  const replacement = Boolean(asset);
  const [queue, setQueue] = useState<UploadQueueItem[]>([]);
  const queueRef = useRef<UploadQueueItem[]>([]);
  const [kind, setKind] = useState<ResourceAssetKind>(ResourceAssetKind.OTHER);
  const [description, setDescription] = useState("");
  const [versionNote, setVersionNote] = useState("");
  const [uploading, setUploading] = useState(false);
  const uploadingRef = useRef(false);
  const [dragging, setDragging] = useState(false);

  const updateQueue = (updater: (items: UploadQueueItem[]) => UploadQueueItem[]) => {
    const next = updater(queueRef.current);
    queueRef.current = next;
    setQueue(next);
  };

  useEffect(() => {
    if (!open) return;
    // Files dropped on the file list open this dialog already loaded, so the
    // reset seeds the queue instead of clearing it.
    const seeded = initialFiles
      .filter((file) => !fileRejectionReason(file))
      .slice(0, asset ? 1 : undefined)
      .map((file) => ({
        id: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
        file,
        assetId: asset?.id,
        status: "queued" as const,
        progress: 0,
      }));
    queueRef.current = seeded;
    setQueue(seeded);
    setKind(asset?.kind ?? ResourceAssetKind.OTHER);
    setDescription(asset?.description ?? "");
    setVersionNote("");
    setUploading(false);
    uploadingRef.current = false;
    setDragging(false);
  }, [open, asset, initialFiles]);

  const queueItem = (file: File): UploadQueueItem => ({
    id: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
    file,
    assetId: asset?.id,
    status: "queued",
    progress: 0,
  });

  const addFiles = (incoming: FileList | File[]) => {
    const selected = Array.from(incoming).slice(0, replacement ? 1 : undefined);
    if (selected.length === 0) return;

    const accepted: File[] = [];
    const rejected: string[] = [];
    for (const file of selected) {
      const reason = fileRejectionReason(file);
      if (reason) rejected.push(`${file.name} (${reason})`);
      else accepted.push(file);
    }
    if (rejected.length > 0) {
      toast.error(rejected.length === 1
        ? `${rejected[0]} was not added.`
        : `${rejected.length} files were not added: ${rejected.slice(0, 3).join(", ")}${rejected.length > 3 ? "…" : ""}`);
    }
    if (accepted.length === 0) return;

    updateQueue((items) => {
      // A replacement holds exactly one file, so re-picking the same file has to
      // replace the selection rather than dedupe itself down to an empty queue.
      if (replacement) return accepted.slice(0, 1).map(queueItem);
      const existingKeys = new Set(items.map((item) => `${item.file.name}:${item.file.size}:${item.file.lastModified}`));
      const additions = accepted
        .filter((file) => !existingKeys.has(`${file.name}:${file.size}:${file.lastModified}`))
        .map(queueItem);
      return [...items, ...additions];
    });
  };

  const uploadOne = async (item: UploadQueueItem): Promise<"completed" | "failed" | "conflict"> => {
    updateQueue((items) => items.map((candidate) => candidate.id === item.id ? { ...candidate, status: "uploading", progress: 0, error: undefined } : candidate));
    try {
      const prepareResponse = await fetch("/api/resources/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folderId,
          assetId: item.assetId,
          name: asset?.name ?? item.file.name,
          kind: asset?.kind ?? kind,
          description: asset?.description ?? (description.trim() || null),
          versionNote: versionNote.trim() || null,
          originalName: item.file.name,
          contentType: item.file.type || "application/octet-stream",
          sizeBytes: item.file.size,
        }),
      });
      if (handleAuthRedirect(prepareResponse)) return "failed";
      if (!prepareResponse.ok) {
        const error = await readUploadError(prepareResponse, "Could not start the upload.");
        if (error.existingAssetId) {
          updateQueue((items) => items.map((candidate) => candidate.id === item.id
            ? { ...candidate, status: "conflict", existingAssetId: error.existingAssetId, error: error.message }
            : candidate));
          return "conflict";
        }
        throw error;
      }
      const prepared = await parseJsonSafely<ApiEnvelope<{
        id: string;
        storagePath: string;
        name: string;
        versionNumber: number;
        contentType: string;
      }>>(prepareResponse);
      if (!prepared?.data) throw new Error("The upload did not return an intent.");

      await upload(prepared.data.storagePath, item.file, {
        access: "private",
        handleUploadUrl: "/api/resources/assets/upload-token",
        clientPayload: JSON.stringify({ intentId: prepared.data.id }),
        multipart: item.file.size > 4 * 1024 * 1024,
        contentType: prepared.data.contentType,
        onUploadProgress: ({ percentage }) => updateQueue((items) => items.map((candidate) => candidate.id === item.id
          ? { ...candidate, progress: Math.round(percentage) }
          : candidate)),
      });

      const completeResponse = await fetch("/api/resources/assets/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intentId: prepared.data.id }),
      });
      if (handleAuthRedirect(completeResponse)) return "failed";
      if (!completeResponse.ok) throw new Error(await parseErrorMessage(completeResponse, "The upload could not be finalized."));
      const completed = await parseJsonSafely<ApiEnvelope<{ versionNumber: number; name: string }>>(completeResponse);
      if (!completed?.data) throw new Error("The upload did not return a completed file.");

      updateQueue((items) => items.map((candidate) => candidate.id === item.id
        ? { ...candidate, status: "completed", progress: 100, error: undefined }
        : candidate));
      return "completed";
    } catch (error) {
      const message = error instanceof Error ? error.message : "The upload could not be completed.";
      updateQueue((items) => items.map((candidate) => candidate.id === item.id
        ? { ...candidate, status: "failed", error: message }
        : candidate));
      return "failed";
    }
  };

  const processUploads = async () => {
    if (uploadingRef.current) return;
    uploadingRef.current = true;
    setUploading(true);
    try {
      while (true) {
        const next = queueRef.current.find((item) => item.status === "queued");
        if (!next) break;
        // A name conflict parks that one file for a choice; the rest of the
        // batch keeps uploading instead of stalling behind it.
        await uploadOne(next);
      }
      const completedCount = queueRef.current.filter((item) => item.status === "completed").length;
      const failedCount = queueRef.current.filter((item) => item.status === "failed").length;
      const skippedCount = queueRef.current.filter((item) => item.status === "skipped").length;
      const conflictCount = queueRef.current.filter((item) => item.status === "conflict").length;
      if (completedCount > 0) onCompleted();
      if (conflictCount > 0) {
        toast.warning(`${conflictCount} file${conflictCount === 1 ? " already exists" : "s already exist"}. Choose a new version or skip.`);
      } else if (failedCount > 0) {
        toast.error(`${failedCount} file${failedCount === 1 ? "" : "s"} could not be uploaded. Retry from this dialog.`);
      } else if (completedCount > 0) {
        toast.success(`Uploaded ${completedCount} file${completedCount === 1 ? "" : "s"}`);
        onOpenChange(false);
      } else if (skippedCount > 0) {
        toast.info("No files uploaded.");
        onOpenChange(false);
      }
    } finally {
      uploadingRef.current = false;
      setUploading(false);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (queue.length === 0 || uploading) return;
    await processUploads();
  };

  const resolveConflict = (itemId: string, action: "version" | "skip") => {
    const conflict = queueRef.current.find((item) => item.id === itemId);
    if (!conflict) return;
    updateQueue((items) => items.map((item) => item.id === itemId
      ? action === "version"
        ? { ...item, assetId: item.existingAssetId, status: "queued", error: undefined }
        : { ...item, status: "skipped", error: undefined }
      : item));
    void processUploads();
  };

  const retryFailed = () => {
    updateQueue((items) => items.map((item) => item.status === "failed" ? { ...item, status: "queued", progress: 0, error: undefined } : item));
    void processUploads();
  };

  const removeItem = (itemId: string) => updateQueue((items) => items.filter((item) => item.id !== itemId));

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (!uploading) addFiles(event.dataTransfer.files);
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !uploading && onOpenChange(nextOpen)}>
      <DialogContent className="max-w-[680px]">
        <DialogHeader>
          <DialogTitle>{replacement ? "Upload new version" : "Upload brand asset"}</DialogTitle>
          <DialogDescription>
            {replacement
              ? `This stays ${asset?.name}. The next version is added to History; earlier versions are not deleted.`
              : "Drop one or more files here. Each file gets its own stable row and version history."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <DialogBody className="flex max-h-[min(70vh,680px)] flex-col gap-5 overflow-y-auto py-5">
            <div>
              <Label htmlFor="brand-asset-file">{replacement ? "Replacement file" : "Files"}</Label>
              <div
                onDragEnter={(event) => { event.preventDefault(); if (!uploading) setDragging(true); }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }}
                onDrop={handleDrop}
                className={cn(
                  "mt-2 flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border bg-muted/30 px-4 text-center transition-colors hover:bg-muted/55 focus-within:ring-[3px] focus-within:ring-ring/50",
                  dragging && "border-primary bg-primary/5",
                )}
              >
                <label htmlFor="brand-asset-file" className="flex cursor-pointer flex-col items-center gap-1">
                  <UploadIcon className="size-5 text-muted-foreground" aria-hidden="true" />
                  <span className="text-sm font-medium">{dragging ? "Drop to add files" : "Choose files or drag them here"}</span>
                  <span className="text-xs text-muted-foreground">PDF, logo, font, template, image, or production file · up to 250 MB each</span>
                </label>
              </div>
              <input
                id="brand-asset-file"
                type="file"
                accept={ACCEPTED_FILE_TYPES}
                multiple={!replacement}
                className="sr-only"
                onChange={(event) => { addFiles(event.target.files ?? []); event.currentTarget.value = ""; }}
                disabled={uploading}
              />
            </div>

            {queue.length > 0 && (
              <div className="flex flex-col gap-2" aria-live="polite">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold">Upload queue <span className="font-normal text-muted-foreground">({queue.length})</span></p>
                  {queue.some((item) => item.status === "failed") && !uploading && (
                    <Button type="button" variant="ghost" size="sm" className="h-8" onClick={retryFailed}>
                      <RotateCcwIcon data-icon="inline-start" /> Retry failed
                    </Button>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  {queue.map((item) => (
                    <div key={item.id} className="rounded-md border border-border/80 bg-muted/20 p-3">
                      <div className="flex items-start gap-3">
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                          {item.status === "completed" ? <CheckCircle2Icon className="size-4 text-green-600" aria-hidden="true" /> : item.status === "failed" || item.status === "conflict" ? <XIcon className="size-4 text-destructive" aria-hidden="true" /> : <FileIcon className="size-4" aria-hidden="true" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{item.file.name}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {formatBytes(item.file.size)} · {item.status === "uploading" ? `Uploading ${item.progress}%` : item.status === "completed" ? "Uploaded" : item.status === "skipped" ? "Skipped" : item.status === "conflict" ? "Already exists" : item.status === "failed" ? "Upload failed" : "Ready"}
                          </p>
                          {item.status === "uploading" && <Progress value={item.progress} className="mt-2" aria-label={`${item.file.name} upload progress ${item.progress}%`} />}
                          {item.error && <p className="mt-2 text-xs text-destructive">{item.error}</p>}
                          {item.status === "conflict" && item.existingAssetId && (
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              <span className="text-xs text-muted-foreground">Use the existing row or skip this file.</span>
                              <Button type="button" size="sm" className="h-8" onClick={() => resolveConflict(item.id, "version")}>
                                Upload as new version
                              </Button>
                              <Button type="button" variant="ghost" size="sm" className="h-8" onClick={() => resolveConflict(item.id, "skip")}>
                                Skip
                              </Button>
                            </div>
                          )}
                        </div>
                        {!uploading && (item.status === "queued" || item.status === "failed") && (
                          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${item.file.name}`} onClick={() => removeItem(item.id)}>
                            <XIcon />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!replacement && (
              <div>
                <Label htmlFor="brand-asset-kind">File kind</Label>
                <Select value={kind} onValueChange={(value) => setKind(value as ResourceAssetKind)}>
                  <SelectTrigger id="brand-asset-kind" className="mt-2 h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>Brand asset type</SelectLabel>
                      {RESOURCE_ASSET_KIND_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            )}

            {!replacement && (
              <div>
                <Label htmlFor="brand-asset-description">Description <span className="font-normal text-muted-foreground">(optional, applies to new files)</span></Label>
                <Input
                  id="brand-asset-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  className="mt-2 h-10"
                  placeholder="Primary marks for campaign lockups"
                  maxLength={1000}
                  disabled={uploading}
                />
              </div>
            )}

            <div>
              <Label htmlFor="brand-asset-version-note">What changed <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <Input
                id="brand-asset-version-note"
                value={versionNote}
                onChange={(event) => setVersionNote(event.target.value)}
                className="mt-2 h-10"
                placeholder={replacement ? "Updated clear-space examples" : "Primary mark for campaign lockups"}
                maxLength={500}
                disabled={uploading}
              />
              <p className="mt-1 text-xs text-muted-foreground">This note stays with the version in History.</p>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" className="h-10" onClick={() => onOpenChange(false)} disabled={uploading}>
              Cancel
            </Button>
            <Button type="submit" className="h-10" disabled={queue.length === 0 || uploading || !queue.some((item) => item.status === "queued")}>
              {uploading ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <UploadIcon data-icon="inline-start" />}
              {replacement ? "Upload version" : "Upload file"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AssetPreviewDialog({
  open,
  asset,
  onOpenChange,
  onHistory,
  onCopyLink,
}: {
  open: boolean;
  asset: AssetSummary | null;
  onOpenChange: (open: boolean) => void;
  onHistory: () => void;
  onCopyLink: () => void;
}) {
  const current = asset?.currentVersion;
  const canOpenInline = Boolean(current && (isBrowserViewable(current.contentType) || isImagePreviewable(current.contentType)));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[880px]">
        <DialogHeader>
          <div className="flex items-start gap-3 pr-8">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/70 text-muted-foreground">
              {asset && <AssetIcon kind={asset.kind} />}
            </div>
            <div className="min-w-0">
              <DialogTitle className="truncate">{asset?.name ?? "Brand asset"}</DialogTitle>
              <DialogDescription>
                {asset ? `${RESOURCE_ASSET_KIND_LABELS[asset.kind]} · ${versionLabel(current ?? null)}` : "Current version"}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <DialogBody className="flex max-h-[min(78vh,760px)] flex-col gap-4 overflow-y-auto py-5">
          {asset ? <AssetPreviewContent asset={asset} /> : <Skeleton className="h-72 rounded-lg" />}
          {asset && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
              <span>{asset.folder.path.replace(/^brand-assets\/?/, "") || "Brand assets"}</span>
              {current && <span>{formatBytes(current.sizeBytes)}</span>}
              {current && <span>Updated {formatDate(current.createdAt)}</span>}
              {current?.versionNote && <span className="basis-full text-foreground">“{current.versionNote}”</span>}
            </div>
          )}
        </DialogBody>
        <DialogFooter className="flex-wrap sm:justify-between">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="ghost" className="h-10" onClick={onHistory} disabled={!asset}>
              <HistoryIcon data-icon="inline-start" /> History
            </Button>
            <Button type="button" variant="outline" className="h-10" onClick={onCopyLink} disabled={!asset}>
              <LinkIcon data-icon="inline-start" /> Copy internal link
            </Button>
          </div>
          {asset && current && (
            <Button asChild className="h-10">
              <a
                href={assetHref(asset.id, current.id, !canOpenInline)}
                {...(canOpenInline ? { target: "_blank", rel: "noreferrer" } : {})}
              >
                {canOpenInline ? <EyeIcon data-icon="inline-start" /> : <DownloadIcon data-icon="inline-start" />}
                {canOpenInline ? "Open full preview" : "Download"}
              </a>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VersionHistoryDialog({
  open,
  asset,
  onOpenChange,
  canManage,
  onRestored,
}: {
  open: boolean;
  asset: AssetSummary | null;
  onOpenChange: (open: boolean) => void;
  canManage: boolean;
  onRestored: () => void;
}) {
  const [restoringVersionId, setRestoringVersionId] = useState<string | null>(null);
  const detail = useFetch<AssetDetail>({
    url: asset ? `/api/resources/assets/${asset.id}` : "/api/resources/assets/none",
    enabled: open && Boolean(asset),
    refetchOnFocus: false,
    transform: (json) => (json as { data: AssetDetail }).data,
  });
  const detailData = detail.data;

  const restoreVersion = async (versionId: string) => {
    if (!asset || restoringVersionId) return;
    setRestoringVersionId(versionId);
    try {
      const response = await fetch(`/api/resources/assets/${asset.id}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId }),
      });
      if (handleAuthRedirect(response)) return;
      if (!response.ok) throw new Error(await parseErrorMessage(response, "Could not restore this version."));
      const restored = await parseJsonSafely<ApiEnvelope<{ versionNumber: number }>>(response);
      if (!restored?.data) throw new Error("The restored version was not returned.");
      toast.success(`Version ${restored.data.versionNumber} is now current.`);
      onRestored();
      detail.reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not restore this version.");
    } finally {
      setRestoringVersionId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Version history</DialogTitle>
          <DialogDescription>{asset?.name ?? "Brand asset"}</DialogDescription>
        </DialogHeader>
        <DialogBody className="max-h-[min(65vh,560px)] py-5">
          {detail.loading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-16 rounded-md" />
              <Skeleton className="h-16 rounded-md" />
              <Skeleton className="h-16 rounded-md" />
            </div>
          ) : detail.error || !detailData ? (
            <EmptyState
              inline
              icon="wifi-off"
              title="Could not load history"
              description="Try again before treating this file’s version list as complete."
              actionLabel="Retry"
              onAction={detail.reload}
            />
          ) : (
            <div className="flex flex-col gap-2">
              {detailData.versions.map((version) => (
                <div key={version.id} className="flex flex-wrap items-center gap-3 rounded-md border border-border/80 bg-muted/20 p-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <FileIcon className="size-4" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">Version {version.versionNumber}</span>
                      {version.id === detailData.currentVersion?.id && <Badge variant="secondary" size="sm">Current</Badge>}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {version.originalName} · {formatBytes(version.sizeBytes)} · {formatDate(version.createdAt)} · {version.uploadedBy.name}
                    </p>
                    {version.versionNote && <p className="mt-1 line-clamp-2 text-xs text-foreground/80">{version.versionNote}</p>}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1">
                    {canManage && version.id !== detailData.currentVersion?.id && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-10"
                        onClick={() => restoreVersion(version.id)}
                        disabled={Boolean(restoringVersionId)}
                      >
                        {restoringVersionId === version.id ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <RotateCcwIcon data-icon="inline-start" />}
                        Make current
                      </Button>
                    )}
                    <Button asChild variant="ghost" size="sm" className="h-10 shrink-0">
                      <a
                        href={assetHref(detailData.id, version.id, !isVersionInlineViewable(version.contentType))}
                        {...(isVersionInlineViewable(version.contentType) ? { target: "_blank", rel: "noreferrer" } : {})}
                      >
                        {isVersionInlineViewable(version.contentType) ? <FileTextIcon data-icon="inline-start" /> : <DownloadIcon data-icon="inline-start" />}
                        {isVersionInlineViewable(version.contentType) ? "View" : "Download"}
                      </a>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

type LibraryView = "home" | "recent" | "starred";

type SortKey = "name" | "updated" | "type";

function SortableHead({
  label,
  sortKey,
  activeSort,
  className,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  activeSort: SortKey;
  className?: string;
  onSort: (sort: SortKey) => void;
}) {
  const active = activeSort === sortKey;
  return (
    <TableHead className={className} aria-sort={active ? (sortKey === "updated" ? "descending" : "ascending") : "none"}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="flex min-h-8 items-center gap-1 rounded-md text-left transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <span className={cn(active && "font-semibold text-foreground")}>{label}</span>
        <ArrowDownUpIcon className={cn("size-3 shrink-0", active ? "text-foreground" : "text-muted-foreground/50")} aria-hidden="true" />
      </button>
    </TableHead>
  );
}

function LibraryRail({
  breadcrumbs,
  childFolders,
  canManage,
  view,
  onNavigate,
  onNewFolder,
  onUpload,
  onViewChange,
}: {
  breadcrumbs: Breadcrumb[];
  childFolders: FolderSummary[];
  canManage: boolean;
  view: LibraryView;
  onNavigate: (folderId?: string) => void;
  onNewFolder: () => void;
  onUpload: () => void;
  onViewChange: (view: LibraryView) => void;
}) {
  const currentFolderId = breadcrumbs.at(-1)?.id;
  const rootFolderId = breadcrumbs[0]?.id;

  const navButton = (active: boolean) => cn(
    "flex min-h-10 min-w-0 items-center gap-3 rounded-md px-3 text-left text-sm transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
    active ? "bg-muted font-semibold text-foreground" : "text-muted-foreground",
  );

  return (
    <aside className="hidden min-w-0 lg:block">
      <nav aria-label="Brand asset navigation" className="sticky top-4">
        {canManage && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="mb-4 h-14 w-full justify-start rounded-xl px-4 text-base shadow-xs">
                <PlusIcon className="size-5" aria-hidden="true" />
                New
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52">
              <DropdownMenuItem onSelect={onNewFolder}>
                <FolderPlusIcon /> New folder
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onUpload}>
                <UploadIcon /> Upload file
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <div className="flex flex-col gap-0.5">
          <button
            type="button"
            onClick={() => onViewChange("home")}
            className={navButton(view === "home" && currentFolderId === rootFolderId)}
            aria-current={view === "home" && currentFolderId === rootFolderId ? "page" : undefined}
          >
            <HomeIcon className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate">Home</span>
          </button>
          <button
            type="button"
            onClick={() => onViewChange("recent")}
            className={navButton(view === "recent")}
            aria-current={view === "recent" ? "page" : undefined}
          >
            <Clock3Icon className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate">Recent</span>
          </button>
          <button
            type="button"
            onClick={() => onViewChange("starred")}
            className={navButton(view === "starred")}
            aria-current={view === "starred" ? "page" : undefined}
          >
            <StarIcon className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate">Starred</span>
          </button>
        </div>
        <div className="my-4 border-t border-border/70" />
        <p className="px-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Folders</p>
        <div className="mt-2 flex flex-col gap-0.5">
          {breadcrumbs.map((crumb, index) => {
            const current = view === "home" && crumb.id === currentFolderId;
            return (
              <button
                type="button"
                key={crumb.id}
                onClick={() => onNavigate(index === 0 ? undefined : crumb.id)}
                aria-current={current ? "page" : undefined}
                className={cn(
                  navButton(current),
                  index > 0 && "pl-8",
                  current ? "bg-muted font-semibold text-foreground" : "text-muted-foreground",
                )}
              >
                {index === 0 ? <HardDriveIcon className="size-4 shrink-0" aria-hidden="true" /> : <FolderIcon className="size-4 shrink-0" aria-hidden="true" />}
                <span className="min-w-0 truncate">{crumb.name}</span>
              </button>
            );
          })}
          {/* Children of the open folder, so the rail is a walkable tree rather
              than a read-only echo of the breadcrumb path. */}
          {childFolders.map((child) => (
            <button
              type="button"
              key={child.id}
              onClick={() => onNavigate(child.id)}
              className={cn(navButton(false), breadcrumbs.length > 1 ? "pl-12" : "pl-8")}
            >
              <FolderIcon className="size-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{child.name}</span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground/70">{child.assetCount}</span>
            </button>
          ))}
        </div>
      </nav>
    </aside>
  );
}

function FolderCard({ folder, onOpen }: { folder: FolderSummary; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-20 min-w-0 items-center gap-3 rounded-lg border border-border/70 bg-muted/20 px-4 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      aria-label={`Open ${folder.name}`}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <FolderIcon className="size-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{folder.name}</span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {folder.assetCount} {folder.assetCount === 1 ? "file" : "files"}
        </span>
      </span>
      <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground/60" aria-hidden="true" />
    </button>
  );
}

function AssetRow({
  asset,
  canManage,
  favorite,
  showLocation,
  onHistory,
  onPreview,
  onReplace,
  onToggleFavorite,
  onCopyLink,
  onUse,
}: {
  asset: AssetSummary;
  canManage: boolean;
  favorite: boolean;
  showLocation: boolean;
  onHistory: () => void;
  onPreview: () => void;
  onReplace: () => void;
  onToggleFavorite: () => void;
  onCopyLink: () => void;
  onUse: () => void;
}) {
  const current = asset.currentVersion;
  const canOpenInline = Boolean(current && isBrowserViewable(current.contentType));

  return (
    <TableRow striped={false} className="group">
      <TableCell className="w-[52%] max-w-0">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border/60 bg-muted/70 text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            onClick={() => { onUse(); onPreview(); }}
            aria-label={`${current && isPreviewable(current.contentType) ? "Preview" : "Open details for"} ${asset.name}`}
          >
            {current && isImagePreviewable(current.contentType) && current.sizeBytes <= MAX_THUMBNAIL_BYTES ? (
              <img src={assetHref(asset.id, current.id)} alt="" loading="lazy" className="size-full object-contain" />
            ) : current && isFontPreviewable(current.contentType) ? (
              <FontSpecimen asset={asset} compact />
            ) : (
              <AssetIcon kind={asset.kind} />
            )}
          </button>
          <button
            type="button"
            onClick={() => { onUse(); onPreview(); }}
            className="min-h-10 min-w-0 flex-1 rounded-md py-1 text-left transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            aria-label={`Open ${asset.name}`}
          >
            <span className="block truncate text-sm font-semibold text-foreground">{asset.name}</span>
            <span className="mt-1 block truncate text-xs text-muted-foreground">
              {current ? `${current.originalName} · ${formatBytes(current.sizeBytes)}` : "No uploaded version"}
              {showLocation && ` · ${folderDisplayPath(asset.folder.path)}`}
            </span>
            {asset.description && <span className="mt-1 block truncate text-xs text-muted-foreground/80">{asset.description}</span>}
          </button>
        </div>
      </TableCell>
      <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
        {RESOURCE_ASSET_KIND_LABELS[asset.kind]}
      </TableCell>
      <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
        {current ? <time dateTime={current.createdAt}>{formatDate(current.createdAt)}</time> : "—"}
      </TableCell>
      <TableCell className="hidden text-xs tabular-nums text-muted-foreground sm:table-cell">
        {current ? `${versionLabel(current)} · ${asset.versionCount}` : "—"}
      </TableCell>
      <TableCell className="w-px text-right">
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-10"
            onClick={onToggleFavorite}
            aria-label={favorite ? `Remove ${asset.name} from favorites` : `Favorite ${asset.name}`}
            aria-pressed={favorite}
          >
            <StarIcon className={cn(favorite && "fill-[var(--yellow-text)] text-[var(--yellow-text)]")} />
          </Button>
          <OperationalRowActions label={`Actions for ${asset.name}`}>
            {current && (
              <DropdownMenuItem onSelect={() => { onUse(); onPreview(); }}>
                <EyeIcon /> {isPreviewable(current.contentType) ? "Preview" : "Open details"}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => { onUse(); onHistory(); }}>
              <HistoryIcon /> History <span className="ml-auto text-xs text-muted-foreground">{asset.versionCount}</span>
            </DropdownMenuItem>
            {current && (
              <DropdownMenuItem asChild>
                <a
                  href={assetHref(asset.id, undefined, !canOpenInline)}
                  onClick={onUse}
                  {...(canOpenInline ? { target: "_blank", rel: "noreferrer" } : {})}
                >
                  {canOpenInline ? <FileTextIcon /> : <DownloadIcon />}
                  {canOpenInline ? "Open full preview" : "Download"}
                </a>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={onCopyLink}>
              <LinkIcon /> Copy internal link
            </DropdownMenuItem>
            {canManage && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onReplace}>
                  <ArrowUpIcon /> New version
                </DropdownMenuItem>
              </>
            )}
          </OperationalRowActions>
        </div>
      </TableCell>
    </TableRow>
  );
}

export function BrandAssetLibrary({ canManage }: { canManage: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const folderId = searchParams.get("folder");
  const linkedAssetId = searchParams.get("asset");
  const [search, setSearch] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [scope, setScope] = useState<"folder" | "all">("folder");
  const [kindFilter, setKindFilter] = useState<"ALL" | ResourceAssetKind>("ALL");
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>("name");
  const [libraryView, setLibraryView] = useState<LibraryView>("home");
  const [favoriteOverrides, setFavoriteOverrides] = useState<Record<string, boolean>>({});
  const [recentAssets, setRecentAssets] = useState<RecentAsset[]>([]);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [replaceAsset, setReplaceAsset] = useState<AssetSummary | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [dropActive, setDropActive] = useState(false);
  const dragDepthRef = useRef(0);
  const [previewAsset, setPreviewAsset] = useState<AssetSummary | null>(null);
  const [historyAsset, setHistoryAsset] = useState<AssetSummary | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearchQuery(search), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(recentStorageKey()) ?? "null") as unknown;
      if (!Array.isArray(stored)) return;
      // Device-local storage is user-writable and can hold an older shape, so
      // only keep entries that still carry the id these shortcuts resolve by.
      const valid = stored.filter((entry): entry is RecentAsset =>
        Boolean(entry) && typeof entry === "object" && typeof (entry as RecentAsset).id === "string");
      setRecentAssets(valid.slice(0, 5));
    } catch {
      setRecentAssets([]);
    }
  }, []);

  const rememberRecent = useCallback((asset: RecentAsset) => {
    setRecentAssets((current) => {
      const next = [asset, ...current.filter((item) => item.id !== asset.id)].slice(0, 5);
      try {
        window.localStorage.setItem(recentStorageKey(), JSON.stringify(next));
      } catch {
        // Private-mode or quota failures only cost the device-local shortcut.
      }
      return next;
    });
  }, []);

  const libraryUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (folderId) params.set("folderId", folderId);
    if (searchQuery.trim()) params.set("q", searchQuery.trim());
    if (kindFilter !== "ALL") params.set("kind", kindFilter);
    if (favoriteOnly || libraryView === "starred") params.set("favorites", "1");
    if (libraryView !== "home" || scope === "all") params.set("scope", "all");
    if (sort !== "name") params.set("sort", sort);
    const query = params.toString();
    return `/api/resources/assets${query ? `?${query}` : ""}`;
  }, [favoriteOnly, folderId, kindFilter, libraryView, scope, searchQuery, sort]);

  const library = useFetch<LibraryData>({
    url: libraryUrl,
    keepPreviousData: true,
    transform: (json) => (json as { data: LibraryData }).data,
  });

  const isFavorite = (asset: AssetSummary) => favoriteOverrides[asset.id] ?? asset.isFavorite;
  const hasDiscoveryFilters = Boolean(search.trim() || searchQuery.trim() || kindFilter !== "ALL" || favoriteOnly || scope === "all");
  const filterCount = (scope === "all" ? 1 : 0) + (kindFilter !== "ALL" ? 1 : 0) + (favoriteOnly ? 1 : 0);
  const hasAppliedFilters = filterCount > 0 || sort !== "name";

  const clearDiscoveryFilters = () => {
    setSearch("");
    setSearchQuery("");
    setKindFilter("ALL");
    setFavoriteOnly(false);
    setScope("folder");
    setSort("name");
  };

  const goToFolder = (nextFolderId?: string) => {
    setLibraryView("home");
    clearDiscoveryFilters();
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "brand-assets");
    params.delete("asset");
    if (nextFolderId) params.set("folder", nextFolderId);
    else params.delete("folder");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const changeLibraryView = (view: LibraryView) => {
    setLibraryView(view);
    clearDiscoveryFilters();
    setFavoriteOnly(view === "starred");
    setScope(view === "home" ? "folder" : "all");
    // Every view returns to the library root: Home previously left a subfolder
    // selected, so the button looked inactive and appeared to do nothing.
    // Unrelated Resources params are preserved, matching goToFolder.
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "brand-assets");
    params.delete("folder");
    params.delete("asset");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const copyAssetLink = async (asset: AssetSummary) => {
    const params = new URLSearchParams();
    params.set("tab", "brand-assets");
    if (asset.folder.path !== "brand-assets") params.set("folder", asset.folderId);
    params.set("asset", asset.id);
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${pathname}?${params.toString()}`);
      toast.success("Internal asset link copied.");
    } catch {
      toast.error("Could not copy the internal asset link.");
    }
  };

  const toggleFavorite = async (asset: AssetSummary) => {
    const previous = isFavorite(asset);
    const next = !previous;
    setFavoriteOverrides((current) => ({ ...current, [asset.id]: next }));
    try {
      const response = await fetch(`/api/resources/assets/${asset.id}/favorite`, { method: "POST" });
      if (handleAuthRedirect(response)) return;
      if (!response.ok) throw new Error(await parseErrorMessage(response, "Could not update favorites."));
      const body = await parseJsonSafely<ApiEnvelope<{ favorited: boolean }>>(response);
      if (!body?.data) throw new Error("The favorite state was not returned.");
      setFavoriteOverrides((current) => ({ ...current, [asset.id]: body.data?.favorited ?? next }));
      library.reload();
    } catch (error) {
      setFavoriteOverrides((current) => ({ ...current, [asset.id]: previous }));
      toast.error(error instanceof Error ? error.message : "Could not update favorites.");
    }
  };

  // `router.replace` lands a tick after the dialog closes, so without this the
  // still-present `?asset=` param re-fired the effect and reopened the preview.
  const openedLinkRef = useRef<string | null>(null);

  useEffect(() => {
    if (!linkedAssetId) {
      openedLinkRef.current = null;
      return;
    }
    if (openedLinkRef.current === linkedAssetId) return;
    const match = library.data?.assets.find((asset) => asset.id === linkedAssetId);
    if (!match) return;
    openedLinkRef.current = linkedAssetId;
    setPreviewAsset(match);
    rememberRecent(match);
  }, [linkedAssetId, library.data?.assets, rememberRecent]);

  const closeLinkedAsset = () => {
    setPreviewAsset(null);
    if (!linkedAssetId) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("asset");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const openPreview = (asset: AssetSummary) => {
    rememberRecent(asset);
    setPreviewAsset(asset);
  };

  const startUpload = (files: File[] = []) => {
    setReplaceAsset(null);
    setPendingFiles(files);
    setUploadDialogOpen(true);
  };

  const dragCarriesFiles = (event: DragEvent<HTMLDivElement>) => Array.from(event.dataTransfer.types).includes("Files");

  // Drop-to-upload over the whole folder view, the way a desktop file browser
  // behaves. Enter/leave are counted because they also fire for child nodes.
  const dropHandlers = canManage && libraryView === "home"
    ? {
        onDragEnter: (event: DragEvent<HTMLDivElement>) => {
          if (!dragCarriesFiles(event)) return;
          event.preventDefault();
          dragDepthRef.current += 1;
          setDropActive(true);
        },
        onDragOver: (event: DragEvent<HTMLDivElement>) => {
          if (!dragCarriesFiles(event)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        },
        onDragLeave: () => {
          dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
          if (dragDepthRef.current === 0) setDropActive(false);
        },
        onDrop: (event: DragEvent<HTMLDivElement>) => {
          if (!dragCarriesFiles(event)) return;
          event.preventDefault();
          dragDepthRef.current = 0;
          setDropActive(false);
          const files = Array.from(event.dataTransfer.files);
          if (files.length > 0) startUpload(files);
        },
      }
    : {};

  const openHistory = (asset: AssetSummary) => {
    rememberRecent(asset);
    setHistoryAsset(asset);
    setPreviewAsset(null);
  };

  const reload = () => library.reload();

  if (library.loading && !library.data) return <LibrarySkeleton />;
  if (library.error && !library.data) {
    return (
      <EmptyState
        icon="wifi-off"
        title="Could not load brand assets"
        description="The Brand assets library is unavailable. Check the connection and try again."
        actionLabel="Retry"
        onAction={reload}
      />
    );
  }
  if (!library.data) return null;
  const libraryData = library.data;
  const assetsById = new Map(libraryData.assets.map((asset) => [asset.id, asset]));
  const displayAssets = libraryView === "recent"
    ? recentAssets.map((recent) => assetsById.get(recent.id)).filter((asset): asset is AssetSummary => Boolean(asset))
    : libraryData.assets;
  const showingGlobalResults = scope === "all" || libraryView !== "home";
  const fileCountLabel = hasDiscoveryFilters && libraryView === "home"
    ? `${displayAssets.length} matching ${displayAssets.length === 1 ? "file" : "files"}`
    : `${displayAssets.length} ${displayAssets.length === 1 ? "file" : "files"}`;
  // Previously gated on `!folderId`, which hid every nested folder: a folder
  // created inside a subfolder could be made but never opened again.
  const showFolders = libraryView === "home" && !showingGlobalResults && !hasDiscoveryFilters && libraryData.folders.length > 0;
  const fileHeading = libraryView === "recent"
    ? "Recent files"
    : libraryView === "starred"
      ? "Starred files"
      : showFolders && !folderId && !hasDiscoveryFilters
        ? "Suggested files"
        : showingGlobalResults
          ? "Search results"
          : "Files";
  const emptyTitle = libraryView === "recent"
    ? "No recent files yet"
    : libraryView === "starred"
      ? "No starred files yet"
      : hasDiscoveryFilters
        ? "No files match these filters"
        : "This folder is empty";

  return (
    <div className="grid gap-5 lg:grid-cols-[208px_minmax(0,1fr)]">
      <LibraryRail
        breadcrumbs={libraryData.breadcrumbs}
        childFolders={libraryData.folders}
        canManage={canManage}
        view={libraryView}
        onNavigate={goToFolder}
        onNewFolder={() => setFolderDialogOpen(true)}
        onUpload={() => startUpload()}
        onViewChange={changeLibraryView}
      />

      <div className="relative min-w-0" {...dropHandlers}>
        {dropActive && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary/5 backdrop-blur-[1px]">
            <p className="flex items-center gap-2 rounded-md bg-background px-4 py-2 text-sm font-semibold shadow-sm">
              <UploadIcon className="size-4" aria-hidden="true" />
              Drop files into {libraryData.folder.name}
            </p>
          </div>
        )}
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <nav aria-label="Brand asset path" className="flex min-w-0 items-center gap-1 overflow-x-auto text-xs">
              {libraryData.breadcrumbs.map((crumb, index) => (
                <span key={crumb.id} className="flex shrink-0 items-center gap-1">
                  {index > 0 && <ChevronRightIcon className="size-4 text-muted-foreground/60" aria-hidden="true" />}
                  <button
                    type="button"
                    onClick={() => goToFolder(index === 0 ? undefined : crumb.id)}
                    className={cn(
                      "min-h-8 rounded-md px-1.5 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                      crumb.id === libraryData.folder.id ? "font-semibold text-foreground" : "text-muted-foreground",
                    )}
                    aria-current={crumb.id === libraryData.folder.id ? "page" : undefined}
                  >
                    {crumb.name}
                  </button>
                </span>
              ))}
              </nav>
              <h2 className="mt-1 truncate text-2xl font-semibold tracking-tight">
                {libraryView === "home" ? libraryData.folder.name : libraryView === "recent" ? "Recent" : "Starred"}
              </h2>
            </div>
            {canManage && (
              <div className="flex shrink-0 flex-wrap gap-2 lg:hidden">
                <Button variant="outline" className="h-10" onClick={() => setFolderDialogOpen(true)}>
                  <PlusIcon data-icon="inline-start" /> New folder
                </Button>
                <Button className="h-10" onClick={() => startUpload()}>
                  <UploadIcon data-icon="inline-start" /> Upload file
                </Button>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="h-10 pl-9"
                placeholder="Search in Brand assets"
                aria-label="Search brand assets"
              />
            </div>
            <div className="flex items-center gap-2">
              <Select value={sort} onValueChange={(value) => setSort(value as SortKey)}>
                <SelectTrigger className="h-10 w-full sm:w-40" aria-label="Sort brand assets"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="name">Name A-Z</SelectItem>
                  <SelectItem value="updated">Recently updated</SelectItem>
                  <SelectItem value="type">File kind</SelectItem>
                </SelectContent>
              </Select>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant={filterCount > 0 ? "secondary" : "outline"}
                    className="h-10 shrink-0"
                    aria-label={filterCount > 0 ? `Filters, ${filterCount} active` : "Filters"}
                  >
                    <ListFilterIcon data-icon="inline-start" />
                    <span className="hidden sm:inline">Filters</span>
                    {filterCount > 0 && <span className="tabular-nums">{filterCount}</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-[min(360px,calc(100vw-2rem))] p-4">
                  <div className="flex flex-col gap-4">
                    <div>
                      <p className="text-sm font-semibold">Filters</p>
                      <p className="mt-1 text-xs text-muted-foreground">Narrow the files shown in this workspace.</p>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="brand-asset-search-scope">Search scope</Label>
                      <Select value={scope} onValueChange={(value) => setScope(value as "folder" | "all")}>
                        <SelectTrigger id="brand-asset-search-scope" className="h-10" aria-label="Search scope"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="folder">This folder</SelectItem>
                          <SelectItem value="all">All folders</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="brand-asset-kind-filter">File kind</Label>
                      <Select value={kindFilter} onValueChange={(value) => setKindFilter(value as "ALL" | ResourceAssetKind)}>
                        <SelectTrigger id="brand-asset-kind-filter" className="h-10" aria-label="Filter by file kind"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ALL">All file kinds</SelectItem>
                          {RESOURCE_ASSET_KIND_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <label className="flex min-h-10 items-center justify-between gap-3 rounded-md border border-border/70 px-3 text-sm">
                      <span className="flex items-center gap-2"><StarIcon className={cn(favoriteOnly && "fill-[var(--yellow-text)] text-[var(--yellow-text)]")} aria-hidden="true" /> Favorites only</span>
                      <input
                        type="checkbox"
                        checked={favoriteOnly}
                        onChange={(event) => { setFavoriteOnly(event.target.checked); if (event.target.checked) setScope("all"); }}
                        className="size-4 accent-[var(--wi-red)]"
                        aria-label="Show favorites only"
                      />
                    </label>
                    {hasAppliedFilters && (
                      <Button type="button" variant="ghost" className="h-10 justify-start px-2" onClick={clearDiscoveryFilters}>
                        Clear filters
                      </Button>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
              {hasAppliedFilters && (
                <Button type="button" variant="ghost" className="hidden h-10 px-2 lg:inline-flex" onClick={clearDiscoveryFilters}>
                  Clear
                </Button>
              )}
            </div>
          </div>

          {showFolders && (
            <section className="flex flex-col gap-3" aria-labelledby="brand-asset-folder-heading">
              <div className="flex items-center gap-2">
                <ChevronDownIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                <h2 id="brand-asset-folder-heading" className="text-sm font-semibold tracking-tight">{folderId ? "Folders" : "Suggested folders"}</h2>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {libraryData.folders.map((folder) => (
                  <FolderCard key={folder.id} folder={folder} onOpen={() => goToFolder(folder.id)} />
                ))}
              </div>
            </section>
          )}

          <section className="flex flex-col gap-3" aria-labelledby="brand-asset-file-heading">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-baseline gap-2">
                <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <h2 id="brand-asset-file-heading" className="text-sm font-semibold tracking-tight">{fileHeading}</h2>
                <span className="text-xs text-muted-foreground">{fileCountLabel}</span>
              </div>
              {library.refreshing && <RefreshCwIcon className="size-4 animate-spin text-muted-foreground" aria-label="Refreshing files" />}
            </div>
            {displayAssets.length === 0 ? (
              <Card elevation="flat" className="border-border/80">
                <CardContent className="p-0">
                  <EmptyState
                    inline
                    icon={libraryView === "home" && !hasDiscoveryFilters ? "folder" : "search"}
                    title={emptyTitle}
                    description={libraryView === "recent" ? "Files you open will appear here on this device." : libraryView === "starred" ? "Star a file to keep it close at hand." : hasDiscoveryFilters ? "Try a different name, folder scope, kind, or favorite filter." : canManage ? "Upload the first brand file here, or open a neighboring folder." : "Files will appear here when the team adds them."}
                    actionLabel={canManage && libraryView === "home" && !hasDiscoveryFilters ? "Upload file" : undefined}
                    onAction={canManage && libraryView === "home" && !hasDiscoveryFilters ? () => startUpload() : undefined}
                  />
                </CardContent>
              </Card>
            ) : (
              <div className="overflow-hidden rounded-md border border-border/80 bg-card">
                <Table>
                  <TableHeader sticky={false}>
                    <TableRow striped={false} className="bg-muted/30 hover:bg-muted/30">
                      <SortableHead label="Name" sortKey="name" activeSort={sort} className="w-[52%]" onSort={setSort} />
                      <SortableHead label="Type" sortKey="type" activeSort={sort} className="hidden md:table-cell" onSort={setSort} />
                      <SortableHead label="Last modified" sortKey="updated" activeSort={sort} className="hidden lg:table-cell" onSort={setSort} />
                      <TableHead className="hidden sm:table-cell">Version</TableHead>
                      <TableHead className="w-px"><span className="sr-only">Actions</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayAssets.map((asset) => (
                      <AssetRow
                        key={asset.id}
                        asset={asset}
                        canManage={canManage}
                        favorite={isFavorite(asset)}
                        showLocation={showingGlobalResults}
                        onHistory={() => openHistory(asset)}
                        onPreview={() => openPreview(asset)}
                        onReplace={() => { setPendingFiles([]); setReplaceAsset(asset); setUploadDialogOpen(true); }}
                        onToggleFavorite={() => void toggleFavorite(asset)}
                        onCopyLink={() => void copyAssetLink(asset)}
                        onUse={() => rememberRecent(asset)}
                      />
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>
        </div>
      </div>

      <NewFolderDialog open={folderDialogOpen} parentId={libraryData.folder.id} onOpenChange={setFolderDialogOpen} onCreated={reload} />
      <UploadAssetDialog
        open={uploadDialogOpen}
        folderId={libraryData.folder.id}
        asset={replaceAsset}
        initialFiles={pendingFiles}
        onOpenChange={(open) => {
          setUploadDialogOpen(open);
          if (!open) {
            setReplaceAsset(null);
            setPendingFiles((current) => (current.length > 0 ? [] : current));
          }
        }}
        onCompleted={reload}
      />
      <AssetPreviewDialog
        open={Boolean(previewAsset)}
        asset={previewAsset}
        onOpenChange={(open) => { if (!open) closeLinkedAsset(); }}
        onHistory={() => { if (previewAsset) openHistory(previewAsset); }}
        onCopyLink={() => { if (previewAsset) void copyAssetLink(previewAsset); }}
      />
      <VersionHistoryDialog
        open={Boolean(historyAsset)}
        asset={historyAsset}
        canManage={canManage}
        onRestored={reload}
        onOpenChange={(open) => { if (!open) { setHistoryAsset(null); if (linkedAssetId) closeLinkedAsset(); } }}
      />
    </div>
  );
}
