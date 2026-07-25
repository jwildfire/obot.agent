<!-- STATUS: Posted to https://github.com/jwildfire/safety.viz/pull/111 on 2026-07-25 00:07 EDT -->
<!-- GITHUB_PROPERTIES: Assignee: @me, Reviewers: @jwildfire -->

## Summary

The 13 renderer requirement matrices move out of obot.agent and into this repo under `requirements/`, so a behavior change and the requirement rows that describe it land in **one** PR instead of two coordinated ones across two repos.

Refs jwildfire/obot.roadmap#64

Nothing about how requirements resolve changes — only where the extractor reads the Markdown from. The companion obot.agent PR that removes the upstream copies is jwildfire/obot.agent#48; **merge this one first** (see Merge order).

## Reviewer notes

**UAT — what to look at.** The user-visible surface is the evidence pages, and the claim is that they are unchanged. Compare any module's evidence page on the preview against the current dev site — for example [histogram evidence](https://jwildfire.github.io/safety.viz/histogram/evidence.html) and [hep-explorer evidence](https://jwildfire.github.io/safety.viz/hep-explorer/evidence.html):

- Every requirement ID and the requirement text under it should be identical. That was checked mechanically, not by eye: 1 105 rendered `req-ids` / `req-text` blocks across all 11 evidence pages are byte-identical before and after.
- The only intended difference is where the links point. "Requirement matrix ↗" at the top of each evidence page, and every ID link in the **Source matrix rows** column, now open `requirements/<matrix>.md` in this repo instead of obot.agent.
- The gallery's queue strip, the About page and the Architecture page used to credit the matrices to `safety.agent` — a repo name retired in the July identity consolidation. They now link to `requirements/` here.
- New: [`requirements/README.md`](requirements/README.md) — the index, the ID-resolution rules, and the one-PR workflow.

**Code-review anchors.**

- `scripts/requirements.mjs` — the only behavioral change in the extractor: `REQUIREMENTS_SRC` defaults to the in-repo `requirements/` instead of `../obot.agent/docs/requirements`. The env var survives as an escape hatch; every other branch of the CLI is untouched.
- `scripts/requirements-lib.mjs` — comment-only. The ID regex (`/^[A-Z]{2,4}-[A-Z]+-\d+[A-D]?$/`), the cell splitting, and the freshness comparison are deliberately byte-for-byte unchanged, because the extracts and therefore the evidence pages depend on them.
- `.github/workflows/ci.yml` — the `actions/checkout` of `jwildfire/obot.agent` into `.requirements-src` is deleted. The guard now always has a source, so a matrix edit with a stale extract **fails** the build instead of falling through to the "source unavailable, validate shape only" branch.
- `site/config.json` — `matrixBaseUrl` uses `blob/HEAD`, not `blob/main`, so the links resolve on the default branch the moment this merges rather than 404ing until the next dev→main release.
- `.prettierignore` — `requirements/*.md` is excluded (its README is not). Formatting the matrices would repad every table row, add a ~540 KB reformat on top of the move, and make "did any requirement text change?" unreviewable.
- `requirements/*.md` — copied byte-for-byte from obot.agent. Filenames are unchanged, which is why `site/config.json`'s per-renderer `matrix` mapping needed no edits.

**Security.** No dependency, runtime, or published-bundle changes: this touches build-time scripts, Markdown, and CI configuration only. CI now checks out one repository instead of two, which is a small reduction in supply-chain surface.

## Roadmap context

[obot.roadmap#64](https://github.com/jwildfire/obot.roadmap/issues/64) — *move safety.viz requirement matrix out of obot.agent*, promoted from [discussion #63](https://github.com/jwildfire/obot.roadmap/discussions/63). The issue's Design section carries the full inventory, the tooling-ownership split, the cutover plan, and the rejected alternatives. Board: Requirement Gathering → Design → Development.

The friction it removes is concrete: safety.viz#108 (axis-limit prefill) needed obot.agent#43 (12 AXIS rows) merged in sequence and then an extract regen on dev; tonight's safety.viz#110 needed obot.agent#47 the same way. This is the last time that has to happen.

## Evidence

- **Extract parity** — all 11 committed `docs/requirements/*.json` regenerate byte-identical from the relocated matrices (`diff -r` against the pre-move build: no differences).
- **Evidence-page parity** — the site was built before and after and compared page by page. After normalizing the matrix-location URLs, every page is identical except the three prose blocks listed above. Requirement rendering specifically: 140 + 75 + 78 + 205 + 114 + 97 + 108 + 53 + 74 + 93 + 68 = 1 105 requirement blocks, all identical.
- **Freshness guard** — `npm run requirements:check` passes against the in-repo source, reporting all 11 modules fresh.
- **Suites** — 936 unit tests pass; `npm run site` builds with all internal links verified; `npm run evidence:check` and `npx prettier --check .` clean.
- The published evidence pages this protects: [histogram](https://jwildfire.github.io/safety.viz/histogram/evidence.html) · [hep-explorer](https://jwildfire.github.io/safety.viz/hep-explorer/evidence.html) · [participant-profile](https://jwildfire.github.io/safety.viz/participant-profile/evidence.html)

## Technical briefing

**Why the extracts stay where they are.** There are two artifacts, and the move separates them cleanly: `requirements/<renderer>.md` is authored (the reviewed source of record), `docs/requirements/<module>.json` is generated (what the site build reads). Leaving the generated path alone means `scripts/site.mjs`, the evidence page renderer, and every committed extract are untouched — the diff is honestly a file move plus one default path.

**Why resolution semantics could not drift.** The evidence page joins a test's declared requirement IDs against the extract's `{ id: text }` map by exact match. Split rows (`SH-FUNC-012A`/`012B`) and IDs shared across modules resolve individually and otherwise degrade to IDs-only — deliberate behavior that would be easy to break by "improving" the parser during a move. The parser was therefore not touched at all, and the byte-identical extracts prove it: same input text, same regex, same output.

**The hep-gaps rows.** The snapshot was taken from obot.agent#47's branch rather than `main`, so the 21 rows filed tonight for #110 (`HEP-QUAD-006/007/008`, `HEP-MARG-001..003`, `HEP-CTRL-013..016`, `HEP-CAUTION-001`, `HEP-DROP-001..003`, `HEP-IMPUTE-001..003`, `HEP-DISPLAY-006`, `HWF-BOX-005..007`) travel with the matrices instead of being stranded upstream. hep-explorer goes 111 → 128 rows, hep-waterfall 54 → 57, extracts regenerated to match. This makes the relocation safe in either order: if obot.agent#47 merges, the rows are already here; if you would rather close it as superseded, nothing is lost.

**Merge order.**

1. jwildfire/safety.viz#110 — hep-gaps implementation (already ready for review)
2. jwildfire/obot.agent#47 — its matrix rows *(optional: those rows are already carried here, so #47 can instead be closed as superseded)*
3. **this PR** — the relocation; from here the in-repo matrices are the source of record
4. jwildfire/obot.agent#48 — removes the upstream copies and leaves the pointer

Only step 3-before-4 is load-bearing. Merging the obot.agent removal first would break this repo's CI for the gap, because the guard would still be checking out a directory whose matrices are gone.

## Next steps

- After both merges: `npm run requirements` on `dev` should be a no-op — the one-line confirmation that the cutover is complete.
- From then on, adding a requirement is: edit `requirements/<matrix>.md`, run `npm run requirements`, commit the regenerated extract with the implementation and its tests. One PR, one review.
- Not done here, deliberately: no matrix *content* was edited, and no row was re-typed, split, or re-worded. Every existing row's open follow-ups (`needs-jeremy-review`, `planned` rows covered by tests but not re-typed) carry over untouched.

---

*This PR was drafted by Claude Code using Opus 5 (👯🤖 matrix-move, overnight session 2026-07-24) and reviewed by @jwildfire.*
