import * as React from "react"

import { cn } from "@/lib/utils"
import { fieldChrome } from "@/components/ui/control-styles"

function NativeSelect({
  className,
  children,
  ...props
}: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        "flex h-10 w-full min-w-0 cursor-pointer rounded-md border px-3 py-1 text-base md:text-sm",
        fieldChrome,
        className,
      )}
      {...props}
    >
      {children}
    </select>
  )
}

export { NativeSelect }
