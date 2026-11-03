"""Serve the learning docs (docs/src/*.md + EXPERIMENTS.md) to the web console.

The same Markdown files are the source of the PDFs, so the console and the PDFs
never drift apart. ``{{include outputs/x.txt}}`` lines are expanded exactly as
``scripts/build_docs.py`` does, and the ``<div class="note|protects|cannot"
markdown>`` boxes are rewritten as blockquotes tagged ``[!note]`` etc., which
the console renders as callouts.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "docs" / "src"

INCLUDE = re.compile(r"^\{\{include\s+(\S+)\}\}\s*$", re.M)
BOX = re.compile(r'<div class="(note|protects|cannot)" markdown>\s*\n(.*?)\n</div>', re.S)


def _sources(root: Path) -> list[Path]:
    src = root / "docs" / "src"
    return sorted(src.glob("*.md")) + [root / "EXPERIMENTS.md"]


def slug_of(path: Path) -> str:
    return path.stem.lower()


def title_of(text: str, fallback: str) -> str:
    for line in text.splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return fallback


def list_docs(root: Path = ROOT) -> list[dict[str, Any]]:
    out = []
    for p in _sources(root):
        if p.exists():
            text = p.read_text()
            out.append({"slug": slug_of(p), "title": title_of(text, p.stem), "words": len(text.split())})
    return out


def render_doc(slug: str, root: Path = ROOT) -> dict[str, Any] | None:
    for p in _sources(root):
        if slug_of(p) == slug and p.exists():
            text = p.read_text()
            base = root / "docs" / "src"

            def include(m: re.Match[str]) -> str:
                f = base / m.group(1)
                body = f.read_text().rstrip() if f.exists() else f"(missing capture: {m.group(1)}; run make docs-capture)"
                return f"```text\n{body}\n```"

            def box(m: re.Match[str]) -> str:
                inner = "\n".join(f"> {line}" if line else ">" for line in m.group(2).strip().splitlines())
                return f"> [!{m.group(1)}]\n{inner}"

            text = BOX.sub(box, INCLUDE.sub(include, text))
            return {"slug": slug, "title": title_of(text, p.stem), "markdown": text}
    return None
