<!-- STATUS: Drafted on 2026-07-29 06:15 EDT -->
<!-- GITHUB_PROPERTIES: Repo: Gilead-BioStats/gsm.qtl, Labels: bug, Assignee: @jwildfire -->
<!-- NOT POSTED: agents have no write access to Gilead-BioStats. @jwildfire files. -->

# `report_qtl.yaml` step 9 calls `pull` unqualified and fails unless the caller attached dplyr

`inst/workflow/4_modules/report_qtl.yaml`, line 87.

## Summary

The `strSnapshotDate` step names `pull` with no namespace. `workr:::GetStrFunctionIfNamespaced()` resolves unqualified names through the search path, so the step runs only if the calling session happens to have `library(dplyr)` in effect. Neither of the two documented ways of running module workflows does that, and the module dies at step 9 of 15 — before producing anything.

This is the only unqualified reference to a non-base function in any of the twelve module workflows in `gsm.library`'s snapshot. Every other unqualified name across those files is base R (`paste0`, `list`, `getwd`, `max`, `file.path`, `normalizePath`, `system.file`).

## The step

```yaml
  - output: strSnapshotDate
    name: pull
    params:
      .data: Reporting_Results_Longitudinal
      var: SnapshotDate
```

## Reproducible example

Clean R session. The `library()` list is exactly what `gsm.template`'s `inst/file-structure/scripts/run-snapshot.R` attaches, minus `gsm.endpoints`, `grail` and `gsm.template` — none of which declare `Depends: dplyr`, so they cannot put `pull` on the search path either.

```r
library(workr); library(gsm.mapping); library(gsm.kri); library(gsm.qtl); library(gsm.reporting)
cat("dplyr attached:", "package:dplyr" %in% search(), "\n")

mappings_wf <- workr::MakeWorkflowList(
  strNames = c("SUBJ","ENROLL","IE","PD","STUDY","SITE","COUNTRY","EXCLUSION","STUDCOMP"),
  strPath = "workflow/1_mappings", strPackage = "gsm.mapping")
mapped <- workr::RunWorkflows(
  mappings_wf, gsm.mapping::Ingest(gsm.core::lSource, gsm.mapping::CombineSpecs(mappings_wf)))
metrics_wf <- workr::MakeWorkflowList(strNames = c("qtl0001","qtl0002"),
                                      strPath = "workflow/2_metrics", strPackage = "gsm.qtl")
analyzed  <- workr::RunWorkflows(metrics_wf, mapped)
reporting <- workr::RunWorkflows(
  workr::MakeWorkflowList(strNames = c("Results","Groups","Metrics"),
                          strPath = "workflow/3_reporting", strPackage = "gsm.reporting"),
  c(mapped, list(lAnalyzed = analyzed, lWorkflows = metrics_wf)))
reporting$Reporting_Results$SnapshotDate <- as.Date("2012-03-29")

workr::RunWorkflows(
  workr::MakeWorkflowList(strPath = "workflow/4_modules", strPackage = "gsm.qtl"),
  c(mapped, reporting, list(Reporting_Results_Longitudinal = reporting$Reporting_Results)))
```

## Actual output

```
dplyr attached: FALSE

...
[INFO] Workflow Step 9 of 15: `pull`
[INFO] Evaluating 2 parameter(s) for `pull`
[INFO] .data = Reporting_Results_Longitudinal: Passing lData$Reporting_Results_Longitudinal.
[INFO] var = SnapshotDate: No matching data found. Passing 'SnapshotDate' as a string.
[INFO] Calling `pull`
Error in GetStrFunctionIfNamespaced(lStep$name) :
  Function 'pull' not found.
Calls: <Anonymous> ... RunWorkflow -> RunStep -> do.call -> GetStrFunctionIfNamespaced
Execution halted
```

Add `library(dplyr)` at the top and the same script gets past step 9. That is the whole difference.

## Blast radius

Two documented entry points run module workflows without dplyr on the search path:

**`gsm.template`, `inst/file-structure/scripts/run-snapshot.R`** — the canonical study runner. It attaches `workr`, `gsm.mapping`, `gsm.kri`, `gsm.endpoints`, `gsm.qtl`, `gsm.reporting`, `grail`, `gsm.template`, then runs *every* workflow found in `./workflow/4_modules`:

```r
module_outputs <- './workflow/4_modules' %>%
    workr::MakeWorkflowList(strPath = ., strPackage = NULL) %>%
    workr::RunWorkflows(lConfig = lConfig)
```

None of those eight packages declares `Depends: dplyr`, so none attaches it.

**`open.gismo::og_run()`** — `.og_attach_pipeline_packages()` attaches exactly `gsm.core`, `gsm.mapping`, `gsm.kri`, `gsm.reporting`. Verified: with that set attached and nothing else, `workr:::GetStrFunctionIfNamespaced("pull")` throws `Function 'pull' not found.`

A study's `workflow/4_modules` is populated from `gsm.library`, whose `snapshot-main` and `snapshot-dev` branches both carry `report_qtl.yaml` byte-identical to the copy in this repo (snapshot refreshed 2026-07-24). The module declares `Active: true`, so `MakeWorkflowList()` picks it up.

If this is not being seen in production today, the most likely explanation is that no live study has the QTL module enabled in its `4_modules` — not that the step resolves. It does not resolve under either shipped driver.

## Suggested fix

```yaml
    name: dplyr::pull
```

Matching every other non-base step in the file, and every other module in `gsm.library`.

---

This Issue was drafted by Claude Code using Opus 5 and reviewed by @jwildfire
