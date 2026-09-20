"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BookOpenIcon,
  PhoneIcon,
  SearchIcon,
  TrophyIcon,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { buildResourceSearchIndex, selectRecentEntries } from "@/lib/resource-search";
import type { GuideListItem } from "@/lib/guides";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const RECENT_COUNT = 6;

function formatUpdated(value: Date | string) {
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * In-page Quick find over the loaded Resources guides plus jumps to Contacts
 * and Sport assignments. Cmd/Ctrl+K stays with the app-wide search palette.
 */
export function ResourceCommandPalette({
  guides,
  className,
}: {
  guides: GuideListItem[];
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const searchable = useMemo(() => buildResourceSearchIndex(guides), [guides]);
  const recent = useMemo(() => selectRecentEntries(searchable, RECENT_COUNT), [searchable]);

  const isSearching = query.trim().length > 0;
  const visible = isSearching ? searchable : recent;

  function go(href: string) {
    setOpen(false);
    setQuery("");
    router.push(href);
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        className={cn(
          "h-10 min-w-0 justify-start text-muted-foreground transition-[background-color,color,box-shadow,scale] active:scale-[0.96]",
          className,
        )}
        aria-label="Quick find a guide"
      >
        <SearchIcon data-icon="inline-start" />
        <span className="hidden sm:inline">Quick find</span>
      </Button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder="Search guides by title, content, path, or author…"
        />
        <CommandList>
          <CommandEmpty>No guides match that search.</CommandEmpty>

          {visible.length > 0 && (
            <CommandGroup heading={isSearching ? "Guides" : "Recently updated"}>
              {visible.map(({ guide, typeLabel, value }) => (
                <CommandItem
                  key={guide.id}
                  value={value}
                  onSelect={() => go(`/resources/${guide.slug}`)}
                >
                  <BookOpenIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate font-medium">{guide.title}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {typeLabel}
                      {!guide.published && " · Draft"}
                    </span>
                  </div>
                  <CommandShortcut>{formatUpdated(guide.updatedAt)}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          <CommandGroup heading="References">
            <CommandItem
              value="contacts team directory phone slack email"
              onSelect={() => go("/resources?filter=contacts")}
            >
              <PhoneIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="font-medium">Team contacts</span>
            </CommandItem>
            <CommandItem
              value="sport assignments travelers coverage"
              onSelect={() => go("/resources?filter=assignments")}
            >
              <TrophyIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="font-medium">Sport assignments</span>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
