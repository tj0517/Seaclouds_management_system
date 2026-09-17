// shadcn/ui Skeleton (new-york), added in DCS 1a.24 for the loading.tsx
// placeholders. No Radix, no client boundary — it renders in a server
// component so a loading.tsx stays free of "use client".
import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />
}

export { Skeleton }
