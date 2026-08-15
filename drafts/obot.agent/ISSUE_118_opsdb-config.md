<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/issues/118 on 2026-08-15 22:40 EDT -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Labels: enhancement, Assignee: @me -->

# Operations Dashboard, iteration 2: config items with IDs, RC labels, a compact rail, and one merged local site

@jwildfire, 2026-08-15, on the dashboard that shipped this morning:

> "OK, let's iterate on the opsdb. Let's call 'your hands' -> 'config' and give them IDs. c0001, etc. release candidate PRs should all start with a package name and a version number. I like the sidebar, but make it much mroe compact. RCs first. then decisions, then config items."

and, mid-request:

> "Also, I want the ops db and orginal ops hub to be merged. just make them 2 different tabs on the same (local) site for now. new ops db should be default view."

## What changes

- **"your hands" becomes "config", and every item gets a permanent ID** — `c0001`, `c0002`, … assigned once at capture time and never reused, so he can name one in chat the way he names a decision (`D0004.2`). The ID lives in the source list, survives a reword, and is allocated the way decision IDs are: derived from the highest one already claimed, never from a counter.
- **Release candidates read `pkg vX.Y.Z — what it is`.** The dashboard normalizes the label it renders; the RC framework and the RC release-notes skill state the rule for PRs written from here on.
- **The queue rail gets much denser** — one line per item where one line will do, no explanatory paragraphs, legible at a 390px iPhone viewport.
- **Section order becomes release candidates → decisions → config.**
- **The Operations Dashboard and the session hub become one local site with two tabs**, ops as the default view, on one port, with both entry points (`/ops-dashboard`, `/s-dashboard`) and the status-line link still resolving.

## Out of scope

Renaming the capture file itself — see the note in the PR. The vocabulary he reads changes; the local file keeps the name an approved decision artifact gave it this morning.

Requirement: [obot.roadmap#180](https://github.com/jwildfire/obot.roadmap/issues/180).

---

This Issue was drafted by Claude Code using Opus 5 and reviewed by @jwildfire
