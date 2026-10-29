"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeftIcon,
  BookOpenIcon,
  Building2Icon,
  ClipboardListIcon,
  FolderTreeIcon,
  HardDriveIcon,
  PhoneIcon,
  WrenchIcon,
} from "lucide-react";
import Link from "next/link";
import type { ComponentType } from "react";
import type { MDXEditorMethods } from "@mdxeditor/editor";
import { ResourceType, Role, ShiftArea } from "@/lib/client-enums";
import { Button } from "@/components/ui/button";
import { useFetch } from "@/hooks/use-fetch";
import type { GuideListItem } from "@/lib/guides";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import {
  defaultCategoryForResourceType,
  GUIDE_CATEGORY_SUGGESTIONS,
} from "@/lib/guide-categories";
import { GuideEditorLayout } from "@/components/resources/GuideEditorLayout";
import { GuideSettingsPanel } from "@/components/resources/GuideSettingsPanel";
import { MarkdownEditor } from "@/components/resources/MarkdownEditor";
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

type GuideTemplate = {
  id: string;
  label: string;
  type: ResourceType;
  category: string;
  title: string;
  icon: ComponentType<{ className?: string }>;
  markdown: string;
};

type ResourceMutationResponse = {
  data?: {
    slug?: string;
  };
};

type ResourceUploadResponse = {
  url?: string;
};

const GUIDE_TEMPLATES: GuideTemplate[] = [
  {
    id: "contacts",
    label: "Contacts",
    type: ResourceType.CONTACTS,
    category: "Contacts",
    title: "Key contacts",
    icon: PhoneIcon,
    markdown: `# Key contacts

Use this Guide for phone numbers, escalation contacts, vendor contacts, and internal owners.

> [!IMPORTANT]
> Keep this current. Put the owner in the table so people know who can fix stale contact details.

## Emergency

| Contact | Role | Phone | When to use |
| --- | --- | --- | --- |
| Name | Role or team | \`555-555-5555\` | What situation triggers this contact |

## Internal

| Contact | Role | Phone | Email |
| --- | --- | --- | --- |
| Name | Owner or team | \`555-555-5555\` | name@wisc.edu |

## External

- Vendor: contact, phone, account/reference
- Account number or service tag:

\`\`\`text
ACCOUNT-OR-REFERENCE
\`\`\`

## Owner

| Field | Value |
| --- | --- |
| Maintainer | Name/team |
| Last verified | YYYY-MM-DD |`,
  },
  {
    id: "building-numbers",
    label: "Building Numbers",
    type: ResourceType.BUILDING_NUMBERS,
    category: "Building Numbers",
    title: "Building numbers",
    icon: Building2Icon,
    markdown: `# Building numbers

Use this Guide for building phone numbers, room numbers, elevator or dock notes, and location-specific reference details.

> [!WARNING]
> Keep access-sensitive details limited to what staff and students are allowed to use.

## Quick lookup

| Building or location | Number or code | Use | Notes |
| --- | --- | --- | --- |
| Building name | \`0000\` | Room, phone, dock, elevator, or desk | Who should use it |

## Copyable reference

\`\`\`text
BUILDING OR LOCATION - 0000 - purpose
\`\`\`

## Location notes

- Entrance:
- Loading dock:
- Elevator or room:
- After-hours process:

## Owner

| Field | Value |
| --- | --- |
| Maintainer | Name/team |
| Last verified | YYYY-MM-DD |`,
  },
  {
    id: "media-drive",
    label: "Media Drive",
    type: ResourceType.MEDIA_DRIVE,
    category: "Media Drive",
    title: "Media Drive overview",
    icon: HardDriveIcon,
    markdown: `Use this Guide as the map for the Media Drive, the server that houses Creative files.

> [!IMPORTANT]
> Connect to the UW network or VPN before you try to mount the drive.

## What lives here

| Area | What belongs here | Owner | Notes |
| --- | --- | --- | --- |
| Photo | RAW, selects, exports, delivery folders | Team/person | Rules or exceptions |
| Video | Project files, footage, exports, delivery folders | Team/person | Rules or exceptions |
| Graphics | Templates, working files, final assets | Team/person | Rules or exceptions |

## Root paths

\`\`\`copy
smb://ath01-nas.uwia.wisc.edu/users/
\`\`\`

## Folder map

| Folder | Purpose | Who uses it | Retention or cleanup rule |
| --- | --- | --- | --- |
| \`/PHOTO\` | Photo jobs and delivery | Photo staff/students | Cleanup rule |
| \`/VIDEO\` | Video projects and exports | Video staff/students | Cleanup rule |
| \`/GRAPHICS\` | Graphics source and final files | Graphics staff/students | Cleanup rule |

## Access

> [!NOTE]
> Include how to request access, VPN or building-network requirements, and who approves access changes.

> [!SHORTCUT]
> \`⌘K\` — Finder’s Connect to Server window.

## Related exact paths

- Link or reference separate Server Paths guides for recurring workflow-specific folders.

## Owner

| Field | Value |
| --- | --- |
| Maintainer | Name/team |
| Last verified | YYYY-MM-DD |`,
  },
  {
    id: "server-paths",
    label: "Server Paths",
    type: ResourceType.SERVER_PATHS,
    category: "Server Paths",
    title: "Server paths",
    icon: FolderTreeIcon,
    markdown: `# Server paths

Keep paths copyable and include who can access each location.

## Common paths

| Path | Purpose | Access | Owner |
| --- | --- | --- | --- |
| \`smb://server/share/folder\` | What lives here | Who can use it | Team/person |

## Copyable examples

\`\`\`text
smb://server/share/folder
\`\`\`

## Access notes

> [!NOTE]
> Include who approves access, where requests should go, and any VPN or building-network requirements.

## Naming rules

- Folder/file pattern: \`SPORT-YYYYMMDD-OPP-PHOTOGRAPHER-###\`
- Keep raw, selects, exports, and delivery folders visually distinct.

## Owner

| Field | Value |
| --- | --- |
| Maintainer | Name/team |
| Last verified | YYYY-MM-DD |`,
  },
  {
    id: "sop",
    label: "SOP",
    type: ResourceType.SOP,
    category: "SOPs",
    title: "Standard operating procedure",
    icon: ClipboardListIcon,
    markdown: `# Standard operating procedure

## When to use this

Describe the trigger or workflow this SOP covers.

> [!IMPORTANT]
> Do not skip the checks below. Later steps depend on the right access and source files.

## Before you start

| Check | Required value |
| --- | --- |
| Access | Account, drive, venue, credential, or tool |
| Source material | Where the starting files or request live |
| Deadline | When this must be complete |

## Steps

1. First step
2. Second step
3. Final handoff or confirmation step

> [!TIP]
> Share a faster way or a useful default that is not required to finish.

> [!SHORTCUT]
> \`⌘S\` — Save before you hand off.

## Copyable values

\`\`\`text
Paste any path, naming string, command, or metadata template here
\`\`\`

## Checks

- What must be true before the work is done
- What should be reviewed by another person
- Where completion should be noted

## Owner

| Field | Value |
| --- | --- |
| Maintainer | Name/team |
| Last reviewed | YYYY-MM-DD |`,
  },
  {
    id: "troubleshooting",
    label: "Troubleshooting",
    type: ResourceType.TROUBLESHOOTING,
    category: "Troubleshooting",
    title: "Troubleshooting note",
    icon: WrenchIcon,
    markdown: `# Troubleshooting note

## Symptom

What people see or report.

## Likely causes

| Cause | Evidence | First check |
| --- | --- | --- |
| Possible cause | What confirms it | Where to look first |

## Fix

1. Action to try first
2. Action to try next
3. Confirm the problem is resolved

## Useful references

\`\`\`text
Paste error text, server path, command, or reference value here
\`\`\`

> [!WARNING]
> Note anything risky before someone repeats this fix.

> [!CAUTION]
> Stop here if the next step can damage gear, files, or a live deliverable.

## Escalate when

- Condition: owner
- Condition: vendor/contact

## Owner

| Field | Value |
| --- | --- |
| Maintainer | Name/team |
| Last verified | YYYY-MM-DD |`,
  },
  {
    id: "how-to",
    label: "How-to",
    type: ResourceType.HOW_TO,
    category: "How-To",
    title: "How-to",
    icon: BookOpenIcon,
    markdown: `Write this as a sequence someone can follow without guessing. Put the required setup first, then numbered steps, then the exceptions.

> [!IMPORTANT]
> What must already be true before step 1 — network, account, software, or files.

## Before you start

- Tool or app:
- Files or path:
- Time this usually takes:

## Steps

1. First action, written as a verb.

![Screenshot of the control you just used](https://example.com/step-1.png)

2. Next action. Mention the exact menu, button, or field.
3. Confirm it worked.

\`\`\`copy
smb://server/share
\`\`\`

> [!SHORTCUT]
> \`⌘K\` — Faster way to open the same window.
> \`⇧⌘G\` — Go to Folder

> [!TIP]
> A useful default or habit that is not required.

> [!WARNING]
> The most likely way this goes wrong, and how to recover.

## Done when

- Visible result:
- Where the file or handoff lives:
`,
  },
];

export function NewGuideClient() {
  const router = useRouter();
  const editorRef = useRef<MDXEditorMethods>(null);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<ResourceType>(ResourceType.GENERAL);
  const [category, setCategory] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [targetRoles, setTargetRoles] = useState<Role[]>([]);
  const [targetAreas, setTargetAreas] = useState<ShiftArea[]>([]);
  const [featured, setFeatured] = useState(false);
  const [featuredRank, setFeaturedRank] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const dirty = Boolean(
    title.trim() || category.trim() || markdown.trim() || targetRoles.length || targetAreas.length || featured,
  );

  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (dirty) event.preventDefault();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

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

  const { data: guides } = useFetch<GuideListItem[]>({
    url: "/api/resources",
    transform: (json) => (json as { data: GuideListItem[] }).data ?? [],
  });

  const existingCategories = useMemo(() => {
    const seen = new Set<string>(GUIDE_CATEGORY_SUGGESTIONS);
    for (const g of guides ?? []) seen.add(g.category);
    return [...seen].sort();
  }, [guides]);

  function applyTemplate(template: GuideTemplate) {
    if (!title.trim()) setTitle(template.title);
    setType(template.type);
    setCategory(template.category);
    setMarkdown(template.markdown);
    editorRef.current?.setMarkdown(template.markdown);
  }

  function updateType(nextType: ResourceType) {
    setCategory((current) => {
      const currentDefault = defaultCategoryForResourceType(type);
      if (!current.trim() || current === currentDefault) return defaultCategoryForResourceType(nextType);
      return current;
    });
    setType(nextType);
  }

  async function submit(published: boolean) {
    if (submittingRef.current) return;
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }
    if (!category.trim()) {
      toast.error("Category is required");
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const res = await fetch("/api/resources", {
        method: "POST",
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
        }),
      });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) {
        toast.error(await parseErrorMessage(res, "Failed to create guide"));
        return;
      }
      const json = await parseJsonSafely<ResourceMutationResponse>(res);
      if (!json?.data?.slug) {
        toast.error("Guide was created, but the response was incomplete. Refresh Resources and try again.");
        return;
      }
      toast.success(published ? "Guide published" : "Draft saved");
      router.push(`/resources/${json.data.slug}`);
    } catch {
      toast.error("Network error. Try again.");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  const backLabel = (
    <>
      <ArrowLeftIcon data-icon="inline-start" />
      Resources
    </>
  );

  return (
    <GuideEditorLayout
      back={dirty ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="sm" className="h-10 px-2">
              {backLabel}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Discard this new guide?</AlertDialogTitle>
              <AlertDialogDescription>
                The title, settings, and guide content entered here have not been saved.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep editing</AlertDialogCancel>
              <AlertDialogAction onClick={() => router.push("/resources")}>Discard guide</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : (
        <Button asChild variant="ghost" size="sm" className="h-10 px-2">
          <Link href="/resources">{backLabel}</Link>
        </Button>
      )}
      status={dirty ? "New guide · not saved yet" : "New guide"}
      actions={(
        <>
          <Button
            onClick={() => submit(false)}
            variant="outline"
            className="h-10"
            disabled={submitting}
            loading={submitting}
          >
            Save draft
          </Button>
          <Button className="h-10" onClick={() => submit(true)} disabled={submitting} loading={submitting}>
            Publish
          </Button>
        </>
      )}
      title={title}
      onTitleChange={setTitle}
      disabled={submitting}
      beforeEditor={!markdown.trim() ? (
        <div className="flex flex-col gap-2.5">
          <p className="text-sm text-muted-foreground">Start from a template, or just start writing below.</p>
          <div className="flex flex-wrap gap-2">
            {GUIDE_TEMPLATES.map((template) => {
              const Icon = template.icon;
              return (
                <button
                  key={template.id}
                  type="button"
                  className="guide-chip transition-[background-color,color,scale] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.96]"
                  onClick={() => applyTemplate(template)}
                  disabled={submitting}
                >
                  <Icon className="size-3.5" aria-hidden="true" />
                  {template.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      editor={(
        <MarkdownEditor
          ref={editorRef}
          markdown={markdown}
          onChange={(value, initialMarkdownNormalize) => {
            if (!initialMarkdownNormalize) setMarkdown(value);
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
          categorySuggestions={existingCategories}
          featured={featured}
          featuredRank={featuredRank}
          targetRoles={targetRoles}
          targetAreas={targetAreas}
          disabled={submitting}
          onTypeChange={updateType}
          onCategoryChange={setCategory}
          onFeaturedChange={setFeatured}
          onFeaturedRankChange={setFeaturedRank}
          onTargetRolesChange={setTargetRoles}
          onTargetAreasChange={setTargetAreas}
        />
      )}
    />
  );
}
