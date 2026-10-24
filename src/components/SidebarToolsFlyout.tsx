"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRightIcon } from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { SidebarMenuButton, useSidebar } from "@/components/ui/sidebar";
import { chromeFont } from "@/lib/chrome-font";
import { cn } from "@/lib/utils";
import { isExternal } from "@/lib/sidebar-links";

type FlyoutItem = { label: string; href: string; icon: React.ElementType; detail?: string };
type FlyoutSection = { title: string; items: FlyoutItem[] };

const HOVER_CLOSE_DELAY_MS = 140;

type Props = {
  label: string;
  sections: FlyoutSection[];
  /** A closing link under the lists, such as the full apps page. */
  footer?: { label: string; href: string };
  /** Shown in place of the lists while they load, fail or are empty. */
  status?: React.ReactNode;
  /** Called each time the flyout opens, so its list can load on demand. */
  onOpen?: () => void;
  icon: React.ElementType;
  buttonClassName: string;
  iconClassName: string;
  tooltipClassName: string;
};

/**
 * A sidebar item with a flyout list (Apps, Quick links). A mouse hover opens the list beside the rail; Enter, Space, a click or a tap
 * toggle it, so keyboard and touch never depend on hover. Esc closes it and returns focus to the item.
 */
export function SidebarToolsFlyout({ label, sections, footer, status, onOpen, icon: Icon, buttonClassName, iconClassName, tooltipClassName }: Props) {
  const { isMobile, state } = useSidebar();
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A hover-opened list leaves focus where it was; a click or key opens it and moves focus in.
  const openedByHover = useRef(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) onOpen?.();
  }, [open, onOpen]);

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
            tooltip={open ? undefined : { children: label, className: tooltipClassName }}
            isActive={false}
            className={buttonClassName}
            onClick={() => {
              cancelClose();
              openedByHover.current = false;
              setOpen((current) => !current);
            }}
          >
            <Icon className={iconClassName} />
            <span className="truncate group-data-[collapsible=icon]:hidden">{label}</span>
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
        aria-label={label}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!openedByHover.current) buttonRef.current?.focus();
        }}
        onOpenAutoFocus={(event) => {
          if (openedByHover.current) event.preventDefault();
        }}
        onPointerEnter={openFromHover}
        onPointerLeave={closeFromHover}
        className={cn(chromeFont.className, "w-64 max-w-[calc(100vw-1.5rem)] rounded-xl p-1.5")}
      >
        {status}
        {!status && sections.map((section, index) => (
          <div key={section.title} className={cn(index > 0 && "mt-1 border-t border-border pt-1")}>
            <p className="px-2 pb-1 pt-1.5 text-[11.5px] font-bold tracking-[0.01em] text-muted-foreground">{section.title}</p>
            <ul className="m-0 list-none p-0">
              {section.items.map(({ label: itemLabel, href, icon: ItemIcon, detail }) => {
                const external = isExternal(href);
                return (
                  <li key={href}>
                    <a
                      href={href}
                      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                      className="group/link flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-foreground no-underline outline-none transition-colors hover:bg-muted hover:no-underline focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring max-md:py-2"
                    >
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                        <ItemIcon className="size-4 stroke-[1.75]" aria-hidden="true" />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-[13.5px] font-bold leading-tight">{itemLabel}</span>
                        {detail && <span className="truncate text-[12px] leading-tight text-muted-foreground">{detail}</span>}
                      </span>
                      {external && (
                        <>
                          <ArrowUpRightIcon className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/link:opacity-100 group-focus-visible/link:opacity-100" aria-hidden="true" />
                          <span className="sr-only">(opens in a new tab)</span>
                        </>
                      )}
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {footer && (
          <div className="mt-1 border-t border-border pt-1">
            <a
              href={footer.href}
              className="flex min-h-9 items-center justify-between rounded-lg px-2 text-[13px] text-muted-foreground no-underline outline-none transition-colors hover:bg-muted hover:text-foreground hover:no-underline focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              {footer.label}
              <ArrowUpRightIcon className="size-3.5" aria-hidden="true" />
            </a>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
