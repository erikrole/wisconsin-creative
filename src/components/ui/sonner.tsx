"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import { CircleAlertIcon, CircleCheckIcon, InfoIcon, TriangleAlertIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { getToasts, subscribeToasts, toast, type ToastItem } from "@/lib/toast"

const ICONS = {
  success: <CircleCheckIcon className="size-4 text-[var(--green)]" aria-hidden />,
  error: <CircleAlertIcon className="size-4 text-[var(--red)]" aria-hidden />,
  info: <InfoIcon className="size-4 text-[var(--blue)]" aria-hidden />,
  warning: <TriangleAlertIcon className="size-4 text-amber-500" aria-hidden />,
  default: null,
}

const ACCENT = {
  success: "border-l-[3px] border-l-[var(--green)]",
  error: "border-l-[3px] border-l-[var(--red)]",
  info: "border-l-[3px] border-l-[var(--blue)]",
  warning: "border-l-[3px] border-l-amber-500",
  default: "",
}

function ToastCard({ item, duration }: { item: ToastItem; duration: number }) {
  const [paused, setPaused] = useState(false)
  const ms = item.duration ?? duration

  useEffect(() => {
    if (paused || !Number.isFinite(ms)) return
    const timer = window.setTimeout(() => toast.dismiss(item.id), ms)
    return () => window.clearTimeout(timer)
  }, [item.id, ms, paused])

  return (
    <li
      role={item.type === "error" ? "alert" : "status"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={cn(
        "wc-toast pointer-events-auto flex items-start gap-3 rounded-lg border border-border bg-popover p-3.5 text-sm text-popover-foreground shadow-lg",
        ACCENT[item.type]
      )}
    >
      {ICONS[item.type]}
      <div className="min-w-0 flex-1">
        <p className="font-medium leading-snug break-words">{item.message}</p>
        {item.description && <p className="mt-0.5 text-muted-foreground break-words">{item.description}</p>}
      </div>
      {item.action && (
        <button
          type="button"
          className="shrink-0 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground"
          onClick={() => {
            toast.dismiss(item.id)
            void item.action?.onClick()
          }}
        >
          {item.action.label}
        </button>
      )}
    </li>
  )
}

function Toaster({ position = "top-right", duration = 4000 }: { position?: "top-right" | "bottom-center"; duration?: number }) {
  const items = useSyncExternalStore(subscribeToasts, getToasts, getToasts)
  return (
    <ol
      className={cn(
        "toaster pointer-events-none fixed z-[100] flex flex-col gap-2 p-3 sm:w-[372px]",
        position === "top-right"
          ? "inset-x-0 top-[env(safe-area-inset-top)] sm:left-auto sm:right-0"
          : "inset-x-0 bottom-[env(safe-area-inset-bottom)] sm:left-1/2 sm:-translate-x-1/2",
        position === "bottom-center" && "flex-col-reverse"
      )}
    >
      {items.map((item) => (
        <ToastCard key={item.id} item={item} duration={duration} />
      ))}
    </ol>
  )
}

export { Toaster }
