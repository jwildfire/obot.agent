<!-- STATUS: Drafted on 2026-08-15 -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Labels: enhancement, Assignee: @me -->

## What this is

The Operations Dashboard's second pass, all of it @jwildfire's calls this evening. "Your hands" is now **config**, and each item carries a permanent id he can quote in chat. Release candidates read `package version — what it is`. The queue rail is about a third of its old height. And the dashboard, the session hub and the Navigator are one local site with three tabs, the dashboard first.

Closes #118

## Roadmap context

Requirement: [obot.roadmap#180](https://github.com/jwildfire/obot.roadmap/issues/180) — the local page that is his todo list and where he answers decisions. This is iteration 2 of the page that shipped this morning in [#109](https://github.com/jwildfire/obot.agent/pull/109). Milestone v0.5.0.

His words:

> "OK, let's iterate on the opsdb. Let's call 'your hands' -> 'config' and give them IDs. c0001, etc. release candidate PRs should all start with a package name and a version number. I like the sidebar, but make it much mroe compact. RCs first. then decisions, then config items."

> "Also, I want the ops db and orginal ops hub to be merged. just make them 2 different tabs on the same (local) site for now. new ops db should be default view."

> "I think i almost certainly want a navigator tab in the ops db that tells me what changes each agent made to the dasboard. basically a list of issues/PRs that were created/updated by each agent."

## Evidence

Measured in Chrome at a real 390px viewport (iframe probe), same 17 rows, before → after:

| | before | after |
|---|---|---|
| queue rail height | 1681px | **626px** (−63%) |
| whole page height | 2566px | **1088px** (−58%) |
| a typical row | 101px | **23px** |
| horizontal overflow | none | none |

Also verified live: `/` serves the dashboard, `/live.html` the session hub (its own render, unchanged, news feed intact), `/navigator` the sweep; the status line resolves to `http://127.0.0.1:7326/live.html` from the marker this server now writes. 151 tests pass (`node --test` across all five suites), `obot-policy validate` clean.

## Technical briefing

**Config, with ids.** `collectBlockers` → `collectConfig`, `kind: 'blocker'` → `kind: 'config'`, and every user-facing string follows. Ids are `c0001`-shaped, claimed once at capture time by `tools/blocker-log` and stored in the list itself so they survive a reword. The next id is one above the highest in the **whole** file, retired entries included — derived, never a counter, exactly the rule `obot.roadmap/scripts/lib/decision-ids.mjs` uses for `D0001`. The nine open items are backfilled `c0001`–`c0009` in file order.

**The source file keeps its name.** `.claude/blockers.md` was not renamed. It is what the blockers-list decision artifact recommended and he approved this morning, `blocker-log` and the deploy-guard reasoning are built on it, and other sessions were appending to it while this was being written — renaming it would have been reversing his own decision to match a label change. The vocabulary he reads is the thing he changed; `lib/collect.mjs` is the single documented seam where the file becomes `kind: 'config'`, and the file header now records both.

**RC labels.** `rcLabel({repo, title, version})` derives `pkg vX.Y.Z — rest`: package from the repo, version from the title when the title names *this* package's version, otherwise from the `(Upcoming)` heading of the local clone's `NEWS.md` (no network, no token). Idempotent, so a correctly-titled PR is never doubled, and a version is never invented — with no evidence the label is the package alone. The rule for PRs written from here on is now in `docs/rc-framework.md` and `skills/rc-release-notes/SKILL.md`. Also fixes a live bug: the RC row read `pr.reason`, a field `reviews-queue` never emitted, so every row said "ready for your call" whatever the sweep found (it is `why`).

**Density.** A row is one line — an id chip and the sentence. The kind label above every row is gone (the group heading and the coloured left edge already say it), the secondary line moved into the row's tooltip, the three explanatory paragraphs became one, and padding/type came down throughout.

**One site.** The ops server is the site: `/` (default), `/live.html` + `/session` (the session hub inside a shell that carries the same header), `/session/frame` (its render, byte-for-byte — an iframe, so neither generator changed), `/navigator`. Port **7326** kept; the session hub's own `--serve` is no longer used and its watch loop should run without it. This server now writes `.claude/session-hub/serve.json` — same `{port, pid, url}` contract session-hub wrote — so the status-line link resolves to the session tab with the status line unchanged. `--port 0` now reports the bound port rather than 0.

**Navigator tab.** Renders `.claude/session-hub/navigator-state.md` fresh on every request. It honours that file's own stale rule: a `swept:` stamp older than three cadences means the observer is dead, and the tab says so with the restart command instead of presenting the content as current. Per-agent attribution is deliberately absent — every agent-authored issue and PR is authored by `obotclaw[bot]`, so "which agent" is not derivable from GitHub and needs a join against the scratchpad's per-sibling lines. The seam is the parser: **every** `##` section renders, so when the sweep starts writing `## By agent`, this tab shows it with no change here.

## Next steps

- The two open RCs violate the new title rule. Not retitled here — they are his to retitle:
  - `gh pr edit 52 -R jwildfire/gsm.safety --title "gsm.safety v1.1.0 — the participant-level metrics phase"`
  - `gh pr edit 10 -R jwildfire/open.gismo --title "open.gismo v0.2.0 — local-first engine + the study site"`
- Per-agent ledger: 👯🤖 navcloseout owns the attribution model; this tab is ready for its section.
- The running server should be restarted from `main` after this merges.

---

This PR was drafted by Claude Code using Opus 5 and reviewed by @jwildfire
