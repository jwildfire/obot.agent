<!-- STATUS: Drafted on 2026-07-29 06:15 EDT -->
<!-- GITHUB_PROPERTIES: Repo: Gilead-BioStats/gsm.qtl, Labels: bug, Assignee: @jwildfire -->
<!-- NOT POSTED: agents have no write access to Gilead-BioStats. @jwildfire files. -->

# `report_qtl.yaml` never creates `outputs/{SnapshotDate}`, so the report is written to `tempdir()`

`inst/workflow/4_modules/report_qtl.yaml`, lines 95–103.

## Summary

The module builds `outputs/{SnapshotDate}` and normalizes it, but never creates it. `normalizePath()` defaults to `mustWork = NA`, so a missing directory is a warning rather than an error and the un-normalized relative path is passed on. `gsm.kri::RenderRmd()` then finds it unwritable and silently redirects the report to a session temp directory, which is discarded when R exits.

No error, no failed run — just no report where the pipeline says reports go.

## The steps

```yaml
  - output: strOutputDir
    name: file.path
    params:
      outputs: outputs
      SnapshotDate: strSnapshotDate
  - output: strOutputDir
    name: normalizePath
    params:
      path: strOutputDir
```

## Reproducible example

Run the module on a machine where `outputs/{SnapshotDate}` does not already exist — i.e. any first run. Setup as in the companion issues, then:

```r
workr::RunWorkflows(
  workr::MakeWorkflowList(strNames = "report_qtl",
                          strPath = "workflow/4_modules", strPackage = "gsm.qtl"),
  lData)
```

## Actual output

```
[INFO] Workflow Step 12 of 15: `normalizePath`
[INFO] Calling `normalizePath`
[INFO] character of length 1 saved as `lData$strOutputDir`.
...
[INFO] Workflow Step 15 of 15: `gsm.kri::RenderRmd`
[INFO] Calling `gsm.kri::RenderRmd`
You do not have permission to write to outputs/2012-03-29. Report will be saved
to /var/folders/_9/_l3b4x016gjbd376c37kpp580000gn/T//RtmplwIX8B
...
In addition: Warning message:
In (function (path, winslash = "\\", mustWork = NA)  :
  path[1]="outputs/2012-03-29": No such file or directory
```

`outputs/2012-03-29` is a relative path that was never created; `normalizePath()` returns it unchanged with a warning, and the report lands in `RtmplwIX8B`.

## Blast radius

Every first run in a fresh working directory. The message is not an error and does not stop the pipeline, so an automated snapshot run reports success with the report written somewhere that is deleted on exit.

`gsm.template`'s `inst/file-structure/outputs/README.md` documents the intended convention — *"`outputs/{SnapshotDate}/`: contains one output per module workflow under `workflow/4_modules`"* — so the path the module builds is right; only the creation is missing.

`report_qtl.yaml` is the only module in `gsm.library`'s `4_modules` that constructs a nested output path. The other two that set `strOutputDir` at all (`report_eligibility.yaml`, `report_prematuredeath.yaml`) use `getwd()`, which always exists.

## Suggested fix

Create the directory before normalizing it:

```yaml
  - output: strOutputDir
    name: file.path
    params:
      outputs: outputs
      SnapshotDate: strSnapshotDate
  - output: created
    name: dir.create
    params:
      path: strOutputDir
      recursive: true
      showWarnings: false
  - output: strOutputDir
    name: normalizePath
    params:
      path: strOutputDir
```

Passing `mustWork: true` to `normalizePath` instead would at least turn the silent redirect into a loud failure, but creating the directory is what the pipeline actually wants.

---

This Issue was drafted by Claude Code using Opus 5 and reviewed by @jwildfire
