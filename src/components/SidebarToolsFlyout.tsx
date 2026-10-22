"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRightIcon } from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { SidebarMenuButton, useSidebar } from "@/components/ui/sidebar";
import { chromeFont } from "@/lib/chrome-font";
import { cn } from "@/lib/utils";
import { ALL_TOOLS_HREF, type WebTool } from "@/lib/web-tools";

const HOVER_CLOSE_DELAY_MS = 140;

type Props = {
  tools: WebTool[];
  icon: React.ElementType;
  buttonClassName: string;
  iconClassName: string;
  tooltipClassName: string;
};

/**
 * The sidebar's Tools item. A mouse hover opens the list of browser tools beside the rail; Enter, Space, a click or a tap
 * toggle it, so keyboard and touch never depend on hover. Esc closes it and returns focus to the item.
 */
export function SidebarToolsFlyout({ tools, icon: Icon, buttonClassName, iconClassName, tooltipClassName }: Props) {
  const { isMobile, state } = useSidebar();
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A hover-opened list leaves focus where it was; a click or key opens it and moves focus in.
  const openedByHover = useRef(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  useEffect(() => cancelClose, []);

  function openFromHover(event: React.PointerEvent) {
    if (event.pointerType !== "mouse") return;
    cancelClose();
    if (!open) openedByHover.current = true;
    setOpen(true);
  }
  function closeFromHover(event: React.PointerEvent) {
    if (event.pointerType !== "mouse") return;
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), HOVER_CLOSE_DELAY_MS);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div onPointerEnter={openFromHover} onPointerLeave={closeFromHover}>
          <SidebarMenuButton
            ref={buttonRef}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={open}
            tooltip={open ? undefined : { children: "Tools", className: tooltipClassName }}
            isActive={false}
            className={buttonClassName}
            onClick={() => {
              cancelClose();
              openedByHover.current = false;
              setOpen((current) => !current);
            }}
          >
            <Icon className={iconClassName} />
            <span className="truncate group-data-[collapsible=icon]:hidden">Tools</span>
            <span aria-hidden="true" className="ml-auto text-[color:var(--sidebar-muted)] group-data-[collapsible=icon]:hidden max-md:hidden">
              ›
            </span>
          </SidebarMenuButton>
        </div>
      </PopoverAnchor>
      <PopoverContent
        side={isMobile ? "bottom" : "right"}
        align={isMobile ? "start" : "start"}
        sideOffset={isMobile ? 4 : state === "collapsed" ? 12 : 8}
        collisionPadding={12}
        aria-label="Tools"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!openedByHover.current) buttonRef.current?.focus();
        }}
        onOpenAutoFocus={(event) => {
          if (openedByHover.current) event.preventDefault();
        }}
        onPointerEnter={openFromHover}
        onPointerLeave={closeFromHover}
        className={cn(chromeFont.className, "w-[19rem] max-w-[calc(100vw-1.5rem)] rounded-xl p-1.5")}
      >
        <p className="px-2 pb-1 pt-1.5 text-[11.5px] font-bold tracking-[0.01em] text-muted-foreground">Tools</p>
        <ul className="m-0 list-none p-0">
          {tools.map(({ label, href, icon: ToolIcon, description }) => (
            <li key={href}>
              <a
                href={href}
                className="flex items-start gap-2.5 rounded-lg px-2 py-2 text-foreground no-underline outline-none transition-colors hover:bg-muted hover:no-underline focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring max-md:py-2.5"
              >
                <span className="mt-px flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <ToolIcon className="size-4 stroke-[1.75]" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-bold leading-tight">{label}</span>
                  <span className="mt-0.5 block text-[12px] font-normal leading-snug text-muted-foreground">{description}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
        <div className="mt-1 border-t border-border pt-1">
          <a
            href={ALL_TOOLS_HREF}
            className="flex min-h-9 items-center justify-between rounded-lg px-2 text-[13px] text-muted-foreground no-underline outline-none transition-colors hover:bg-muted hover:text-foreground hover:no-underline focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            All apps and tools
            <ArrowUpRightIcon className="size-3.5" aria-hidden="true" />
          </a>
        </div>
      </PopoverContent>
    </Popover>
  );
}
