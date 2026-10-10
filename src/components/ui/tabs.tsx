"use client"

import * as React from "react"
import { Tabs as TabsPrimitive } from "radix-ui"
import { motion, useReducedMotion } from "motion/react"

import { cn } from "@/lib/utils"
import { springTransition } from "@/components/ui/motion"

function Tabs({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function TabsList({
  className,
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  const listRef = React.useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()
  const [bar, setBar] = React.useState<{ left: number; width: number } | null>(
    null,
  )

  React.useEffect(() => {
    const list = listRef.current
    if (!list) return
    const measure = () => {
      const active = list.querySelector<HTMLElement>(
        '[data-slot="tabs-trigger"][data-state="active"]',
      )
      setBar((prev) => {
        if (!active) return prev === null ? prev : null
        const next = { left: active.offsetLeft, width: active.offsetWidth }
        return prev && prev.left === next.left && prev.width === next.width
          ? prev
          : next
      })
    }
    measure()
    const mutations = new MutationObserver(measure)
    mutations.observe(list, {
      attributes: true,
      attributeFilter: ["data-state"],
      childList: true,
      subtree: true,
    })
    const resize = new ResizeObserver(measure)
    resize.observe(list)
    list.querySelectorAll("[data-slot=tabs-trigger]").forEach((t) =>
      resize.observe(t),
    )
    return () => {
      mutations.disconnect()
      resize.disconnect()
    }
  }, [])

  return (
    <TabsPrimitive.List
      ref={listRef}
      data-slot="tabs-list"
      data-indicator={bar ? "" : undefined}
      className={cn(
        "group/tabs-list relative inline-flex items-center border-b w-full gap-0",
        className,
      )}
      {...props}
    >
      {children}
      {bar ? (
        <motion.span
          aria-hidden
          data-slot="tabs-indicator"
          className="pointer-events-none absolute -bottom-px left-0 h-0.5 bg-primary"
          initial={false}
          animate={{ x: bar.left, width: bar.width }}
          transition={springTransition(reduced)}
        />
      ) : null}
    </TabsPrimitive.List>
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "min-h-10 cursor-pointer px-4 py-2.5 text-sm font-medium text-muted-foreground transition-[color,border-color] duration-200 border-b-2 border-transparent -mb-px hover:text-foreground data-[state=active]:text-foreground data-[state=active]:border-primary group-data-[indicator]/tabs-list:data-[state=active]:border-transparent data-[state=active]:font-semibold rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
