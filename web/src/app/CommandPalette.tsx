import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Activity, BookOpen, FlaskConical, Scale, ScrollText, ShieldCheck, Zap } from "lucide-react";
import { THEME_MODES } from "./ThemeSwitch";
import type { ThemeMode } from "./theme";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from "@/components/ui/command";
import { StatusPill } from "@/components/StatusPill";
import { useActions, usePresets, useSystemStatus } from "@/hooks/queries";
import { lab, ops } from "@/lib/api";

export const PAGES = [
  { to: "/", label: "Live", icon: Activity, hint: "actions moving through their states" },
  { to: "/chaos", label: "Chaos", icon: FlaskConical, hint: "break things on purpose" },
  { to: "/reconcile", label: "Reconcile", icon: Scale, hint: "compare with the provider's ledger" },
  { to: "/ledger", label: "Ledger", icon: ScrollText, hint: "the provider's own record" },
  { to: "/guarantees", label: "Guarantees", icon: ShieldCheck, hint: "what is promised, checked live" },
  { to: "/learn", label: "Learn", icon: BookOpen, hint: "how and why it works" },
] as const;

export function CommandPalette({ open, setOpen, mode, setMode }: { open: boolean; setOpen: (v: boolean) => void; mode: ThemeMode; setMode: (m: ThemeMode) => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const status = useSystemStatus();
  const actions = useActions();
  const presets = usePresets(!!status.data?.lab);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !/input|textarea|select/i.test((e.target as HTMLElement).tagName))) {
        e.preventDefault();
        setOpen(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  const recent = useMemo(() => [...(actions.data ?? [])].sort((a, b) => b.created_at - a.created_at).slice(0, 30), [actions.data]);

  const runPreset = useMutation({
    mutationFn: lab.run,
    onSuccess: (r) => {
      qc.invalidateQueries();
      toast.success(`Started: ${r.preset.title}`, { description: r.note || r.action_ids.join(", ") });
      navigate(`/actions/${r.action_ids[0]}`);
    },
    onError: (e: Error) => toast.error("Preset did not start", { description: e.message }),
  });
  const reconcile = useMutation({
    mutationFn: () => ops.reconcile(true),
    onSuccess: (r) => {
      qc.invalidateQueries();
      toast.success("Reconciliation finished", { description: `${r.actions_checked} actions, ${r.effects_checked} effects checked` });
      navigate(`/reconcile?run=${r.run_id}`);
    },
    onError: (e: Error) => toast.error("Reconciliation failed", { description: e.message }),
  });

  const go = (fn: () => void) => {
    setOpen(false);
    setQuery("");
    fn();
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Command palette" description="Jump to a page or action, or run a command">
      {/* This shadcn version's CommandDialog does not create the cmdk root itself. */}
      <Command loop>
      <CommandInput placeholder="Search pages, actions, presets…" value={query} onValueChange={setQuery} />
      <CommandList data-lenis-prevent className="max-h-[min(60vh,440px)]">
        <CommandEmpty>Nothing matches “{query}”.</CommandEmpty>
        <CommandGroup heading="Pages">
          {PAGES.map((p, i) => (
            <CommandItem key={p.to} value={`page ${p.label} ${p.hint}`} onSelect={() => go(() => navigate(p.to))}>
              <p.icon aria-hidden />
              {p.label}
              <span className="text-muted-foreground">{p.hint}</span>
              <CommandShortcut>{i + 1}</CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Commands">
          <CommandItem value="run reconciliation now" onSelect={() => go(() => reconcile.mutate())}>
            <Scale aria-hidden /> Run reconciliation
          </CommandItem>
          {THEME_MODES.filter((t) => t.mode !== mode).map(({ mode: m, label, Icon }) => (
            <CommandItem key={m} value={`theme ${label} ${m === "system" ? "follow os auto" : ""}`} onSelect={() => go(() => setMode(m))}>
              <Icon aria-hidden /> {m === "system" ? "Use the system theme" : `Use the ${label.toLowerCase()} theme`}
            </CommandItem>
          ))}
        </CommandGroup>
        {presets.data && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Run a failure preset">
              {presets.data.presets.map((p) => (
                <CommandItem key={p.name} value={`preset ${p.title} ${p.name} ${p.group}`} onSelect={() => go(() => runPreset.mutate(p.name))}>
                  <Zap aria-hidden />
                  {p.title}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
        {recent.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Actions">
              {recent.map((a) => (
                <CommandItem key={a.id} value={`action ${a.id} ${a.type} ${a.status}`} onSelect={() => go(() => navigate(`/actions/${a.id}`))}>
                  <span className="font-mono text-xs" translate="no">{a.id}</span>
                  <span className="text-muted-foreground">{a.type}</span>
                  <span className="ml-auto"><StatusPill status={a.status} explain={false} /></span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
      </Command>
    </CommandDialog>
  );
}
