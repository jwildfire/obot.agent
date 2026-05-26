#!/usr/bin/env python3
"""Harvest RhoInc renderer wiki pages into traceable Markdown requirement docs."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROJECTS = ROOT.parent
OUT = ROOT / "docs" / "requirements"

RENDERERS = [
    ("safety-histogram", "SH"),
    ("aeexplorer", "AE"),
    ("ae-timelines", "AET"),
    ("safety-outlier-explorer", "SOE"),
    ("paneled-outlier-explorer", "POE"),
    ("safety-results-over-time", "SROT"),
    ("safety-shift-plot", "SSP"),
    ("safety-delta-delta", "SDD"),
    ("web-codebook", "WCB"),
]

SOURCE_PRIORITY = [
    "Technical-Documentation.md",
    "Data-Guidelines.md",
    "Configuration.md",
    "Explorer-Configuration.md",
    "API.md",
    "Home.md",
]

AREA_HINTS = [
    ("Regression", "REG"), ("User Requirement", "USER"), ("Functional", "FUNC"),
    ("Data", "DATA"), ("Configuration", "CFG"), ("API", "API"),
    ("Listing", "LIST"), ("Export", "EXPORT"), ("Filter", "CTRL"),
    ("Control", "CTRL"), ("Hover", "INT"), ("Brush", "INT"), ("Highlight", "INT"),
    ("Chart", "CHART"), ("Participant", "COUNT"), ("Column", "COUNT"), ("Row", "COUNT"),
]

SKIP_LINES = {"", "---"}

def clean(text: str) -> str:
    text = re.sub(r"\s+", " ", text.strip())
    text = text.replace("|", "\\|")
    return text

def area_code(heading: str, source_name: str) -> str:
    hay = f"{heading} {source_name}".lower()
    for key, code in AREA_HINTS:
        if key.lower() in hay:
            return code
    return "REQ"

def iter_requirements(path: Path):
    heading_stack: list[str] = []
    in_code = False
    paragraph: list[str] = []

    def flush_para():
        nonlocal paragraph
        if paragraph:
            text = clean(" ".join(paragraph))
            paragraph = []
            if len(text) > 40 and not text.startswith("#"):
                yield (" > ".join(heading_stack) or path.stem, text)

    for raw in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw.rstrip()
        if line.strip().startswith("```"):
            in_code = not in_code
            paragraph = []
            continue
        if in_code:
            continue
        m = re.match(r"^(#{1,6})\s+(.*)", line)
        if m:
            yield from flush_para()
            level = len(m.group(1))
            title = clean(m.group(2))
            heading_stack[:] = heading_stack[: level - 1]
            heading_stack.append(title)
            continue
        stripped = line.strip()
        if stripped in SKIP_LINES:
            yield from flush_para()
            continue
        bullet = re.match(r"^[-*+]\s+(.*)", stripped)
        numbered = re.match(r"^\d+[.)]\s+(.*)", stripped)
        if bullet or numbered:
            yield from flush_para()
            item = clean((bullet or numbered).group(1))
            if len(item) > 10:
                yield (" > ".join(heading_stack) or path.stem, item)
            continue
        # Treat table rows as source material only if they look descriptive.
        if stripped.startswith("|"):
            yield from flush_para()
            continue
        paragraph.append(stripped)
    yield from flush_para()

def write_renderer_doc(repo: str, prefix: str) -> None:
    wiki = PROJECTS / f"{repo}.wiki"
    out = OUT / f"{repo}.md"
    files = [wiki / name for name in SOURCE_PRIORITY if (wiki / name).exists()]
    files += sorted(p for p in wiki.glob("*.md") if p.name not in SOURCE_PRIORITY)

    rows = []
    counters: dict[str, int] = {}
    for source in files:
        for heading, req in iter_requirements(source):
            area = area_code(heading, source.name)
            counters[area] = counters.get(area, 0) + 1
            rid = f"{prefix}-{area}-{counters[area]:03d}"
            rows.append((rid, area, req, f"RhoInc/{repo}.wiki/{source.name}::{heading}", "planned", "TBD", "harvested", "Review before implementation; split further if needed."))

    lines = [
        f"# {repo} requirements matrix",
        "",
        "> Auto-harvested from the RhoInc wiki. Treat this as a source-backed starting matrix: review, de-duplicate, and refine before implementation.",
        "",
        "## Source inventory",
        "",
    ]
    lines += [f"- `{p.name}`" for p in files]
    lines += [
        "",
        "## Requirements",
        "",
        "| ID | Area | Requirement | Source | Evidence Type | Test/Evidence Link | Status | Notes |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for row in rows:
        lines.append("| " + " | ".join(clean(x) for x in row) + " |")
    lines += [
        "",
        "## Next review tasks",
        "",
        "- Remove duplicate or non-behavioral rows.",
        "- Split compound requirements into separate rows where needed.",
        "- Map each requirement to automated, browser, visual, manual, or deferred evidence.",
        "- Add baseline and nextgen demo evidence links during implementation.",
    ]
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")

def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for repo, prefix in RENDERERS:
        write_renderer_doc(repo, prefix)
    index = ["# Renderer requirements", "", "Requirement matrices harvested from RhoInc wiki sources.", ""]
    for repo, _ in RENDERERS:
        index.append(f"- [{repo}](./{repo}.md)")
    (OUT / "README.md").write_text("\n".join(index) + "\n", encoding="utf-8")

if __name__ == "__main__":
    main()
