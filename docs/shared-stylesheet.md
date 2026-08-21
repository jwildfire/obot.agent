# The shared stylesheet

`assets/obot.css` — one copy of the visual language the decision artifacts are written in.

Requirement [jwildfire/obot.agent#15](https://github.com/jwildfire/obot.agent/issues/15). @jwildfire, 2026-08-20: *"match the css of the decision docs. Prioritize creating a shared style sheet for the project."*

## Why it exists

Seventeen of the twenty-four decision artifacts under `obot.roadmap/reports/decisions/` carry the same eleven colours, the same three font stacks and the same component names — byte-identical values, in seventeen separate `<style>` blocks. Nobody wrote that style guide; it was pasted seventeen times. This file is the paste, written once.

The seventeen were measured, not remembered:

```
--paper #faf7f0 · --panel #fffdf9 · --ink #17191c · --ink2 #454a51 · --mute #7b8089
--rule #e2dccf · --rule2 #c8bfa9 · --blue #2f6fa8 · --bronze #a95d10 · --flag #b83a2e · --go #2b7a4b
```

Every one of those appears with exactly one value across all seventeen pages. `tools/ops-dashboard/test/shared-css.test.mjs` re-measures them off the live artifacts on every run, so the sheet cannot drift from the pages it came from without a red test. When no hub clone is present (CI), that test **skips with a reason** rather than passing — a check that quietly checks nothing is the failure this program calls silent success.

## Using it

Inline it:

```js
import { OBOT_CSS } from '<obot.agent>/assets/obot-css.mjs';
// ...
`<style>${OBOT_CSS}${YOUR_LAYOUT_CSS}</style>`
```

`SHARED_CSS_PATH` is also exported for a surface that wants to `<link>` or copy the file at build time.

Prefer inlining. Decision artifacts and config cards are self-contained single files by contract — a `<link>` breaks them the moment the file travels. A genuinely multi-page site can link it instead.

Two rules:

- **Do not copy the bytes.** The string `obot shared stylesheet` is in the file header precisely so a copy is greppable.
- **Layout is yours.** The sheet carries palette, type and components. It sets no grid, no positioning and no page chrome, so it can sit under a document and under an app shell without a fight.

## The theme contract

Three states, and the sheet states the palette three times:

```css
:root { /* the FULL light palette */ }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { /* dark */ } }
:root[data-theme="dark"] { /* the same dark */ }
```

- A colour is **never** defined only inside a media or `[data-theme]` block. The test enforces it: any property in a dark block that is missing from bare `:root` fails.
- The two dark blocks must stay identical, or a toggle renders a third theme nobody designed. The test enforces that too.
- Verified in a browser, not only in the test: system-dark gives `--paper #141517`; `data-theme="light"` beats system-dark and gives `#faf7f0`; `data-theme="dark"` gives `#141517` in a light system.

None of the seventeen artifacts answered `prefers-color-scheme` at all. Every one is a white page on a phone at midnight. The dark palette here is new work, derived from the light one; the artifacts inherit it the moment they adopt the sheet.

## What is in it

**Base** — `*`, `html`, `body`, `.wrap`, `a`, `h1`–`h3`, `p`, `ul`/`ol`, `li`, `code`/`.mono`, `blockquote`, `section`.

**Masthead** — `.mast`, `.eyebrow` (+ `.dot`), `.lede`, `.facts` (+ `b`), `.cut` (the dashed section mark with a word on it).

**Four boxes, and they are not interchangeable.** The decisions README currently tells authors to paste a `.callout` and notes that pages call the same box `.callout`, `.card` or `.verdict`. They are three things:

| class | means |
|---|---|
| `.verdict` | what was concluded. One per page, near the end. |
| `.callout` | something the reader must not miss on the way past. `.good` and `.note` recolour it. |
| `.card` | one item in a set — an option, a finding, a piece of work. `.block` / `.done` recolour the tag. |
| `.q` | a question being put to the reader, with a `.rec` recommendation inside it. |

**Tables** — `.tbl` wraps `table`. Not optional: a table worth having is wider than a phone, and without its own scroller it takes the page sideways.

**Quoted output** — `.pre` for a quoted command, `.term` for a picture of a terminal (dark in both themes on purpose — it is a screen, not a surface of this page).

**Verdict words** — `.ok`, `.bad`, `.warn`.

**Footer** — `.foot`.

Tokens for measure (`--measure`, `--measure-wide`, `--measure-lede`), radius (`--radius`, `--radius-sm`, `--radius-md`) and surfaces (`--code-bg`, `--pre-bg`, `--go-soft`, `--blue-soft`, `--bronze-soft`, `--flag-soft`, `--link-rule`, `--term-*`) exist so no component rule needs a raw hex. A test asserts none does — a hard-coded colour is a colour the dark palette cannot reach.

## Consumers

Never from memory — run `obot.agent/tools/style-census` and it will tell you, because it is the same data the check runs on.

| surface | state |
|---|---|
| `tools/ops-dashboard` (all four views) | adopted. Its own token names are kept as a documented alias bridge in `SHELL_CSS`, so ~200 call sites did not have to move. |
| config cards (`tools/config-card`, `lib/config-card.mjs`) | adopted 2026-08-21. Same alias bridge, mapped identically — a card opens from the dashboard, and two surfaces of one product resolving `--accent` differently is the drift this exercise ends. |
| hub decisions landing (`obot.roadmap/scripts/build_decisions.mjs`) | adopted 2026-08-21, via the vendored copy. |
| hub briefing (`obot.roadmap/scripts/roadmap/briefing.mjs`) | adopted 2026-08-21, via the vendored copy. |
| `tools/session-hub` (the session dashboard) | registered exemption. Six of its tokens are agent-identity colours the sheet has no name for — [#296](https://github.com/jwildfire/obot.agent/issues/296). Its theme contract was fixed in place while it waits. |
| decision artifacts, requirement design docs | frozen, not converted. A dated report is a record of what was said that day, and restyling it is rewriting it. 93 reports and 18 design docs carry their own palette; the census fails if either count grows. |

## The other theme

This is the document language. The program also has an espresso keynote language — paper `#faf6f1`, espresso `#271810`, Instrument Serif — that dresses the public sites. Since 2026-08-21 it has a home too: `assets/obot-keynote.css`, which is what [#15](https://github.com/jwildfire/obot.agent/issues/15) originally asked for. (#15 was closed on 2026-08-20 by the document sheet, which is a different language, so the keynote sheet had been left with no owner and no issue.)

A correction to what this page used to say. It claimed seventeen tokens were common to `obot.roadmap/site/assets/styles.css`, `safety.viz/site/site.css` and `open.gismo/site/src/style.css` and that all seventeen carried identical values. Re-measured across the four sheets on 2026-08-21: seventeen names are common, and **fourteen** agree byte for byte. The three that do not are the font stacks, differing by quote character and by extra fallbacks — drift already under way. The shared sheet reconciles them to the union of the fallbacks, so no site loses one it had. `open.csr/site/site.css` shares one value of the seventeen, which matches its own header calling its palette deliberately different: it is a sibling theme, not a drifted copy.

The keynote sheet carries no dark palette, and that is a decision rather than an omission. The hub sheet has argued it in a comment since before this work: flipping the series colours on OS-dark while the page stayed on warm paper would put dark-surface colours on a light surface and break the contrast they were chosen for. So it commits to one look and paints it completely on bare `:root`, including an explicit `body` background. The census enforces the three-state contract on any sheet that *has* a dark block, and does not invent one for a sheet that has deliberately declined.

Adopted so far: the hub, via `@import url("obot-keynote.css")` in `site/assets/styles.css`. Still owed: `safety.viz`, `open.gismo`, `open.csr` — each a separate pull request in its own repository, because they are public sites. All three are registered exemptions.

Whether the two languages should converge is @jwildfire's call, not an agent's.

## The check

`obot.agent/tools/style-census` is the done-gate, and it is more of the deliverable than the stylesheet is. Requirement [#289](https://github.com/jwildfire/obot.roadmap/issues/289): "A check fails if any surface reintroduces its own copy."

```
obot.agent/tools/style-census            # every surface, and where its colours come from
obot.agent/tools/style-census --findings # just the problems; exit 1 if any
obot.agent/tools/style-census --md       # the Navigator's alarm form
```

What it refuses:

- A surface declaring four or more colour custom properties in one rule, unless it is a shared sheet, a vendored copy, or a dated entry in `tools/style/surfaces.mjs`. The threshold is drawn in empty space: real palettes here declare eleven or more, components declare one or two, and nothing sits between.
- An exemption with no date, no reason, or no issue that removes it. An exemption without a way out is a decision to keep the copy forever, written as if it were temporary.
- An exemption that is no longer needed. A stale entry reads as "still owed" long after the work is done.
- A dated archive that grew. You cannot fix the past; you may not add to it.
- A vendored copy whose bytes differ from the canonical sheet.
- A theme-contract fault on any surface: an unguarded `prefers-color-scheme` block with nothing later restating the light palette, or a dark theme with no explicit toggle. Three surfaces had one on 2026-08-21, all three reviewed by somebody.

Two spellings satisfy the guard, and refusing the second would be the check crying wolf at correct code. Either guard the media block as `:root:not([data-theme="light"])`, or restate the light palette in a later `:root[data-theme="light"]` block — the selectors have equal specificity, so the later wins. `open.csr` uses the second.

### Vendoring, and why a copy is allowed to exist

`obot.roadmap`'s deploy checks out `obot.roadmap` and `gh.dash` and nothing else, so a hub generator cannot import `assets/obot-css.mjs`. Importing hub code from here is separately unsafe: its `local-only-guard` patches `node:fs` process-wide on import ([#206](https://github.com/jwildfire/obot.agent/issues/206)).

So the sheets are vendored with a provenance header naming the commit they came from, and the census compares the bytes on every run. The distinction that matters is not copy versus no copy — it is whether anything is looking.

```
node obot.agent/tools/style/vendor.mjs                              # write the copies
node obot.agent/tools/style/vendor.mjs --check                      # report drift only
node obot.agent/tools/style/vendor.mjs --dest obot.roadmap:<path>   # into a worktree
```

`--dest`, and its read-side twin `OBOT_STYLE_DEST=obot.roadmap:<path>`, exist because a cross-repo change has to be verifiable before either half merges. Both halves live in linked worktrees; without an override the census reads the clones sitting on `main` and reports the work as undone, which is indistinguishable from the work actually being undone.

In CI only `obot.agent` is on the runner. Every other root is reported as not-on-this-machine and skipped — an absent clone is absence, never a defect and never a silent pass.
