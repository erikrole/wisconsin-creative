"use client";

import { Reorder, useDragControls } from "motion/react";
import { ChevronDownIcon, ChevronUpIcon, GripVerticalIcon, PinOffIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export type CustomizableNavItem = { label: string; href: string; icon: React.ElementType };
export type CustomizableNavGroup = { label?: string; items: CustomizableNavItem[] };

type SidebarCustomizeDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: CustomizableNavGroup[];
  pinnedHrefs: string[];
  onPinnedChange: (hrefs: string[]) => void;
  className?: string;
};

/**
 * Pin pages to the top of the sidebar and set their order. Replaces per-row pin stars so the
 * rail stays quiet; dragging uses a handle, and the arrow buttons give the same control by keyboard.
 */
export function SidebarCustomizeDialog({
  open,
  onOpenChange,
  groups,
  pinnedHrefs,
  onPinnedChange,
  className,
}: SidebarCustomizeDialogProps) {
  const allItems = groups.flatMap((group) => group.items);
  const pinnedItems = pinnedHrefs
    .map((href) => allItems.find((item) => item.href === href))
    .filter((item): item is CustomizableNavItem => Boolean(item));

  function togglePinned(href: string, pinned: boolean) {
    const current = pinnedItems.map((item) => item.href);
    onPinnedChange(pinned ? [...current, href] : current.filter((h) => h !== href));
  }

  function move(index: number, delta: number) {
    const next = pinnedItems.map((item) => item.href);
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    const [moved] = next.splice(index, 1);
    if (moved) next.splice(target, 0, moved);
    onPinnedChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn("max-h-[min(720px,90dvh)] gap-0 bg-card p-0 sm:max-w-md", className)}
        // Opening on a focused arrow button reads as a selection; focus the dialog itself instead.
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <DialogHeader className="flex-col items-start gap-1 border-b border-border px-5 pb-4 pr-12 pt-5 text-left">
          <DialogTitle className="text-[17px] font-black tracking-[-0.01em]">Customize sidebar</DialogTitle>
          <DialogDescription className="text-[13.5px]">
            Pin the pages you use most. They sit at the top of the sidebar, in the order you set here.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="min-h-0 overflow-y-auto px-5 py-4">
          <section aria-labelledby="sidebar-pinned-heading">
            <h3 id="sidebar-pinned-heading" className="mb-2 text-[12px]! font-bold! tracking-normal! text-muted-foreground">
              Pinned
            </h3>
            {pinnedItems.length === 0 ? (
              <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-[13px] text-muted-foreground">
                Nothing pinned yet. Turn on a page below to pin it.
              </p>
            ) : (
              <Reorder.Group
                as="ol"
                axis="y"
                values={pinnedItems.map((item) => item.href)}
                onReorder={onPinnedChange}
                className="flex flex-col gap-1"
              >
                {pinnedItems.map((item, index) => (
                  <PinnedRow
                    key={item.href}
                    item={item}
                    isFirst={index === 0}
                    isLast={index === pinnedItems.length - 1}
                    onMove={(delta) => move(index, delta)}
                    onUnpin={() => togglePinned(item.href, false)}
                  />
                ))}
              </Reorder.Group>
            )}
          </section>

          <section aria-labelledby="sidebar-all-heading" className="mt-5">
            <h3 id="sidebar-all-heading" className="mb-1 text-[12px]! font-bold! tracking-normal! text-muted-foreground">
              All pages
            </h3>
            {groups.map((group) => (
              <div key={group.label ?? group.items[0]?.href} className="mt-2 first:mt-0">
                {group.label && <p className="px-1 py-1 text-[12px] text-muted-foreground">{group.label}</p>}
                <ul className="flex flex-col">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const pinned = pinnedHrefs.includes(item.href);
                    const switchId = `pin-${item.href.replace(/\W+/g, "-")}`;
                    return (
                      <li key={item.href}>
                        <label
                          htmlFor={switchId}
                          className="flex h-10 cursor-pointer items-center gap-2.5 rounded-md px-1 text-[14px] hover:bg-muted/60"
                        >
                          <Icon className="size-4 shrink-0 stroke-[1.75] text-muted-foreground" aria-hidden="true" />
                          <span className="flex-1 truncate">{item.label}</span>
                          <Switch
                            id={switchId}
                            checked={pinned}
                            onCheckedChange={(checked) => togglePinned(item.href, checked)}
                            aria-label={`Pin ${item.label}`}
                            className="data-[state=checked]:bg-[var(--sidebar-icon-active)]"
                          />
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </section>
        </DialogBody>

        <DialogFooter className="border-t border-border px-5 py-3">
          <Button
            type="button"
            variant="ghost"
            disabled={pinnedItems.length === 0}
            onClick={() => onPinnedChange([])}
          >
            Unpin all
          </Button>
          <Button type="button" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PinnedRow({
  item,
  isFirst,
  isLast,
  onMove,
  onUnpin,
}: {
  item: CustomizableNavItem;
  isFirst: boolean;
  isLast: boolean;
  onMove: (delta: number) => void;
  onUnpin: () => void;
}) {
  const controls = useDragControls();
  const Icon = item.icon;
  return (
    <Reorder.Item
      value={item.href}
      dragListener={false}
      dragControls={controls}
      className="flex h-10 select-none items-center gap-1.5 rounded-md border border-border bg-background pl-1 pr-1 text-[14px]"
    >
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onPointerDown={(event) => controls.start(event)}
        className="flex h-8 w-6 cursor-grab touch-none items-center justify-center text-muted-foreground active:cursor-grabbing"
      >
        <GripVerticalIcon className="size-4" />
      </button>
      <Icon className="size-4 shrink-0 stroke-[1.75] text-muted-foreground" aria-hidden="true" />
      <span className="ml-1 flex-1 truncate">{item.label}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 text-muted-foreground"
        disabled={isFirst}
        onClick={() => onMove(-1)}
        aria-label={`Move ${item.label} up`}
      >
        <ChevronUpIcon />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 text-muted-foreground"
        disabled={isLast}
        onClick={() => onMove(1)}
        aria-label={`Move ${item.label} down`}
      >
        <ChevronDownIcon />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 text-muted-foreground"
        onClick={onUnpin}
        aria-label={`Unpin ${item.label}`}
      >
        <PinOffIcon />
      </Button>
    </Reorder.Item>
  );
}
