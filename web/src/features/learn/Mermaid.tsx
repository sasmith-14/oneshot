import { useEffect, useId, useRef, useState } from "react";

let loader: Promise<typeof import("mermaid").default> | null = null;
const loadMermaid = () => (loader ??= import("mermaid").then((m) => m.default));

// Mermaid needs literal colours, so they are read from the live CSS tokens.
function inkColours() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return { background: v("--sheet"), primaryColor: v("--sheet"), primaryBorderColor: v("--ink"), primaryTextColor: v("--ink"), secondaryColor: v("--well"), tertiaryColor: v("--paper"), lineColor: v("--ink"), textColor: v("--ink"), noteBkgColor: v("--well"), noteBorderColor: v("--ink-3"), actorBkg: v("--sheet"), actorBorder: v("--ink"), signalColor: v("--ink"), labelBoxBkgColor: v("--paper"), fontSize: "15px" };
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
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "base", themeVariables: inkColours(), fontFamily: getComputedStyle(document.documentElement).getPropertyValue("--face-text").trim(), sequence: { wrap: true } });
        const { svg } = await mermaid.render(`m${id}${dark ? "d" : "l"}`, code);
        if (!cancelled && ref.current) ref.current.innerHTML = svg;
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [code, dark, id]);

  if (error) return <pre className="text-xs text-st-failed-fg">Diagram failed to render: {error}</pre>;
  return <div ref={ref} className="mermaid-box my-10 flex justify-center overflow-x-auto bg-sheet p-6" data-lenis-prevent aria-label="Diagram" role="img" />;
}
