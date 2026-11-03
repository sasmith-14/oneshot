import { Children, isValidElement, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { motion, useScroll, useSpring } from "motion/react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useDoc, useDocs } from "@/hooks/queries";
import { useLenis } from "@/app/SmoothScroll";
import { cn } from "@/lib/utils";
import { Mermaid } from "./Mermaid";

export const slugify = (s: string) => s.toLowerCase().replace(/[`*_]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function textOf(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) return textOf((node.props as { children?: React.ReactNode }).children);
  return "";
}

const CALLOUT: Record<string, { label: string; cls: string }> = {
  note: { label: "Note", cls: "border-st-inflight bg-st-inflight-soft/50" },
  protects: { label: "What this protects against", cls: "border-st-succeeded bg-st-succeeded-soft/50" },
  cannot: { label: "What this cannot protect against", cls: "border-st-unknown bg-st-unknown-soft/50" },
};

const components: Components = {
  h2: ({ children }) => <h2 id={slugify(textOf(children))}>{children}</h2>,
  h3: ({ children }) => <h3 id={slugify(textOf(children))}>{children}</h3>,
  pre: ({ children }) => {
    const child = Children.only(children) as React.ReactElement<{ className?: string; children?: React.ReactNode }>;
    if (child.props.className?.includes("language-mermaid")) return <Mermaid code={textOf(child.props.children).trim()} />;
    return <pre data-lenis-prevent>{children}</pre>;
  },
  blockquote: ({ children }) => {
    const text = textOf(children);
    const m = text.match(/^\s*\[!(note|protects|cannot)\]/);
    if (!m) return <blockquote>{children}</blockquote>;
    const c = CALLOUT[m[1]];
    return (
      <aside className={cn("my-6 rounded-r-xl border-l-4 px-5 py-1 text-foreground", c.cls)}>
        <p className="!mb-0 pt-3 text-xs font-semibold">{c.label}</p>
        <div className="[&>p:first-child]:hidden">{children}</div>
      </aside>
    );
  },
  a: ({ href, children }) => <a href={href} target={href?.startsWith("http") ? "_blank" : undefined} rel="noreferrer">{children}</a>,
  table: ({ children }) => <table data-lenis-prevent>{children}</table>,
};

export function LearnDoc() {
  const { slug = "" } = useParams();
  const doc = useDoc(slug);
  const docs = useDocs();
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 200, damping: 35 });

  const headings = useMemo(() => {
    const md = doc.data?.markdown ?? "";
    const withoutCode = md.replace(/```[\s\S]*?```/g, "");
    return [...withoutCode.matchAll(/^##\s+(.+)$/gm)].map((m) => ({ text: m[1].replace(/[`*]/g, ""), id: slugify(m[1]) }));
  }, [doc.data]);
  const active = useActiveHeading(headings.map((h) => h.id));
  const lenis = useLenis();

  const index = docs.data?.findIndex((d) => d.slug === slug) ?? -1;
  const prev = index > 0 ? docs.data![index - 1] : null;
  const next = index >= 0 && index < (docs.data?.length ?? 0) - 1 ? docs.data![index + 1] : null;

  return (
    <>
      <motion.div aria-hidden style={{ scaleX: progress }} className="fixed inset-x-0 top-14 z-20 h-0.5 origin-left bg-st-inflight" />
      <Link to="/learn" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden className="size-4" /> Learn
      </Link>
      {doc.isError ? (
        <p className="py-10">There is no document called <span className="font-mono">{slug}</span>.</p>
      ) : !doc.data ? (
        <Skeleton className="h-[600px] max-w-3xl rounded-[14px]" />
      ) : (
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_220px]">
          <article className="prose-os min-w-0">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{doc.data.markdown}</ReactMarkdown>
            <nav aria-label="More documents" className="mt-16 flex justify-between gap-4 border-t pt-6 text-sm">
              {prev ? <Link to={`/learn/${prev.slug}`} className="flex items-center gap-2 no-underline"><ArrowLeft aria-hidden className="size-4" />{prev.title}</Link> : <span />}
              {next && <Link to={`/learn/${next.slug}`} className="flex items-center gap-2 text-right no-underline">{next.title}<ArrowRight aria-hidden className="size-4" /></Link>}
            </nav>
          </article>
          {headings.length > 2 && (
            <aside className="hidden lg:block">
              <nav aria-label="On this page" className="sticky top-24 text-[13px]">
                <p className="mb-3 font-medium">On this page</p>
                <ol className="space-y-0.5 border-l">
                  {headings.map((h) => (
                    <li key={h.id}>
                      <a
                        href={`#${h.id}`}
                        onClick={(e) => {
                          if (!lenis) return;
                          e.preventDefault();
                          lenis.scrollTo(`#${h.id}`, { offset: -80 });
                          history.replaceState(null, "", `#${h.id}`);
                        }}
                        className={cn("relative -ml-px block border-l py-1 pl-3 transition-colors", active === h.id ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
                      >
                        {h.text}
                      </a>
                    </li>
                  ))}
                </ol>
              </nav>
            </aside>
          )}
        </div>
      )}
    </>
  );
}

function useActiveHeading(ids: string[]) {
  const [active, setActive] = useState<string | null>(null);
  const key = ids.join("|");
  useEffect(() => {
    if (!ids.length) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(top.target.id);
      },
      { rootMargin: "-80px 0px -65% 0px" },
    );
    const t = setTimeout(() => ids.forEach((id) => { const el = document.getElementById(id); if (el) obs.observe(el); }), 50);
    return () => {
      clearTimeout(t);
      obs.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return active;
}
