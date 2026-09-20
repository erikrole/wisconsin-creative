import * as React from "react"

import { cn } from "@/lib/utils"
import { fieldChrome } from "@/components/ui/control-styles"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground flex h-10 w-full min-w-0 rounded-md border px-3 py-1 text-base md:text-sm file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium",
        fieldChrome,
        className
      )}
      {...props}
    />
  )
}

export { Input }
