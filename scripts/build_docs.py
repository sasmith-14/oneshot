"""Render the Markdown docs (with Mermaid diagrams) to PDF using free tooling only.

    make docs                # or: uv run --extra docs python scripts/build_docs.py
    uv run --extra docs python scripts/build_docs.py --only 04-crash-recovery

Pipeline, per document:

1. Markdown (docs/src/*.md and EXPERIMENTS.md) -> HTML with Python-Markdown.
   ``{{include outputs/x.txt}}`` lines are replaced by that file verbatim, so
   captured real output (scripts/capture_outputs.py) lands in the docs unedited.
   ```mermaid fences become <pre class="mermaid-src"> blocks (a class Mermaid
   does not auto-scan, so rendering happens exactly once, under our control).
2. Headless Chromium (Playwright) opens the HTML, runs the vendored, pinned
   Mermaid bundle (docs/tooling/vendor) to draw diagrams *offline*, and the
   build FAILS if any diagram does not render or Mermaid reports a syntax error.
3. Chromium prints the page to PDF (A4, page numbers in the footer).

Output: docs/pdf/<name>.pdf (committed) and docs/build/<name>.html (ignored).
"""

from __future__ import annotations

import argparse
import html
import re
import sys
from pathlib import Path

import markdown

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "docs" / "src"
OUT_PDF = ROOT / "docs" / "pdf"
OUT_HTML = ROOT / "docs" / "build"
CSS = ROOT / "docs" / "tooling" / "style.css"
MERMAID_JS = ROOT / "docs" / "tooling" / "vendor" / "mermaid-12.2.0.min.js"

MERMAID_FENCE = re.compile(r"^```mermaid\s*\n(.*?)^```\s*$", re.M | re.S)
INCLUDE = re.compile(r"^\{\{include\s+(\S+)\}\}\s*$", re.M)


def sources() -> list[Path]:
    return sorted(SRC.glob("*.md")) + [ROOT / "EXPERIMENTS.md"]


def expand_includes(text: str, base: Path) -> str:
    def repl(m: re.Match[str]) -> str:
        path = base / m.group(1)
        if not path.exists():
            raise SystemExit(f"include not found: {path} (run scripts/capture_outputs.py?)")
        body = path.read_text().rstrip()
        return f"```text\n{body}\n```"

    return INCLUDE.sub(repl, text)


def to_html(md_path: Path) -> tuple[str, str, int]:
    text = expand_includes(md_path.read_text(), SRC)
    diagrams: list[str] = []

    def stash(m: re.Match[str]) -> str:
        diagrams.append(m.group(1))
        return f"\n\nMERMAIDDIAGRAM{len(diagrams) - 1}\n\n"

    text = MERMAID_FENCE.sub(stash, text)
    body = markdown.markdown(
        text,
        extensions=["fenced_code", "tables", "toc", "codehilite", "attr_list", "md_in_html", "sane_lists"],
        extension_configs={"codehilite": {"guess_lang": False, "css_class": "hl"}, "toc": {"toc_depth": "2-3"}},
    )
    for i, src in enumerate(diagrams):
        body = body.replace(f"<p>MERMAIDDIAGRAM{i}</p>", f'<pre class="mermaid-src">{html.escape(src)}</pre>')
    title_match = re.search(r"<h1[^>]*>(.*?)</h1>", body)
    title = re.sub("<[^>]+>", "", title_match.group(1)) if title_match else md_path.stem
    page = f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>{html.escape(title)}</title>
<style>{CSS.read_text()}</style></head>
<body><main>{body}</main>
<script src="{MERMAID_JS.as_uri()}"></script>
</body></html>"""
    return page, title, len(diagrams)


RENDER_DIAGRAMS = """
async () => {
  mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'strict',
                       flowchart: { htmlLabels: false, curve: 'basis' }, fontFamily: 'Helvetica, Arial, sans-serif' });
  const nodes = Array.from(document.querySelectorAll('pre.mermaid-src'));
  const errors = [];
  for (const [i, node] of nodes.entries()) {
    const src = node.textContent;
    try {
      await mermaid.parse(src);
      const { svg } = await mermaid.render('diagram' + i, src);
      const wrap = document.createElement('div');
      wrap.className = 'diagram';
      wrap.innerHTML = svg;
      node.replaceWith(wrap);
    } catch (e) {
      errors.push('diagram ' + (i + 1) + ': ' + String(e && e.message ? e.message : e).slice(0, 400));
    }
  }
  return { count: nodes.length, svgs: document.querySelectorAll('div.diagram svg').length, errors };
}
"""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--only", nargs="*", help="document stems to build (default: all)")
    args = parser.parse_args()

    try:
        from playwright.sync_api import Error as PlaywrightError
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("Playwright is not installed. Run: uv sync --extra docs", file=sys.stderr)
        return 2

    OUT_PDF.mkdir(parents=True, exist_ok=True)
    OUT_HTML.mkdir(parents=True, exist_ok=True)
    docs = [p for p in sources() if not args.only or p.stem in args.only]
    failures = 0
    with sync_playwright() as pw:
        try:
            browser = pw.chromium.launch()
        except PlaywrightError as exc:
            print(
                f"Could not start Chromium ({exc}).\n"
                "Install Playwright's free Chromium build once with:\n"
                "    uv run --extra docs playwright install chromium",
                file=sys.stderr,
            )
            return 2
        page = browser.new_page()
        for md in docs:
            page_html, title, n_diagrams = to_html(md)
            html_path = OUT_HTML / f"{md.stem}.html"
            html_path.write_text(page_html)
            page.goto(html_path.as_uri())
            result = page.evaluate(RENDER_DIAGRAMS)
            ok = not result["errors"] and result["svgs"] == n_diagrams
            pdf_path = OUT_PDF / f"{md.stem}.pdf"
            page.pdf(
                path=str(pdf_path),
                format="A4",
                print_background=True,
                margin={"top": "16mm", "bottom": "18mm", "left": "16mm", "right": "16mm"},
                display_header_footer=True,
                header_template="<span></span>",
                footer_template=(
                    '<div style="font-size:7.5pt;color:#8a8f98;width:100%;padding:0 16mm;'
                    'font-family:Helvetica,Arial,sans-serif;display:flex;justify-content:space-between">'
                    f"<span>OneShot &middot; {html.escape(title)}</span>"
                    '<span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>'
                ),
            )
            status = "ok" if ok else "DIAGRAM ERRORS"
            print(f"{status:15} {pdf_path.relative_to(ROOT)}  ({result['svgs']}/{n_diagrams} diagrams)")
            for err in result["errors"]:
                print(f"    {err}")
            failures += 0 if ok else 1
        browser.close()
    if failures:
        print(f"{failures} document(s) had diagram errors", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
