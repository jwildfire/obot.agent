---
name: app
title: "G2 — build the app (safetyGraphics replacement, open.gismo arc)"
status: active
anchors:
  - jwildfire/obot.roadmap#34   # GitHub's role in open.gismo v1.0 (plan rewrite app-first, then Phase 1–4 requirements)
backlog:
  - jwildfire/open.gismo
  - jwildfire/gsm.safety
grant_profile: standard
---

Build the user-facing app that replaces safetyGraphics and brings the core gsm
tools into the gsm.safety framework — the open.gismo app-first arc (Stage-3
Goal 2, 2026-07-21).

Boundaries and weights for a selecting session:

- **The plan rewrite comes first**: until the app-first plan update lands on
  #34 and the Phase 1–4 requirements are filed and designed, every increment
  here is pipeline-advancement (draft artifacts, end at @jwildfire's review) —
  there is nothing implementation-ready to select.
- **Prerequisite**: the obotclaw App is not yet installed on
  `jwildfire/open.gismo` — until it is, no merge increment may target that repo
  (draft PRs would push under the wrong identity; flag it in the digest
  instead).
- open.gismo decisions already locked: D1 GitHub-prerequisite, D2 fork+upstream,
  D6 Snapshots in v1 (2026-07-19); K3 forkable demo-study repo is part of this
  goal's eventual scope.
