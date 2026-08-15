<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/pull/83 on 2026-08-14 22:30 CEST -->
<!-- GITHUB_PROPERTIES: Assignee: @me, Labels: none, Milestone: none -->

## Executive summary

Records @jwildfire's 2026-08-14 goal review in the three places that govern autonomous work: the goal registry, a written review contract, and the session bookend that delivers against it.

- **Active goals:** charts [#78](https://github.com/jwildfire/obot.roadmap/issues/78), app [#79](https://github.com/jwildfire/obot.roadmap/issues/79), autonomy [#73](https://github.com/jwildfire/obot.roadmap/issues/73).
- **Paused:** csr [#112](https://github.com/jwildfire/obot.roadmap/issues/112) and keynote [#72](https://github.com/jwildfire/obot.roadmap/issues/72) — held, not retired. Both issues stay open, open.csr keeps its `auto` profile, and un-pausing is a one-word change.
- **keynote is registry-listed for the first time** — it had never been in `registry.json`, so it was invisible to `--auto` by accident rather than by decision. Now the hold is explicit.
- **`docs/rc-framework.md`** writes down the review contract: he reviews release-candidate PRs and decision artifacts, and nothing else.
- **The wrapup now delivers that contract.** Every wrapup output — checkpoint page, diary entry, `--auto` morning digest, closing chat response — opens with **🚦 Release candidates needing review**, then **🧭 Decisions needed**, each a bulleted list of one-line items linking their PR or draft release and their hub demo or decision artifact. The work log moves below them.

## Roadmap context

- Goal: autonomy [#73](https://github.com/jwildfire/obot.roadmap/issues/73) — this is the review-gate half of the scheduled-work model.
- Related requirements, neither superseded: [#122](https://github.com/jwildfire/obot.roadmap/issues/122) (scheduled autonomous sessions) carries the scheduler; [#123](https://github.com/jwildfire/obot.roadmap/issues/123) (release scaffolding) owes the design pass that will supersede this doc's v1 status.
- The wrapup half answers the 2026-08-14 session directly: three siblings produced two RCs and three decision artifacts, and all five were reachable only by reading past a work log. Requirement [#148](https://github.com/jwildfire/obot.roadmap/issues/148) owns the wrapup's shape; this changes what it leads with, not its clocks.
- `goals/registry.json` sits inside the policy-file carve-out, so this PR merges on the attested lane against his in-session direction.

## Evidence

- Registry is consumed by `scripts/obot-auto` line 93 — selection requires `status == "active"`, so `paused` removes both goals from `--auto` selection with no code change.
- `goals/README.md` already documents the enum as `"active|paused"`; this is the first use of `paused`.
- **`handoff.sh` extraction verified against a fixture** — both emoji-anchored headings extract cleanly under BSD awk, and the script still exits 0 with no diary changes:

  ```
  awk -v start='^## 🚦 Release candidates' '$0 ~ start {f=1} f && /^## / && $0 !~ start {exit} f' fixture.md
  OBOT_WORKSPACE=~/Documents/obot2 bash tools/session-init/handoff.sh   # exit=0, 7 sections
  ```
- **104/104 tests green** on the branch: `node --test tools/session-hub/test/*.test.mjs` (91) + `tools/statusline/test/*.test.mjs` (13).

## Technical briefing

- `goals/registry.json`: `csr.status` → `paused`; new `keynote` entry at `paused`; each carries a `paused` block recording who, when, where, and what pausing does and does not mean.
- `docs/rc-framework.md` (new): increment PR vs RC PR (base, reviewer, merge lane, body, demo); the five things an RC must carry, with the deployed demo page as a hard gate; the harness-repo case (behaviour walkthrough — no exemption for internal tooling); the no-`dev`-branch case (a draft release instead of a `dev → main` PR); decision artifacts for blockers, with the all-goals-blocked escalation; the nightly executive-summary shape; and a closing section pointing at the wrapup as the same contract's per-session vehicle.
- `skills/session-wrapup/SKILL.md` — a new **The two headlines** section defines both lists: bullet shape, the demo-link gate (a PR without a working deployed demo is not an RC and goes in the work log instead), the recommendation requirement on every decision, the artifact-or-issue link requirement, and a routing table so nothing appears in both a headline and `## 🙋 ToDo`. Both lists are **cumulative** — an unreviewed RC and an unmade decision carry forward until he closes them. Threaded through the existing steps: done-condition 4, the verifier's delta job (demo and artifact URLs must return 200; carried items must still be open), step 1's deterministic pre-composition, the step 3 checkpoint page, the step 5 blockers rule (a risk needing *his* call is a headline as well as an issue), step 7's hand-off, the step 9 entry format, the step 10 exit checklist and closing response, and the `--auto` morning digest.
- `skills/session-init/SKILL.md` + `tools/session-init/handoff.sh` — the hand-off reads the two new sections out of the latest diary entry, so an unreviewed RC stays painted in the *Waiting on @jwildfire* group every morning instead of scrolling off with the entry.

## Next steps

- On merge: update `obot.roadmap/diary/README.md`'s section-format line to name the two headlines (one line, direct-commit grant).
- Tonight's wrapup is the first run of the new format — its two headline lists are the acceptance test.
- Possible follow-ups, not in this PR: the live session-hub dashboard could grow an *Awaiting @jwildfire* panel from the same two sections (`tools/session-hub/lib/collect.mjs` already parses the diary), and `session-reviews` could be narrowed to the RC queue rather than all open PRs.
- [#123](https://github.com/jwildfire/obot.roadmap/issues/123)'s design pass supersedes `rc-framework.md`; [#122](https://github.com/jwildfire/obot.roadmap/issues/122) adds the schedule.

---
This PR was drafted by Claude Code using Opus 5 and reviewed by @jwildfire
