import type { Status } from "@/lib/api";
import { STATUS_META, isActive } from "@/lib/status";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** A status is data, so it is shown as its literal value. Hover explains it. */
export function StatusPill({ status, size = "sm", explain = true, className }: { status: Status; size?: "sm" | "md"; explain?: boolean; className?: string }) {
  const meta = STATUS_META[status];
  const pill = (
    <span
      data-status={status}
      translate="no"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-mono font-medium whitespace-nowrap",
        size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs",
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
        <span tabIndex={0} className="rounded-full">{pill}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-72 text-pretty">{meta.meaning}</TooltipContent>
    </Tooltip>
  );
}
