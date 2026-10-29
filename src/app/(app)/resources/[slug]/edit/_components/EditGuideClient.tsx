"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
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
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/lib/toast";
import { useFetch } from "@/hooks/use-fetch";
import { ResourceType, Role, ShiftArea } from "@/lib/client-enums";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import {
  defaultCategoryForResourceType,
  GUIDE_CATEGORY_SUGGESTIONS,
} from "@/lib/guide-categories";
import { legacyGuideMarkdown } from "@/lib/guide-content";
import { GuideEditorLayout } from "@/components/resources/GuideEditorLayout";
import { GuideSettingsPanel } from "@/components/resources/GuideSettingsPanel";
import { MarkdownEditor } from "@/components/resources/MarkdownEditor";
import EmptyState from "@/components/EmptyState";
import { useAdjustState } from "@/hooks/use-synced-draft";

type Guide = {
  id: string;
  title: string;
  slug: string;
  type: ResourceType;
  category: string;
  markdown: string | null;
  targetRoles: Role[];
  targetAreas: ShiftArea[];
  featured: boolean;
  featuredRank: number | null;
  published: boolean;
  content: unknown;
  author: { id: string; name: string };
  updatedAt: string;
};

type Props = { slug: string; userRole: Role; userId: string };

type ResourceMutationResponse = {
  data?: {
    slug?: string;
  };
};

type ResourceUploadResponse = {
  url?: string;
};

export function EditGuideClient({ slug, userRole, userId }: Props) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<ResourceType>(ResourceType.GENERAL);
  const [category, setCategory] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [targetRoles, setTargetRoles] = useState<Role[]>([]);
  const [targetAreas, setTargetAreas] = useState<ShiftArea[]>([]);
  const [featured, setFeatured] = useState(false);
  const [featuredRank, setFeaturedRank] = useState<number | null>(null);
  const [published, setPublished] = useState(false);
  const [guideId, setGuideId] = useState("");
  const [loadedUpdatedAt, setLoadedUpdatedAt] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const submittingRef = useRef(false);
  const deletingRef = useRef(false);

  async function uploadFile(file: File): Promise<string> {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/resources/upload-image", { method: "POST", body: fd });
    if (handleAuthRedirect(res)) throw new Error("Session expired");
    if (!res.ok) throw new Error(await parseErrorMessage(res, "Image upload failed"));
    const json = await parseJsonSafely<ResourceUploadResponse>(res);
    if (!json?.url) throw new Error("Upload succeeded but no image URL was returned");
    return json.url;
  }

  const { data: guide, loading, error, reload } = useFetch<Guide>({
    url: `/api/resources/${slug}`,
    transform: (json) => (json as { data: Guide }).data,
  });

  const populate = useCallback(
    (g: Guide) => {
      setTitle(g.title);
      setType(g.type ?? ResourceType.GENERAL);
      setCategory(g.category);
      setMarkdown(legacyGuideMarkdown(g.markdown, g.content));
      setTargetRoles(g.targetRoles ?? []);
      setTargetAreas(g.targetAreas ?? []);
      setFeatured(g.featured ?? false);
      setFeaturedRank(g.featuredRank ?? null);
      setPublished(g.published);
      setGuideId(g.id);
      setLoadedUpdatedAt(typeof g.updatedAt === "string" ? g.updatedAt : new Date(g.updatedAt).toISOString());
      setReady(true);
    },
    [],
  );

  useAdjustState([guide, ready, populate], () => {
    if (guide && !ready) populate(guide);
  });

  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (dirty) e.preventDefault();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const canDelete = userRole === Role.ADMIN;
  const canEditGuide = userRole === Role.ADMIN || guide?.author.id === userId;
  const categorySuggestions = useMemo(() => [...GUIDE_CATEGORY_SUGGESTIONS], []);

  function updateType(nextType: ResourceType) {
    setCategory((current) => {
      const currentDefault = defaultCategoryForResourceType(type);
      if (!current.trim() || current === currentDefault) return defaultCategoryForResourceType(nextType);
      return current;
    });
    setType(nextType);
    setDirty(true);
  }

  async function submit() {
    if (submittingRef.current) return;
    if (!title.trim()) { toast.error("Title is required"); return; }
    if (!category.trim()) { toast.error("Category is required"); return; }
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/resources/${guideId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          type,
          category: category.trim(),
          markdown,
          targetRoles,
          targetAreas,
          featured,
          featuredRank: featured ? featuredRank : null,
          published,
          expectedUpdatedAt: loadedUpdatedAt || undefined,
        }),
      });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) {
        toast.error(await parseErrorMessage(res, "Failed to save guide"));
        return;
      }
      const json = await parseJsonSafely<ResourceMutationResponse>(res);
      if (!json?.data?.slug) {
        toast.error("Guide was saved, but the response was incomplete. Refresh Resources and try again.");
        return;
      }
      setDirty(false);
      toast.success("Guide saved");
      router.push(`/resources/${json.data.slug}`);
    } catch {
      toast.error("Network error. Try again.");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (deletingRef.current) return;
    deletingRef.current = true;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/resources/${guideId}`, { method: "DELETE" });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) {
        toast.error(await parseErrorMessage(res, "Failed to delete guide"));
        return;
      }
      toast.success("Guide deleted");
      router.push("/resources");
    } catch {
      toast.error("Network error. Try again.");
    } finally {
      deletingRef.current = false;
      setSubmitting(false);
    }
  }

  if (!loading && error && !guide) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
        <EmptyState
          icon="wifi-off"
          title="Could not load this guide"
          description="The editor did not open. Retry before making changes."
          actionLabel="Retry"
          onAction={reload}
        />
      </div>
    );
  }

  if (!loading && guide && !canEditGuide) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
        <EmptyState
          icon="folder"
          title="You cannot edit this guide"
          description="Staff can edit their own guides. Ask an administrator or the guide author to make this change."
          actionLabel="Back to guide"
          onAction={() => router.push(`/resources/${slug}`)}
        />
      </div>
    );
  }

  if (loading || !ready) {
    return (
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 px-4 py-6 sm:px-6 lg:px-10">
        <Skeleton className="h-10 w-full" />
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="flex flex-col gap-5">
            <Skeleton className="h-12 w-2/3" />
            <Skeleton className="h-96 w-full rounded-xl" />
          </div>
          <Skeleton className="h-80 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  const discardDialog = (trigger: React.ReactNode) => (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
          <AlertDialogDescription>
            You have unsaved edits. Leaving now will lose them.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep editing</AlertDialogCancel>
          <AlertDialogAction onClick={() => router.push(`/resources/${slug}`)}>
            Discard
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  const backLabel = (
    <>
      <ArrowLeftIcon data-icon="inline-start" />
      Back to guide
    </>
  );

  return (
    <GuideEditorLayout
      back={dirty
        ? discardDialog(<Button variant="ghost" size="sm" className="h-10 px-2">{backLabel}</Button>)
        : (
          <Button asChild variant="ghost" size="sm" className="h-10 px-2">
            <Link href={`/resources/${slug}`}>{backLabel}</Link>
          </Button>
        )}
      status={dirty ? "Unsaved changes" : published ? "Published" : "Draft"}
      actions={(
        <>
          {dirty
            ? discardDialog(<Button variant="outline" className="h-10" disabled={submitting}>Cancel</Button>)
            : (
              <Button variant="outline" className="h-10" asChild disabled={submitting}>
                <Link href={`/resources/${slug}`}>Cancel</Link>
              </Button>
            )}
          <Button className="h-10" onClick={submit} disabled={submitting} loading={submitting}>
            Save changes
          </Button>
        </>
      )}
      title={title}
      onTitleChange={(value) => { setTitle(value); setDirty(true); }}
      disabled={submitting}
      editor={(
        <MarkdownEditor
          markdown={markdown}
          onChange={(value, initialMarkdownNormalize) => {
            if (initialMarkdownNormalize) return;
            setMarkdown(value);
            setDirty(true);
          }}
          imageUploadHandler={uploadFile}
          contentEditableClassName="min-h-[520px] py-5 focus:outline-none"
          className="guide-mdx-editor"
          readOnly={submitting}
        />
      )}
      settings={(
        <GuideSettingsPanel
          type={type}
          category={category}
          categorySuggestions={categorySuggestions}
          featured={featured}
          featuredRank={featuredRank}
          targetRoles={targetRoles}
          targetAreas={targetAreas}
          published={published}
          disabled={submitting}
          onTypeChange={updateType}
          onCategoryChange={(value) => { setCategory(value); setDirty(true); }}
          onFeaturedChange={(value) => { setFeatured(value); setDirty(true); }}
          onFeaturedRankChange={(value) => { setFeaturedRank(value); setDirty(true); }}
          onTargetRolesChange={(value) => { setTargetRoles(value); setDirty(true); }}
          onTargetAreasChange={(value) => { setTargetAreas(value); setDirty(true); }}
          onPublishedChange={(value) => { setPublished(value); setDirty(true); }}
        />
      )}
      footer={canDelete ? (
        <div className="mt-8 border-t border-border pt-6">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button className="h-10" variant="ghost" disabled={submitting}>
                <Trash2Icon data-icon="inline-start" />
                Delete guide
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete guide?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete &ldquo;{title}&rdquo;. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      ) : null}
    />
  );
}
