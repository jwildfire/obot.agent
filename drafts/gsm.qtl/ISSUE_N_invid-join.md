<!-- STATUS: Drafted on 2026-07-29 06:15 EDT -->
<!-- GITHUB_PROPERTIES: Repo: Gilead-BioStats/gsm.qtl, Labels: bug, Assignee: @jwildfire -->
<!-- NOT POSTED: agents have no write access to Gilead-BioStats. @jwildfire files. -->

# QTL0002 render fails with "object 'invid' not found" — the SUBJ/STUDCOMP join drops `invid`

`inst/workflow/4_modules/report_qtl.yaml`, lines 43–50.

## Summary

`Mapped_SUBJ` and `Mapped_STUDCOMP` both carry `invid`. The module joins them on `studyid` and `subjid` only, so dplyr disambiguates and the result has `invid.x` and `invid.y` — no bare `invid`. Six chunks of `inst/report/QTL0002.Rmd` reference `invid`, and the render dies on the first of them.

`data-raw/Example_QTL.R` does not hit this: it joins `select(Mapped_SUBJ, subjid, country)` — three columns, no `invid` — to `Mapped_STUDCOMP`, so `invid` arrives unambiguously from STUDCOMP.

## The step

```yaml
  - output: qtl0002_preprocess
    name: dplyr::left_join
    params:
      'x': Mapped_SUBJ
      'y': Mapped_STUDCOMP
      'by':
        - 'studyid'
        - 'subjid'
```

## Reproducible example

```r
library(gsm.core); library(gsm.mapping); library(gsm.qtl)

mappings_wf <- workr::MakeWorkflowList(
  strNames = c("SUBJ","ENROLL","IE","PD","STUDY","SITE","COUNTRY","EXCLUSION","STUDCOMP"),
  strPath = "workflow/1_mappings", strPackage = "gsm.mapping")
mapped <- workr::RunWorkflows(
  mappings_wf, gsm.mapping::Ingest(gsm.core::lSource, gsm.mapping::CombineSpecs(mappings_wf)))

pre <- dplyr::left_join(mapped$Mapped_SUBJ, mapped$Mapped_STUDCOMP, by = c("studyid","subjid"))
print(names(pre))
cat("\nbare `invid` present?", "invid" %in% names(pre), "\n")
cat("`invid` is in both inputs:",
    "invid" %in% names(mapped$Mapped_SUBJ), "/", "invid" %in% names(mapped$Mapped_STUDCOMP), "\n")
```

## Actual output

```
 [1] "studyid"              "invid.x"              "country"
 [4] "subjid"               "subject_nsv"          "enrollyn"
 [7] "timeonstudy"          "firstparticipantdate" "firstdosedate"
[10] "timeontreatment"      "agerep"               "sex"
[13] "race"                 "mincreated_dts.x"     "invid.y"
[16] "compyn"               "compreas"             "mincreated_dts.y"

bare `invid` present? FALSE
`invid` is in both inputs: TRUE / TRUE
```

Running the module through to the render (with `pull` qualified so it gets that far — see the companion issue):

```
[INFO] Workflow Step 15 of 15: `gsm.kri::RenderRmd`
processing file: Report_QTL.Rmd
...
4/10 [QTL0001 Eligibility]
5/10
6/10 [QTL0002 Premature Study Discontinuation]

Quitting from Report_QTL.Rmd:57-78 [QTL0002 Premature Study Discontinuation]
Error in pull(., !!enexpr(varGroupID)) :
Caused by error:
! object 'invid' not found
```

## Blast radius

The whole QTL0002 section fails and the render aborts, so no report is produced at all. QTL0001 is unaffected — `qtl0001` comes straight from `Mapped_EXCLUSION`, which keeps its own `invid`.

`invid` is referenced at `inst/report/QTL0002.Rmd` lines 25, 40, 50, 61 and 64: the site bar chart, both reasons-by-site charts, and the Discontinuation Listing's `select()`/`rename()`.

The collision is a property of the mapped specs, not of any one dataset — `gsm.mapping`'s SUBJ and STUDCOMP mappings both emit `invid`, so this reproduces on any study.

## Note on the spec block

The module's own `spec` declares only `studyid`, `subjid` and `country` for `Mapped_SUBJ`, which reads like the author intended the narrow projection that `data-raw/Example_QTL.R` uses. `workr::RunWorkflow()` calls `CheckSpec()` for validation only — it does not subset — so the full frame reaches the join.

## Suggested fix

Add `invid` to the join keys. It is a key, not a duplicate: a participant belongs to one site, and both domains agree on it.

```yaml
      'by':
        - 'studyid'
        - 'subjid'
        - 'invid'
```

Alternatively, project `Mapped_SUBJ` down to `studyid`/`subjid`/`country` before the join, which is what the working R does and what the `spec` block appears to promise.

---

This Issue was drafted by Claude Code using Opus 5 and reviewed by @jwildfire
