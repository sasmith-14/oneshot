import { useEffect, useId, useRef, useState } from "react";

let loader: Promise<typeof import("mermaid").default> | null = null;
const loadMermaid = () => (loader ??= import("mermaid").then((m) => m.default));

// Mermaid needs literal colours, so they are read from the live CSS tokens.
function inkColours() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return { background: v("--surface"), primaryColor: v("--surface"), primaryBorderColor: v("--fg"), primaryTextColor: v("--fg"), secondaryColor: v("--sunken"), tertiaryColor: v("--canvas"), lineColor: v("--fg"), textColor: v("--fg"), noteBkgColor: v("--sunken"), noteBorderColor: v("--fg-3"), actorBkg: v("--surface"), actorBorder: v("--fg"), signalColor: v("--fg"), labelBoxBkgColor: v("--canvas"), fontSize: "15px" };
}

/** Renders a Mermaid diagram client-side. The library is code-split and only
 * downloaded when a document with a diagram is opened. */
export function Mermaid({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [error, setError] = useState<string | null>(null);
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));

  useEffect(() => {
    const obs = new MutationObserver(() => setDark(document.documentElement.classList.contains("dark")));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-type"] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadMermaid()
      .then(async (mermaid) => {
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "base", themeVariables: inkColours(), fontFamily: "Mona Sans Variable, ui-sans-serif, system-ui", sequence: { wrap: true } });
        const { svg } = await mermaid.render(`m${id}${dark ? "d" : "l"}`, code);
        if (!cancelled && ref.current) ref.current.innerHTML = svg;
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [code, dark, id]);

  if (error) return <pre className="text-xs text-st-failed-fg">Diagram failed to render: {error}</pre>;
  return <div ref={ref} className="mermaid-box my-10 flex justify-center overflow-x-auto bg-surface p-6" data-lenis-prevent aria-label="Diagram" role="img" />;
}
