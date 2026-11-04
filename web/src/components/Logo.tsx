import { cn } from "@/lib/utils";

/** The mark: a target with one hit in the centre. One shot. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-6", className)} aria-hidden>
      <rect x="0.5" y="0.5" width="23" height="23" rx="6.5" className="fill-fg" />
      <circle cx="12" cy="12" r="6.6" fill="none" strokeWidth="1.6" className="stroke-canvas" />
      <circle cx="12" cy="12" r="2.6" className="fill-signal" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark />
      <span className="text-[15px] font-[680] tracking-[-0.03em] [font-stretch:112%]">OneShot</span>
    </span>
  );
}
