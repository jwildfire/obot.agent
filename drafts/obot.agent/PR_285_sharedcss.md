<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/pull/285 on 2026-08-20 20:12 EDT -->
<!-- GITHUB_PROPERTIES: Labels: none, Assignee: @me, Milestone: backlog (inherited from #15) -->

## What this does

Lands the shared stylesheet the program has needed since July, and dresses the operations dashboard in it. @jwildfire asked for both tonight, in one sentence: *"Update http://127.0.0.1:7326/ to show the html artifacts by default - just like the decisions. In fact, match the css of the decision docs. Prioritize creating a shared style sheet for the project."*

Closes #15

Seventeen of the twenty-four decision artifacts in the hub carry the same eleven colours, the same three font stacks and the same component names — byte-identical values, in seventeen separate `<style>` blocks. Nobody wrote that style guide; it was pasted seventeen times. `assets/obot.css` is the paste, written once.

The dashboard is its first consumer, and a config item now opens as the HTML card it already had rather than as a rebuild of it.

## Roadmap context

- Requirement: **#15, "Land the shared keynote stylesheet"**, filed 2026-07-11, `backlog` milestone.
- **Its stated blocker no longer holds, and has not since 2026-07-12.** The issue reads *"Blocked by: the safety.viz v1.0-push website PR (in flight 2026-07-11)"*. That is [jwildfire/safety.viz#22](https://github.com/jwildfire/safety.viz/pull/22), **merged 2026-07-12T01:41:30Z** — 39 days ago. The program noticed the same night (`obot.roadmap/reports/sessions/2026-07-11-2.html` line 234: *"obot.agent#15 keynote stylesheet: UNBLOCKED but still unowned"*) and nothing was picked up after that.
- #15's parent requirement, [jwildfire/obot.roadmap#17](https://github.com/jwildfire/obot.roadmap/issues/17), was closed as **completed** about two hours after that blocker merged, with #15's checkbox still unticked. #15 has been an open task under a closed requirement ever since.
- Board state: this PR's issue is off the ProjectsV2 board, because board writes fail for every agent credential right now — [jwildfire/obot.roadmap#252](https://github.com/jwildfire/obot.roadmap/issues/252). That is a known blocked mechanism, not an oversight here.

## Evidence

- <a href="https://github.com/jwildfire/obot.agent/blob/sharedcss/assets/obot.css">assets/obot.css</a> — the sheet, 329 lines.
- <a href="https://github.com/jwildfire/obot.agent/blob/sharedcss/docs/shared-stylesheet.md">docs/shared-stylesheet.md</a> — the usage doc: how to consume it, the theme contract, the component vocabulary, and what has not adopted it yet.
- <a href="https://github.com/jwildfire/obot.agent/blob/sharedcss/tools/ops-dashboard/test/shared-css.test.mjs">tools/ops-dashboard/test/shared-css.test.mjs</a> — 7 tests, including one that re-reads the palette off the live decision artifacts on every run.
- <a href="https://github.com/jwildfire/obot.agent/blob/sharedcss/tools/ops-dashboard/test/config-artifact-default.test.mjs">tools/ops-dashboard/test/config-artifact-default.test.mjs</a> — 4 tests holding the new config behaviour in place.
- Full CI suite: **1692 pass, 0 fail** (`node --test` over all seven test globs in `.github/workflows/test.yml`).
- Rendered and measured, not merely tested: at a real **386px** viewport, `/`, `/live.html`, `/wire.html` and `/navigator` all report `scrollWidth == viewport` — **zero horizontal overflow**, and every one of the 1,585 wide elements on the Agents tab sits inside its own `overflow-x` scroller, none loose.
- Theme contract exercised in a browser: system dark gives `--paper #141517`; `data-theme="light"` beats system dark and gives `#faf7f0`; `data-theme="dark"` gives `#141517` in a light system.

## Technical briefing

**The sheet.** Palette, type and the document components; no grid, no positioning, no page chrome, so it sits under a document and under an app shell without a fight. It carries the three-state theme contract — the full light palette on bare `:root`, the dark palette under `@media (prefers-color-scheme: dark)` guarded as `:root:not([data-theme="light"])`, and the same dark palette again under `:root[data-theme="dark"]`. No colour is defined only inside a theme block, and a test fails if one ever is. None of the seventeen artifacts answered `prefers-color-scheme` at all, so the dark half is new work derived from the light palette.

**Colours the pages hard-coded became tokens.** `#f2eee3` behind inline code (13 pages), `#f4f8f4` behind a recommendation (10), `rgba(47,111,168,.32)` under a link (all 17), and the `#1c1e22` terminal block four pages invented. A literal is a colour the dark palette cannot reach; a test now asserts no component rule names a raw hex.

**Consumption is by inlining, not `<link>`.** `import { OBOT_CSS } from 'assets/obot-css.mjs'`, which reads the one file. Decision artifacts and config cards are self-contained single files by contract, so a link breaks them the moment they travel. The string `obot shared stylesheet` is in the header so a copy is greppable.

**The dashboard's own palette definition is gone.** What replaces it is an alias block at the top of `SHELL_CSS` pointing the dashboard's token names at the sheet's — `--card` → `--panel`, `--accent` → `--blue`, `--warn` → `--bronze`, `--crit` → `--flag`, `--good` → `--go`. That is a bridge, not a second palette: each alias resolves to a token defined once, so the theme follows, and ~200 call sites did not have to move in a diff with nothing to show for it. Roles decided the mapping, not shades. One real fix fell out of it: the `.dead` fault banner was drawn in the accent colour, which under this mapping would have made an alarm blue, so it now names `--crit` explicitly.

**A config item opens as the page it already is.** `/config/<id>` has served a whole card since #263; the main pane rebuilt the same item as a form and offered the card as a link into a new tab. `lib/config-card.mjs` left that open deliberately — *"it opens beside this panel rather than replacing it ... until he has read one of these and said which he wants"*. He has now said. `renderIQ` and its CSS are gone, along with the item's prose in the page's script payload, which nothing read any more.

**The check moved to the sidebar** rather than disappearing with the form. Running a command and writing a real pass/fail down is the one thing a static card cannot do, so it lives beside the triage buttons. Doing this surfaced a latent bug in my own first cut: the panel referenced `iq.verify.text`, which the server payload never carried, so the sentence saying what the check proves would have silently rendered nothing. The payload now carries it.

**Nothing is one click in.** The page selects the top of the rail on load, so the landing view already shows an artifact and the placeholder appears only when there is nothing to open.

**Not touched:** `tools/config-card` and `lib/config-card.mjs`. Another worker owned those tonight for a separate change, so the cards keep their own warm palette and adopt the sheet in a later pass.

## Next steps

- **The cards adopt the sheet** — `lib/config-card.mjs` still defines its own warm palette with a two-state dark mode. One pass, once tonight's card work has landed, and the card and the dashboard around it become one surface.
- **The decision artifacts adopt it.** They are the pages the sheet was extracted *from* and they still each carry their own copy. The build-time inline path is the one that preserves self-containment; `obot.roadmap/reports/decisions/README.md` currently tells authors to paste a `.callout` snippet and should point here instead.
- **A question for @jwildfire, not an agent's call:** the program has a *second* theme — the espresso keynote language on the public sites — existing as four independent copies (`obot.roadmap/site/assets/styles.css` 816 lines, `safety.viz/site/site.css` sections 1–4 with an extraction seam already written at line 597, `open.gismo/site/src/style.css` 1,057 lines whose own header says it adopted safety.viz's tokens by copying *"because there was nothing to reference"*, and `open.csr/site/site.css` 2,645 lines). Seventeen tokens are common to the first three and all seventeen have identical values. Should the two languages converge, or is the document/keynote split deliberate? Landing that second sheet is mostly a file move plus a usage doc either way.
- **At 390px the opened artifact stacks below the whole rail** (~3,700px down). That is pre-existing single-column behaviour that decision artifacts have had since 2026-08-15, and reordering his todo list below the artifact is a UI decision I did not make unilaterally. Worth a yes/no.

---

Drafted by 👯🤖 W0092 (Claude Code, Opus 5).
