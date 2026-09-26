import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // DCS 1b.27: editable = white fill + a visible border (--field-border);
          // read-only/disabled = grey fill, no field border — one definition, not
          // per-screen. --input is untouched: it still drives outline buttons,
          // the Switch track and checkboxes.
          "flex h-9 w-full rounded-md border border-field-border bg-field-bg px-3 py-1 text-base transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:border-transparent disabled:bg-muted disabled:opacity-50 read-only:border-transparent read-only:bg-muted md:text-sm",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
