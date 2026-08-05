# gsm.qtl `report_qtl.yaml` audit — 2026-07-29

Drafts for @jwildfire to file against `Gilead-BioStats/gsm.qtl`. Agents have no write access to that org, so nothing here has been posted.

## What prompted this

A previous session claimed five defects in `inst/workflow/4_modules/report_qtl.yaml`, then cut the claim to three. @jwildfire pushed back: *"Not seeing these in production use. Did you look at how the examples in gsm.qtl manage to navigate usage?"* This audit re-ran every claim from a clean R session against gsm.qtl's own bundled inputs.

## Result

**Three defects confirmed and reproduced. One of the original three was wrong and is withdrawn. Two more surfaced that the earlier pass had ranked as "hardening".**

| # | Draft | Severity | Reproduced |
|---|-------|----------|------------|
| 1 | [`ISSUE_N_qtl0002-blank.md`](ISSUE_N_qtl0002-blank.md) | Wrong result — silent | Yes, on two independent datasets |
| 2 | [`ISSUE_N_pull-unqual.md`](ISSUE_N_pull-unqual.md) | Error — halts the workflow | Yes, under two documented drivers |
| 3 | [`ISSUE_N_invid-join.md`](ISSUE_N_invid-join.md) | Error — halts the render | Yes |
| 4 | [`ISSUE_N_outputdir.md`](ISSUE_N_outputdir.md) | Wrong output location | Yes |
| 5 | [`ISSUE_N_yaml-untested.md`](ISSUE_N_yaml-untested.md) | Root cause / umbrella | N/A |

Defects 2 and 3 stop the run before defect 1 can be seen. Fix 2 and 3 and the report renders — silently wrong. That ordering is why the wrong-result defect has survived: nobody has ever got far enough to look at the output.

## Withdrawn claim

The earlier session's headline claim was that `yaml::yaml.load()` never evaluates the `!expr` tag, so the literal string `"rlang::expr(ifelse(...))"` is written to `compreas` for every row.

**That is false.** `yaml` does return the tag as a literal string, but `workr::RunStep()` has a `parse_expr_param()` branch that matches `^(rlang::)?exprs?\(` and evaluates it before the call. The mutate runs correctly. The earlier session's own log even records it — `[INFO] compreas = rlang::expr(...): Parsed expression parameter.` — and the conclusion was drawn anyway.

The *consequence* the earlier session observed (the discontinuation listing containing the whole cohort) is real. The mechanism is different, and it is draft 1.

## Also checked, not filed

- **`names:` instead of `name:` on two steps** (lines 62, 105). Works today: `lStep$name` partial-matches the `names` key. gsm.qtl's own `tests/testthat/test-workr-migration.R` reads `step_keys <- c("name", "names")`, so the package already treats both as valid. Latent only — it would break the day workr switches to `[[`. Folded into draft 5 as a cleanup item rather than filed on its own.
- **Whether any production study actually enables this module.** Could not be established from outside Gilead. What *is* established: the file is shipped byte-identical to studies through `gsm.library` `snapshot-main` / `snapshot-dev` (refreshed 2026-07-24), and `gsm.template`'s own runner executes every workflow in `workflow/4_modules`. See draft 5.

## Evidence

Everything under [`assets/`](assets/) — copy-pasteable repro scripts, captured console output, rendered-report screenshots.

| File | What it is |
|------|------------|
| `setup_block.R` | Shared setup: builds the module's inputs from `gsm.core::lSource` via `gsm.mapping` |
| `repro_pull.R`, `repro_invid.R`, `repro_compreas.R` | One-file repros, clean R session |
| `runA.log` | Shipped module, no dplyr attached — dies at step 9 |
| `runB.log` | Shipped module, dplyr attached — reaches the render, dies on `invid` |
| `runC.log` | Two renders: shipped fill (78-row listing) vs corrected fill (8-row listing) |
| `prod_path.log` | Same failure under `gsm.template`'s `run-snapshot.R` package set |
| `listing-shipped.jpg`, `listing-fixed.jpg`, `qtl0002-overview.jpg` | Rendered consequence |

## Environment

gsm.qtl 1.3.0.9000 (`3311a4e`), workr 1.0.0, gsm.core 1.2.0, gsm.mapping 1.1.3, gsm.kri 1.5.0, gsm.reporting 1.1.5, dplyr 1.1.4, yaml 2.3.10, R 4.3 arm64, macOS.

---

Audited by Claude Code using Opus 5, for @jwildfire
