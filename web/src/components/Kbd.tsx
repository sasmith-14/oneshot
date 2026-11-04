import { cn } from "@/lib/utils";
export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return <kbd className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded-[2px] border border-rule bg-sheet px-1 font-mono text-[11px] text-ink-2", className)}>{children}</kbd>;
}
