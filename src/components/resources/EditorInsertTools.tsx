"use client";

import { insertMarkdown$, usePublisher } from "@mdxeditor/editor";
import {
  AlertCircle,
  ChevronDown,
  Copy,
  Info,
  Keyboard,
  Lightbulb,
  MessageSquareWarning,
  OctagonAlert,
  TriangleAlert,
  Video,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  buildCalloutSnippet,
  buildCopySnippet,
  buildEmbedSnippet,
  CALLOUT_LABELS,
  CALLOUT_TYPES,
  type CalloutType,
} from "@/lib/editor-snippets";
import { parseEmbed } from "@/lib/media-embed";

const CALLOUT_ICONS: Record<CalloutType, typeof Info> = {
  NOTE: Info,
  TIP: Lightbulb,
  SHORTCUT: Keyboard,
  IMPORTANT: MessageSquareWarning,
  WARNING: TriangleAlert,
  CAUTION: OctagonAlert,
};

/**
 * Toolbar affordances for the guide editor: insert callout templates and
 * validated video embeds at the cursor. Must render inside MDXEditor's
 * toolbarPlugin so usePublisher can reach the editor realm.
 */
export function InsertCalloutMenu() {
  const insertMarkdown = usePublisher(insertMarkdown$);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" className="h-10 gap-1 px-2" title="Insert callout">
          <AlertCircle className="size-4" />
          Callout
          <ChevronDown className="size-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {CALLOUT_TYPES.map((type) => {
          const Icon = CALLOUT_ICONS[type];
          return (
            <DropdownMenuItem key={type} onSelect={() => insertMarkdown(buildCalloutSnippet(type))}>
              <Icon className="size-4" />
              {CALLOUT_LABELS[type]}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function InsertVideoEmbedButton() {
  const insertMarkdown = usePublisher(insertMarkdown$);
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setUrl("");
      setError(null);
    }
  };

  const handleInsert = () => {
    if (!parseEmbed(url)) {
      setError("Enter a valid YouTube or Vimeo video URL.");
      return;
    }
    insertMarkdown(buildEmbedSnippet(url));
    handleOpenChange(false);
  };

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        className="h-10 gap-1 px-2"
        title="Insert video embed"
        onClick={() => setOpen(true)}
      >
        <Video className="size-4" />
        Video
      </Button>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Insert video embed</DialogTitle>
            <DialogDescription>
              Paste a YouTube or Vimeo link. The guide reader turns it into a safe embedded player.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="embed-url">Video URL</Label>
            <Input
              id="embed-url"
              placeholder="https://www.youtube.com/watch?v=..."
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleInsert();
                }
              }}
              autoFocus
            />
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={handleInsert} disabled={!url.trim()}>
              Insert
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function InsertCopySnippetButton() {
  const insertMarkdown = usePublisher(insertMarkdown$);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setValue("");
  };

  const handleInsert = () => {
    const next = value.trim();
    if (!next) return;
    insertMarkdown(buildCopySnippet(next));
    handleOpenChange(false);
  };

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        className="h-10 gap-1 px-2"
        title="Insert copyable path or string"
        onClick={() => setOpen(true)}
      >
        <Copy className="size-4" />
        Copyable
      </Button>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Insert copyable string</DialogTitle>
            <DialogDescription>
              Paste a server path, rename string, or other value people should copy in one tap.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="copy-snippet">Path or string</Label>
            <Input
              id="copy-snippet"
              placeholder="smb://server/share"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleInsert();
                }
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={handleInsert} disabled={!value.trim()}>
              Insert
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
