<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/pull/149 on 2026-08-16 23:15 BST -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Assignee: @me -->

## Both dashboard pages now read for someone who was not present

@jwildfire asked for the sessions and Navigator pages to stop reading like audit logs for bots: the Navigator tab becomes the release metrics he named, the Agents tab becomes a brief with a what-changed feed, and the log becomes an actual table at its own address. Nothing the old pages carried is deleted — every element moved to where its actual reader looks for it.

Closes jwildfire/obot.roadmap#219

## Roadmap context

Requirement jwildfire/obot.roadmap#218 (the dashboard reads like a news feed, not an audit log), task jwildfire/obot.roadmap#219, both under goal jwildfire/obot.roadmap#73. His words, 2026-08-16: "They read like audit logs for bots right now. I want them both to be more like news feeds. I'd lean towards making the audit log an actual table. Nav is also pretty unreadable. Maybe actually turn that into metrics. Show me key release metrics (issues/PRs created by type, releases, decisions, etc) in the last 1/3/7/30/365 days." Both leanings are built literally: the metrics page, and the log as tables. Also fixes the dashboard half of the sessions-tab scope reopened as obot.agent#147's parent (hub#199), and records a dead-alarms defect on obot.agent#129.

## What changed, page by page

- /navigator — release metrics first: issues and PRs created by class, releases, decisions, over 1/3/7/30/365 days, counted from GitHub and the decisions record (never from a page's own view of itself), age on the page, epochs named — a flat line implying a quiet year is worse than an empty panel that says when measurement began. Below it, the sweep's typed events as a day-grouped what-changed feed. The full sweep record — RC queue, delivery verdicts, discipline findings, the unknown-section seam — lives whole at /navigator/record.
- /session — the brief: headline tiles, the what-changed feed (delivery verdicts, his-authority Navigator calls, worker claims, deaths with the agent's own last words, and what landed on GitHub), then only running and ended-badly, then one line of counts linking the record. The last-look phrase now renders in this header too.
- /session/log — the log as an actual table: every agent grouped by outcome, and the delivery record rendered from its typed journal — the old path lost 60 of 84 records to a roster join (seven verdicts on aged-out jobs, every call line invisible). The old live view moved here, collapsed and explained.
- Four wired alarms can now reach a page: the state parser kept only headings and bullets, so the config-ledger verdict, worker-ledger verdict, delivery-gap prefix and discipline headline were discarded before rendering — every five minutes, never once visible. Alarms banner on both Navigator views; clean verdicts are quiet small print. A FAILED-but-recent sweep now gets a banner instead of literal asterisks in small grey print.
- Metrics classifiers verified against measured history: PR lanes guarded by each repo's branch-model epoch (base-role alone over-counted the release lane 29 against a true 20), stacked feature-branch PRs get their own small bucket, hub issues keep their planning taxonomy with an honest unclassified data-quality row, and decision windows count calendar days and say so.

## Evidence

- 270 tests pass across both suites (tools/navigator, tools/ops-dashboard), including new guards: the MAX_EVENTS cap, event ref/url/ts fields, the alarm-note parser, the day-grain windows, the brief-vs-record split, and the seam contract on /navigator/record.
- Verified in a real browser at a 390px viewport (iframe probe) and at desktop, on live data: metrics table holds all six columns at 390px with no horizontal overflow, both ledger verdicts and the discipline headline render for the first time, the feed interleaves all four sources with per-source provenance stamps, and the delivery tables carry linked references.
- Live seed run of the collector: 7 repos, 325 issues + 221 PRs + 22 releases + 18 decisions in 14.5s, zero errors, zero truncation; the reseeded cache agrees with an independent recon derivation on every figure (20 RC / 198 standard / 3 stacked; 99 requirement / 5 goal / 13 bug / 192 task+audit / 17 unclassified).
- The commissioned audience inventory ships in this PR: drafts/obot.agent/NOTE_audience-inventory_sessions-navigator.md — every element of both pages, who it served, where it lives now.

## Technical briefing

- tools/navigator/metrics.mjs — pure classifiers and moving windows plus a gh-facing collector; the sweep refreshes .claude/session-hub/cache/metrics.json hourly on its five-minute ride (sole-writer discipline preserved; a failed refresh keeps the old cache and its honest fetchedAt; pagination caps that hit early are returned as bounds, never swallowed).
- tools/navigator/sweep.mjs — events keep type, ref, url and a full ISO ts beside the sentence; the snapshot remembers 60 events while the state file still shows 15.
- tools/ops-dashboard/lib/metrics-view.mjs — the metrics table and the shared feed renderer (day groups; an event from before the ts field claims no day it cannot prove).
- tools/ops-dashboard/lib/feed.mjs — the session feed as a second projection over the four sources plus the gh-sweep cache; the roster model is untouched.
- tools/ops-dashboard/lib/navigator.mjs — the parser keeps preamble notes, plain lines and ### headings, alarm-flagged on the sweep's own uppercase bold forms (case-sensitive: "94 findings" is a count).
- tools/ops-dashboard/lib/log-view.mjs — the delivery tables from the typed journal, references linked after escaping.
- roster-view gains briefParts(); rosterHtml and the arity-guarded agentRow are unchanged and still carry /session/log.

## Next steps

- Merge on the standard lane (obot-merge; integration branch, non-RC), then: pull obot.agent main on the workstation and restart the dashboard server so it serves this code — it currently serves a three-merge-old build and says so. The launchd sweep picks the new code up on its next run once main is pulled.
- His feedback drives the next iteration on the live pages; the parked alternative (a watchstander's board — what needs him now, exceptions only) is noted with the Navigator, not built.
- Follow-ons deliberately not widened into this change: serving-commit provenance on the Agents header, and a structural (non-positional) carrier for sweep verdicts (obot.agent#129).

---

This PR was drafted by 👯🤖 W0012 (Claude Code using Fable 5) and reviewed by 🧭🤖 obot-navigator; posted by obotclaw[bot].

Worker: W0012
