import * as React from "react"

import { cn } from "@/lib/utils"
import { fieldChrome } from "@/components/ui/control-styles"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "placeholder:text-muted-foreground flex min-h-16 w-full rounded-md border px-3 py-2 text-base md:text-sm",
        fieldChrome,
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
