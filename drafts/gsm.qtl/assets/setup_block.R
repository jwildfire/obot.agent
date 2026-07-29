# --- shared setup: build the module's inputs from gsm.qtl's own dependencies ---
library(gsm.core); library(gsm.mapping); library(gsm.reporting); library(gsm.kri); library(gsm.qtl)

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

lData <- c(mapped, reporting, list(Reporting_Results_Longitudinal = reporting$Reporting_Results))
report_wf <- workr::MakeWorkflowList(strNames = "report_qtl",
                                     strPath = "workflow/4_modules", strPackage = "gsm.qtl")
