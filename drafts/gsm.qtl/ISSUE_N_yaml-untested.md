<!-- STATUS: Drafted on 2026-07-29 06:15 EDT -->
<!-- GITHUB_PROPERTIES: Repo: Gilead-BioStats/gsm.qtl, Labels: bug, technical debt, Assignee: @jwildfire -->
<!-- NOT POSTED: agents have no write access to Gilead-BioStats. @jwildfire files. -->

# `report_qtl.yaml` is shipped to studies but is not run by any test, example or vignette

`inst/workflow/4_modules/report_qtl.yaml`.

## Summary

The QTL report module is distributed to studies through `gsm.library` and nothing in this repository ever executes it. The only working path to a QTL report is hand-written R in `data-raw/Example_QTL.R`, which calls `gsm.kri::RenderRmd()` directly and never touches the workflow. The two have drifted, and the workflow now carries four defects that a single smoke test would have caught.

This is the root cause of the other issues filed alongside this one — file them or not on their own merits, but the reason they exist is here.

## Evidence that nothing runs it

```
$ grep -rn "report_qtl" . --exclude-dir=.git
./pkgdown/menus/examples/Example_QTL.Rmd:52:report_qtl <- knitr::knit_child(
./pkgdown/menus/examples/Example_QTL.Rmd:57:cat(report_qtl, sep = "\n")
./inst/workflow/4_modules/report_qtl.yaml:3:  ID: report_qtl
```

The two pkgdown hits are a local variable holding knitted child output, unrelated to the workflow. `tests/testthat/` has no reference; the qualification tests `test-qual_T1_1.R`, `test-qual_T2_1.R` and `test-qual_T3_1.R` cover the `2_metrics` workflows and the analysis functions, not the module. `vignettes/IntroQTL.Rmd` does not run it.

## Evidence that it is shipped anyway

`gsm.library`'s `snapshot-main` and `snapshot-dev` branches both carry `workflows/4_modules/report_qtl.yaml`, byte-identical to the copy in this repo apart from a trailing newline. Snapshot last refreshed 2026-07-24.

`gsm.template`'s `inst/file-structure/scripts/run-snapshot.R` runs everything it finds:

```r
module_outputs <- './workflow/4_modules' %>%
    workr::MakeWorkflowList(strPath = ., strPackage = NULL) %>%
    workr::RunWorkflows(lConfig = lConfig)
```

The module declares `Active: true`, so `MakeWorkflowList()` selects it. A study that pulls the QTL module from `gsm.library` runs this file.

## The drift, concretely

| | `data-raw/Example_QTL.R` (works) | `report_qtl.yaml` (shipped) |
|---|---|---|
| SUBJ→STUDCOMP join | `select(Mapped_SUBJ, subjid, country)` joined `by = "subjid"` | full `Mapped_SUBJ` joined `by = c("studyid","subjid")` → `invid.x`/`invid.y` |
| blank-reason fill | `is.na(compreas) \| compreas == ""` | `is.na(compreas)` only |
| `pull` | `library(dplyr)` at the top of the script | unqualified `pull`, no attach guarantee |
| output dir | `getwd()` | `outputs/{SnapshotDate}`, never created |

The join and the fill diverged in commits landed **the same day**: `69401ff` touched the YAML fill, `c08bebf` — *"datasim and live studies don't quite match"* — added the empty-string case to the R and not the YAML. `622e9f6` later reshaped the R join and the YAML join stayed put.

## Also in this file, latent

Two steps use `names:` where every other step uses `name:` — line 62 (`reporting_listings`) and line 105 (`strInputPath`). These run today only because `lStep$name` partial-matches the `names` key through R's `$` semantics. `tests/testthat/test-workr-migration.R` codifies the tolerance:

```r
step_keys <- c("name", "names")
```

Not a defect now; it breaks the day `workr` reads the field with `[[`. Worth normalizing while the file is open.

## Suggested fix

Pick one:

**Cover it.** Add a smoke test that runs the module on `gsm.core::lSource` mapped through `gsm.mapping` and asserts the report renders and that `nrow(qtl0002_num)` equals the number of participants with a recorded discontinuation reason. That is roughly twenty lines, and it fails today on all four defects. Then delete the parallel listing construction from `data-raw/Example_QTL.R` and have it call the workflow, so there is one definition of the report inputs instead of two.

**Or retire it.** If the module is not meant to be used, remove it from `inst/workflow/4_modules/` so it stops being aggregated into `gsm.library` snapshots, and document `RenderRmd()` as the supported entry point.

Shipping it uncovered is the option that is not working.

---

This Issue was drafted by Claude Code using Opus 5 and reviewed by @jwildfire
