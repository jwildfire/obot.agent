<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/pull/110 on 2026-08-15 10:58 EDT -->
<!-- GITHUB_PROPERTIES: Labels: enhancement, Assignee: obotclaw[bot], Milestone: none-fits (v0.5.0 milestone not present in obot.agent; NEWS.md v0.5.0 (Upcoming) section carries the release grouping) -->

## Summary

A review on any release candidate is now noticed within five minutes, with nobody arming anything: this PR adds the Navigator's first capability — a scheduled RC-review sweep that discovers RC PRs across every policy.json repo, records reviews/comments/state changes with provenance stamps, and writes the file 🎩🤖 obot-prime reads as a warm source.

Part of [obot.roadmap#157](https://github.com/jwildfire/obot.roadmap/issues/157) — deliberately not `Closes`: hub Requirement issues close via release promotion under the policy contract (`issueCloses.except`), and #157's remaining scope is being split per the single-release rule.

## Roadmap context

- [obot.roadmap#157](https://github.com/jwildfire/obot.roadmap/issues/157) — Navigator requirement (goal #73), scoped day-one to bookkeeping/verification only, per C2 of the approved [prime context-management decision](https://jwildfire.github.io/obot.roadmap/reports/decisions/2026-08-14-prime-context-management/).
- C2-b is the binding shape: a file-writing verifier prime reads at near-zero cost — never a service prime must interrogate. `tools/prime-rehydrate` (obot.agent#91) already bundles `navigator-state.md`; this PR makes the file exist and stay true.
- Motivating failure (2026-08-15): @jwildfire's CHANGES_REQUESTED review on safety.viz#131 at 08:29Z sat unseen for hours — coverage was a manual per-RC Monitor step, and Monitors die with the session. Both defects are fixed here: discovery is automatic from `scripts/policy.json` (a new repo entry is swept next run, no code change), and the schedule is launchd, not a session.

## Evidence

- Live acceptance run: the sweep discovered all three live RCs ([sv#131](https://github.com/jwildfire/safety.viz/pull/131), [gs#52](https://github.com/jwildfire/gsm.safety/pull/52), [og#10](https://github.com/jwildfire/open.gismo/pull/10)) from policy.json alone and surfaced sv#131's CHANGES_REQUESTED review with body excerpt, stamped `[verified gh 10:41]`; a second run produced zero duplicate events.
- 125/125 tests green locally (112 existing + 13 new), `obot-policy validate` clean; the new suite is added to the CI glob.

## Technical briefing

- `tools/navigator/sweep.mjs` — one sweep: policy.json → repo list with release roles; `gh pr list` per repo; RC = non-draft AND (release-role base OR review requested from @jwildfire OR reviewDecision set); per RC one `gh pr view` (reviews, comments) + one REST call (inline comment count); diff vs `cache/navigator-rc.json` → events (new review, new RC, RC merged/closed, comment growth, decision change); writes `{workspace}/.claude/session-hub/navigator-state.md` with a proof-of-life header (`swept: … · cadence 5m · ok/FAILED`) and `[verified gh HH:MM]` on every line; events also append to the session scratchpad as `🧭🤖 nav` lines (capped 5/sweep).
- Failure contract: a failed sweep never looks fresh — the header says FAILED and names the last good sweep; a repo whose listing fails keeps its previous entries and emits no false rc-gone events. Pure core (classify/diff/render) is exported and unit-tested.
- `tools/navigator/install-launchd` — installs `com.obot.navigator-sweep` (StartInterval 300, RunAtLoad, absolute node/gh paths baked in) so the observer survives session death and reboot; `--uninstall` provided.
- `skills/session-prime/SKILL.md` — navigator-state.md added as warm source #2 with the stale rule (header older than 15 min = dead observer: say so, verify with one bounded `gh` call, `launchctl kickstart` to restart); per-RC review Monitors retired, Monitors reserved for one-off non-RC waits inside a live exchange; two-files-one-writer-each contract stated (Navigator never writes prime-state.md, prime never writes navigator-state.md).
- Cadence 5 min: @jwildfire reviews from his phone and expects a response within the same working session; 5 minutes bounds worst-case notice well inside that, at ~13 `gh` calls per sweep (~160/hr, far under rate limits).

## Next steps

- Run `bash tools/navigator/install-launchd` from the main checkout post-merge (done in the same session that opened this PR — see the scratchpad log).
- hub#157 Design section updated and the phase-2 scope (working-set claim verification beyond RCs) split to its own requirement per the single-release rule.

---

This PR was drafted by Claude Code using Fable 5 in an unattended sibling session (👯🤖 nav) under the standing operating contract; @jwildfire commissioned the capability in-session on 2026-08-15.
