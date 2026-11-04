import type { Status } from "@/lib/api";
import { STATUS_META, isActive } from "@/lib/status";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** A status is data, so it is printed as its literal value, in its own ink on
 * a pale wash of that ink. Hover or focus explains what it means. */
export function StatusPill({ status, size = "sm", explain = true, className }: { status: Status; size?: "sm" | "md"; explain?: boolean; className?: string }) {
  const meta = STATUS_META[status];
  const pill = (
    <span
      data-status={status}
      translate="no"
      className={cn(
        "inline-flex flex-none items-center gap-1.5 rounded-[2px] font-mono font-medium whitespace-nowrap",
        size === "sm" ? "h-[22px] px-1.5 text-[11.5px]" : "h-7 px-2 text-[13px]",
        meta.badge,
        className,
      )}
    >
      <span className="relative flex size-1.5">
        {isActive(status) && <span className={cn("os-ring absolute inset-0 rounded-full", meta.dot)} />}
        <span className={cn("relative size-1.5 rounded-full", meta.dot)} />
      </span>
      {status}
    </span>
  );
  if (!explain) return pill;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex rounded-[2px]">{pill}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-72 text-pretty">{meta.meaning}</TooltipContent>
    </Tooltip>
  );
}
