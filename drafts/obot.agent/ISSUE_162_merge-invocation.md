<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/issues/162 on 2026-08-17 07:07 EDT -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Labels: bug, Assignee: @me -->

# Agents type the merge command in a form no permission rule can match, so every merge is a coin flip

Three workers in two days reported that the merge lane refuses background agents, and two finished, green pull requests ([#150](https://github.com/jwildfire/obot.agent/pull/150), [#158](https://github.com/jwildfire/obot.agent/pull/158)) sat unmerged overnight on it. Both halves of that diagnosis are wrong: nothing refuses the merge lane, and nothing about it is background-specific.

## What actually happens

The obot2 workspace allowlist permits three spellings of the wrapper:

```
Bash(scripts/obot-merge *)
Bash(obot.agent/scripts/obot-merge *)
Bash(/Users/jwildfire/Documents/obot2/obot.agent/scripts/obot-merge *)
```

A `Bash(prefix *)` rule matches a command only when **every** sub-command matches, splitting on `|`, `&&`, `||` and `;`. The three failing strings, verbatim from the transcripts, are:

```
bash scripts/obot-merge 150 -R jwildfire/obot.agent --squash --delete-branch 2>&1 | tail -15
bash scripts/obot-merge 158 -R jwildfire/obot.agent 2>&1 | tail -20
bash /Users/jwildfire/Documents/obot2/obot.agent/scripts/obot-merge 217 -R jwildfire/obot.roadmap --merge 2>&1 | tail -8
```

Each carries two decorations agents add out of habit. The `bash` prefix defeats all three path rules, and `| tail -N` introduces a second sub-command (`tail -15`) that no rule covers. Neither is needed: the wrapper prints ten lines.

An unmatched command is not refused. It falls through to the auto-mode classifier, which is nondeterministic.

## The evidence is a census, not a theory

Across all 497 `obot-merge` invocations in the session transcripts to 2026-08-17:

| Written in a form a rule matches | Allowed | Refused |
|---|---|---|
| yes | 7 | 0 |
| no | 473 | 17 |

Only 7 invocations in 497 were ever written in a matchable form. Every refusal in the program's history sits in the other bucket, at a rate of about one in thirty.

Two facts settle that this is a coin flip rather than a wall:

- obot.roadmap#217 was refused at `21:15:24Z` and the **byte-identical string** was allowed at `21:18:16Z`. That PR is merged.
- Background workers merged successfully on the standard and attested lanes on the same morning three others reported being blocked (`obot.agent#153`, `gsm.safety#54`).

Re-running each failing shape today, `--check` only, allowed all of them — which is the point, not a refutation.

## Why it recurred

The documented form was already correct, but nothing said the decorations cost the match, so each worker re-derived a decorated call. [`skills/session-reviews/SKILL.md`](../../skills/session-reviews/SKILL.md) made it worse by instructing the reviewer to chain the `--check` / `obot-merge` / re-read sequence "into as few calls as the gates allow" — which produces exactly the compound that loses the match.

This is also the third recurrence: the same class was diagnosed on 2026-08-14 ([decision artifact](https://jwildfire.github.io/obot.roadmap/reports/decisions/2026-08-14-merge-lane-classifier-denials/)), which recommended a settings rule. A settings rule cannot fix it — no sane rule covers `| tail`.

## Proposed fix

No permission change, and nothing for @jwildfire to approve. State the required form at every point of use, and guard it:

- `AGENTS.md` gains a short section with the exact command and why decoration costs the match.
- `templates/sibling-briefing.md` — which every sibling receives — carries it as a standing rule.
- `skills/session-spawn`, `skills/session-reviews` (including removing the chaining instruction for the merge call), and `docs/rc-framework.md` are corrected.
- `scripts/test/merge-invocation.test.mjs` fails if any documented example drifts back to a decorated shape, and encodes the three failing strings as regression cases.

## Out of scope

The classifier's ~3.5% refusal rate on unmatched commands is not addressed here and cannot be from inside this repo. This only ensures merges stop landing in that population.

---
This Issue was drafted by Claude Code using Opus 5 (👯🤖 W0028) and reviewed by @jwildfire
