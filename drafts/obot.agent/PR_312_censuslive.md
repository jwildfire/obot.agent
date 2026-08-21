<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/pull/312 on 2026-08-21 16:05 EDT -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0 -->

The style census had no caller. It was named in no workflow, no sweep and no script — only in its own tests and its own documentation — so it ran when a human typed it and at no other moment. It now runs on every pull request and every five minutes, and the first honest run found real drift.

Closes #311

## Roadmap context

[jwildfire/obot.roadmap#289](https://github.com/jwildfire/obot.roadmap/issues/289) — one stylesheet for every surface he reads, and a check that keeps it that way. Its Done-when says: *"A check fails if any surface reintroduces its own copy."*

A check nobody invokes cannot fail. So #289 read as delivered — the census written ([#295](https://github.com/jwildfire/obot.agent/issues/295)), its tests passing, three honest run states added this morning ([#309](https://github.com/jwildfire/obot.agent/issues/309)) — while the property it exists to protect was unguarded. That is this program's defining defect: an operation that reports success while doing nothing.

## Two callers, because the two vantage points can do different things

| caller | sees | can it stop a merge |
|---|---|---|
| `.github/workflows/test.yml` step **Style census** | `obot.agent` alone — four of the nine declared roots are absent on the runner and always will be | yes, on every PR and every push to `main`/`stable` |
| `tools/navigator/style.mjs`, in the five-minute sweep | all nine roots, which exist together on no other machine | no — it reports into `navigator-state.md` and from there onto the Operations Dashboard |

Neither alone satisfies the requirement. CI can never watch `safety.viz` reintroduce a palette, because that clone is not on the runner and never will be. The sweep can never block the pull request that does it.

Both run the same command, `tools/style-census --md`, so the gate and the detector cannot disagree about what a surface is.

## Evidence

**The gate goes red, then green.** A scratch copy of the hub, pinned in with `OBOT_STYLE_DEST` so the run is isolated from the ambient drift below. The command is the workflow's own line, verbatim.

```
$ node tools/style-census --md                            # scratch hub clean, all nine roots read
Every declared surface was read, and every one accounts for its colours.          exit 0

$ echo ':root{--paper:#faf6f1;--espresso:#271810;--accent:#b4470e;--rule:#e3ddd4;--muted:#6b5d4f}' > .../site/newpanel.css
$ bash -eo pipefail -c 'node tools/style-census --md | tee -a "$GITHUB_STEP_SUMMARY"'
**STYLE CENSUS GAP** — 1 surface not accounted for.
- obot.roadmap/site/newpanel.css — unregistered palette: declares 5 colour tokens at :root (line ~2)   exit 1

$ rm .../site/newpanel.css && (same command)                                                            exit 0
```

The sweep section, same two states: `state: drifted ms: 97` → `state: clean ms: 98`.

**The pipefail trap, measured rather than asserted.** GitHub's default `run:` shell is `bash -e {0}` with no `pipefail`, so a piped census exits with `tee`'s status:

```
(drift present)  bash -e            -c 'census --md | tee …'   → exit 0    ← the gate silently stops gating
(drift present)  bash -eo pipefail  -c 'census --md | tee …'   → exit 1
```

That is why the step declares `shell: bash`. `tools/style/test/gate.test.mjs` asserts it, and separately extracts the workflow's own `run:` line and executes it red and green — so the proof is in the suite, not only in this description.

**`unknown` survives both trips.** Simulated CI by copying this repo alone into a directory with no siblings:

```
$ node tools/style-census --md | tee -a "$GITHUB_STEP_SUMMARY"
Clean for what could be read. 7 declared roots and 8 registered claims were not on this
machine and went unexamined — unknown, not clean.
… all fifteen named, one per line …
exit 0
```

Exit 0, because nobody on the runner can fix an absent clone and a check that is red for an unfixable reason is a check somebody switches off. But the run's summary page carries that sentence, so the green tick does not get to mean "no drift" on its own. In the sweep, the same state renders with no `ALARM_RE` match; a census that could not run at all renders `**STYLE CENSUS BROKEN**`, which does alarm.

**It reaches the dashboard.** `parseNavigatorState` renders a `Style census` section with 9 items and flags exactly one alarming line.

## Technical briefing

- `tools/navigator/style.mjs` — `collectStyle()` spawns `tools/style-census --md` with a 20s timeout, and returns `{read, md, state, ms}`. `state` is derived from the census's own words (exit 1 = drifted; the `unknown, not clean` sentence = unknown) rather than recomputed, so there is no second copy of the verdict to drift. Four things land in `read: false` — a timeout, a missing tool, a non-0/1 exit, and output that is not the census's — and every one renders as broken rather than as clean.
- Spawned, not imported, for two reasons. The sweep is synchronous end to end, so an in-process walk could not be interrupted and its cost would be whatever the directories happen to be; `spawnSync` with a timeout is a bound that is enforced. And spawning means the sweep runs the same code path CI runs. Measured over all nine roots: 0.55s cold, 0.36s warm, against a pass that takes about half a minute. No cache — a cached `clean` presented as current is the defect class this requirement is about — and the cost is printed in the section, so a slowdown becomes visible rather than inferred from a sweep that stopped arriving.
- `sweep.mjs` renders it after Constraints, because those three sections ask one question of different material: whether an artifact's claim is still true, whether his words are visible to the party judging against them, and whether the surfaces he reads still agree with each other. The section renders every sweep, clean or not. Both paths that write `navigator-state.md` run it, including the early-failure path — the one that runs when `gh` is down, and the one a reader is most likely to be looking at. The sweep's own log line gains `· style: clean (432ms)`, which is the only record that would show the check having quietly stopped.
- `MD_HEADING` is exported from `tools/style/census.mjs` and used by the CLI and by the sweep's broken form, so one reading cannot end up under two headings and give the dashboard a tab that is always empty.
- One existing test changed. `reintroducing a palette into an adopted surface turns the census red` asserted a globally clean workspace as its precondition, so a real finding anywhere disabled the test that proves the check can fail — at exactly the moment somebody would want to trust it. It now asserts the delta. The absolute assertion is the test above it, which is untouched and is currently red about the hub, which is correct.

## Drift the first honest run found, left standing

`obot.roadmap/scripts/lib/premise-status.mjs` declares six colour tokens at `.pcx` (line ~397) and is registered nowhere. It arrived with the premise-strip work, after the shared sheet landed.

It is not registered, not allowlisted and not baselined away. An exemption written to make a first run green is how a gate becomes inert a second time. The consequence is stated rather than hidden: `node --test tools/style/test/*.test.mjs` is red on any machine with the hub cloned and green in CI, where the hub is absent — which is the same blindness this pull request is about, one layer up. The full suite here is 1876 tests, 1875 passing, that one failing, and it failed identically on `origin/main` before this branch existed.

`safety.viz`, `open.gismo` and `open.csr` still carry their own palettes and remain registered exemptions under [#296](https://github.com/jwildfire/obot.agent/issues/296). Untouched: they are published sites and belong in their own repositories' pull requests.

## Next steps

- The hub-side palette in `premise-status.mjs` wants an issue in `obot.roadmap` — either adopt the shared sheet or register it with a date and a way out. 🧭🤖 Navigator has it.
- #296 still carries the three public sites' adoption, which is the remaining #289 item.
- Report writers still have no shared-sheet path, which is [#300](https://github.com/jwildfire/obot.agent/issues/300), and is what keeps the archive ratchet moving.

---

Drafted by 👯🤖 W0108 using Opus 5. NOT reviewed by @jwildfire.
