import type { Status } from "@/lib/api";
import { STATUS_META, isActive } from "@/lib/status";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function StatusBadge({ status, className, explain = true }: { status: Status; className?: string; explain?: boolean }) {
  const meta = STATUS_META[status];
  const badge = (
    <span
      data-status={status}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap os-transition",
        meta.badge,
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", meta.dot, isActive(status) && "os-pulse")} />
      {status}
    </span>
  );
  if (!explain) return badge;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent className="max-w-72">{meta.meaning}</TooltipContent>
    </Tooltip>
  );
}
