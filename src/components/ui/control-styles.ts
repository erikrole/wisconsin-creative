import { cn } from "@/lib/utils"

/** Shared field chrome so Input, Textarea, NativeSelect, and SelectTrigger stay aligned. */
export const fieldChrome =
  "border-input bg-transparent shadow-xs outline-none transition-[color,box-shadow,border-color,background-color] duration-150 hover:border-ring/50 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-input/30 dark:hover:bg-input/40 dark:aria-invalid:ring-destructive/40 disabled:cursor-not-allowed disabled:bg-muted/40 disabled:opacity-50 disabled:hover:border-input"

export const overlayScrim =
  "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]"

export const overlayPanelMotion =
  "origin-center data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 duration-200"

export const popoverMotion =
  "origin-(--radix-popover-content-transform-origin) data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2"

export const overlayCloseButton =
  "flex size-10 items-center justify-center rounded-md text-muted-foreground/80 opacity-70 outline-none transition-[background-color,color,box-shadow,opacity,scale] duration-150 hover:bg-muted hover:text-foreground hover:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none active:scale-[0.96] motion-reduce:transition-none motion-reduce:active:scale-100"

export const overlayCloseButtonAbsolute = cn(overlayCloseButton, "absolute right-3 top-3")

/** 40px hit area that does not enlarge the visible control. */
export const compactHitArea =
  "relative after:absolute after:left-1/2 after:top-1/2 after:size-10 after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']"

export const menuItem =
  "relative flex min-h-9 cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
