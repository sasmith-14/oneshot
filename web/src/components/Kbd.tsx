import { cn } from "@/lib/utils";
export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return <kbd className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded border bg-muted px-1 font-mono text-[10.5px] text-muted-foreground", className)}>{children}</kbd>;
}
