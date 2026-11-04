import { cn } from "@/lib/utils";
export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return <kbd className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] border border-line bg-sunken px-1 font-mono text-[10.5px] text-fg-2", className)}>{children}</kbd>;
}
