---
name: charts
title: "G1 — keep adding charts (static + interactive)"
status: active
anchors:
  - jwildfire/obot.roadmap#35   # nepExplorer migration (KDIGO)
  - jwildfire/obot.roadmap#37   # QT Safety Explorer Phase 2
  - jwildfire/obot.roadmap#9    # FDA ST&F static safety charts (phased; design PR#42 gate)
backlog:
  - jwildfire/obot.roadmap#38
  - jwildfire/obot.roadmap#39
  - jwildfire/obot.roadmap#40
  - jwildfire/safety.viz        # improvement backlog (e.g. #83–#89, #32/#33/#41, #45–#55)
grant_profile: standard
---

Keep growing the safety-chart portfolio, static and interactive, through the
requirement lifecycle: safety.viz renderers (with their full done-gate — gallery
demo + evidence page + API ref on the deployed site) and gsm.safety `Widget_*`
bindings / static FDA ST&F charts.

Boundaries and weights for a selecting session:

- The **renderer done-gate is part of the increment**: a chart isn't done until
  it's on the Pages site with evidence. Don't select a renderer increment the
  session can't carry through its gate.
- **Small, well-scoped backlog items beat big anchors at night** — an anchor
  requirement still in its lifecycle (design unsigned, sub-issues unfiled)
  yields a pipeline-advancement increment (draft the artifact, end at review),
  not an implementation increment.
- New chart ideas found mid-run are **filed, never built** — roadmap-first.
- Done for the summer looks like: nepExplorer shipped, QT Phase 2 shipped, the
  FDA static Phase 1 set in gsm.safety, and the safety.viz improvement backlog
  visibly shrinking.
