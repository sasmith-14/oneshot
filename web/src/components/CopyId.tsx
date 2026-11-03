import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

export function CopyId({ value, className }: { value: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(value);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
      aria-label={`Copy ${value}`}
      className={cn("inline-flex items-center gap-1.5 rounded-md font-mono hover:text-foreground", className)}
      translate="no"
    >
      {value}
      {done ? <Check aria-hidden className="size-3.5 text-st-succeeded" /> : <Copy aria-hidden className="size-3.5 opacity-50" />}
    </button>
  );
}
