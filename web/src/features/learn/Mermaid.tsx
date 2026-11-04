import { useEffect, useId, useRef, useState } from "react";

let loader: Promise<typeof import("mermaid").default> | null = null;
const loadMermaid = () => (loader ??= import("mermaid").then((m) => m.default));

// Mermaid needs literal colours, so the paper palette is repeated here.
const INK = {
  light: { background: "#F9F8F5", primaryColor: "#F9F8F5", primaryBorderColor: "#17150F", primaryTextColor: "#17150F", secondaryColor: "#E8E5DE", tertiaryColor: "#F2F0EB", lineColor: "#17150F", textColor: "#17150F", noteBkgColor: "#E8E5DE", noteBorderColor: "#8C877C", actorBkg: "#F9F8F5", actorBorder: "#17150F", signalColor: "#17150F", labelBoxBkgColor: "#F2F0EB", fontSize: "15px" },
  dark: { background: "#1A1915", primaryColor: "#1A1915", primaryBorderColor: "#ECE7DB", primaryTextColor: "#ECE7DB", secondaryColor: "#23211C", tertiaryColor: "#12110E", lineColor: "#ECE7DB", textColor: "#ECE7DB", noteBkgColor: "#23211C", noteBorderColor: "#777164", actorBkg: "#1A1915", actorBorder: "#ECE7DB", signalColor: "#ECE7DB", labelBoxBkgColor: "#12110E", fontSize: "15px" },
};

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
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "base", themeVariables: dark ? INK.dark : INK.light, fontFamily: "Schibsted Grotesk Variable, ui-sans-serif", sequence: { wrap: true } });
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
