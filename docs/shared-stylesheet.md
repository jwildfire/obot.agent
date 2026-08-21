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

| surface | state |
|---|---|
| `tools/ops-dashboard` (all four views) | **adopted.** Its own token names are kept as a documented alias bridge in `SHELL_CSS`, so ~200 call sites did not have to move. |
| config cards (`tools/config-card`, `lib/config-card.mjs`) | not yet — a separate change owned another worker the night this landed. They still carry their own warm palette. |
| decision artifacts, requirement design docs | not yet. ~103 hub pages carry ~17,700 lines of inline `<style>` between them. |

## The other theme

This is the **document** language. The program also has an espresso **keynote** language — paper `#faf6f1`, espresso `#271810`, Instrument Serif — that dresses the public sites, and it exists as four independent copies: `obot.roadmap/site/assets/styles.css` (816 lines), `safety.viz/site/site.css` sections 1–4 (576 lines, written with an explicit extraction seam at line 597), `open.gismo/site/src/style.css` (1,057 lines, whose own header says it adopted safety.viz's tokens by copying "because there was nothing to reference"), and `open.csr/site/site.css` (2,645 lines, same architecture, deliberately different palette).

Seventeen tokens are common to the first three, and all seventeen carry identical values. That sheet still has no shared home, and landing it is mostly a file move plus a usage doc. Whether the two languages should converge is @jwildfire's call, not an agent's.
