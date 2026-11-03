import { useEffect, useId, useRef, useState } from "react";

let loader: Promise<typeof import("mermaid").default> | null = null;
const loadMermaid = () => (loader ??= import("mermaid").then((m) => m.default));

/** Renders a Mermaid diagram client-side. The library is code-split and only
 * downloaded when a document with a diagram is opened. */
export function Mermaid({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [error, setError] = useState<string | null>(null);
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));

  useEffect(() => {
    const obs = new MutationObserver(() => setDark(document.documentElement.classList.contains("dark")));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadMermaid()
      .then(async (mermaid) => {
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "neutral", fontFamily: "Inter Variable, ui-sans-serif", sequence: { wrap: true } });
        const { svg } = await mermaid.render(`m${id}${dark ? "d" : "l"}`, code);
        if (!cancelled && ref.current) ref.current.innerHTML = svg;
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [code, dark, id]);

  if (error) return <pre className="text-xs text-st-failed-fg">Diagram failed to render: {error}</pre>;
  return <div ref={ref} className="mermaid-box my-6 flex justify-center overflow-x-auto rounded-xl border bg-card p-4" data-lenis-prevent aria-label="Diagram" role="img" />;
}
