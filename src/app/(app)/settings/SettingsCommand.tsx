"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SearchIcon } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import {
  SETTINGS_GROUP_ORDER,
  type SettingsSection,
} from "@/lib/nav-sections";
import { Button } from "@/components/ui/button";
import { settingsSectionIcon } from "./_components/settings-meta";

/**
 * ⌘K / Ctrl+K palette over the visible settings sections. Receives only the
 * sections the user is allowed to see, so search results match nav.
 */
export function SettingsCommand({ visibleSections }: { visibleSections: ReadonlyArray<SettingsSection> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isCmdK = (e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey);
      const isSlash = e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey;
      // Ignore "/" while typing in inputs/textareas/contenteditable.
      const target = e.target as HTMLElement | null;
      const inField = !!target && (
        target.tagName === "INPUT"
          || target.tagName === "TEXTAREA"
          || target.isContentEditable
      );
      if (isCmdK || (isSlash && !inField)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        setOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  const grouped = SETTINGS_GROUP_ORDER.map((group) => ({
    group,
    sections: visibleSections.filter((s) => s.group === group),
  })).filter((g) => g.sections.length > 0);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="size-10 text-muted-foreground sm:w-auto sm:px-3"
        aria-label="Search settings"
      >
        <SearchIcon data-icon="inline-start" />
        <span className="hidden sm:inline">Search settings</span>
        <kbd className="ml-2 hidden md:inline-flex items-center gap-0.5 rounded border bg-muted px-1.5 py-0.5 text-[10px] font-mono">
          ⌘K
        </kbd>
      </Button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Search settings — try 'allowlist', 'kiosk', 'home venue'…" />
        <CommandList>
          <CommandEmpty>No matching settings page.</CommandEmpty>
          <CommandGroup heading="Settings">
            <CommandItem
              value="overview control map settings home"
              onSelect={() => go("/settings")}
              className="min-h-11 transition-[background-color,color]"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="font-medium">Overview</span>
                <span className="truncate text-xs text-muted-foreground">Browse every settings area available to you.</span>
              </div>
            </CommandItem>
          </CommandGroup>
          {grouped.map(({ group, sections }) => (
            <CommandGroup key={group} heading={group}>
              {sections.map((s) => {
                const Icon = settingsSectionIcon(s.href);
                return (
                  <CommandItem
                    key={s.href}
                    value={`${s.label} ${s.description} ${(s.keywords ?? []).join(" ")}`}
                    onSelect={() => go(s.href)}
                    className="min-h-11 transition-[background-color,color]"
                  >
                    <Icon className="size-4 shrink-0 text-muted-foreground" />
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="font-medium">{s.label}</span>
                      <span className="truncate text-xs text-muted-foreground">{s.description}</span>
                    </div>
                    <CommandShortcut>{s.href.replace("/settings/", "")}</CommandShortcut>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandDialog>
    </>
  );
}
