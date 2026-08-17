<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/pull/163 on 2026-08-17 07:12 EDT -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Assignee: @me -->

Three workers in two days reported that the merge lane refuses background agents, and two finished, green pull requests sat unmerged overnight on it. Nothing refuses the merge lane, and nothing about it is background-specific — the calls were written in a shape no permission rule can match, so each one was decided by a coin flip instead.

Closes #162

## Roadmap context

Config item c0014, raised by 🧭🤖 obot-navigator after [#150](https://github.com/jwildfire/obot.agent/pull/150), [#158](https://github.com/jwildfire/obot.agent/pull/158) and [obot.roadmap#217](https://github.com/jwildfire/obot.roadmap/pull/217) stalled. It was framed as a decision for @jwildfire and a candidate for the first `critical` config tag. It is neither: the fix touches no permission surface and needed nobody's approval, and one of the three pull requests had already merged itself on a retry.

The same class was diagnosed on 2026-08-14 and its [decision artifact](https://jwildfire.github.io/obot.roadmap/reports/decisions/2026-08-14-merge-lane-classifier-denials/) recommended adding a settings rule. That recommendation cannot work, which is why this recurred: no permission rule can cover `| tail -20`.

## What was wrong

A `Bash(prefix *)` rule matches a command only when **every** sub-command matches, splitting on `|`, `&&`, `||` and `;`. The three failing strings, verbatim:

```
bash scripts/obot-merge 150 -R jwildfire/obot.agent --squash --delete-branch 2>&1 | tail -15
bash scripts/obot-merge 158 -R jwildfire/obot.agent 2>&1 | tail -20
bash /Users/.../obot.agent/scripts/obot-merge 217 -R jwildfire/obot.roadmap --merge 2>&1 | tail -8
```

The `bash` prefix defeats all three allowlisted path rules; `| tail -N` adds a sub-command no rule covers. Unmatched commands are not refused — they fall through to the auto-mode classifier, which is nondeterministic.

## Evidence

A census of every `obot-merge` invocation in the session transcripts to 2026-08-17, classified by whether the string can match an allowlist rule:

| Matches a rule | Allowed | Refused |
|---|---|---|
| yes | 7 | 0 |
| no | 473 | 17 |

497 invocations; 7 were ever written in a matchable form. Every refusal in the program's history is in the other bucket, at roughly one in thirty.

Two facts rule out a wall:

- obot.roadmap#217 was refused at `21:15:24Z` and the byte-identical string was allowed at `21:18:16Z`. It is merged.
- Background workers merged fine the same morning others reported being blocked ([#153](https://github.com/jwildfire/obot.agent/pull/153), [gsm.safety#54](https://github.com/jwildfire/gsm.safety/pull/54)).

Re-running all six invocation shapes today with `--check` allowed every one, including W0022's byte-identical failing string. That is the finding, not a refutation of it.

## Technical briefing

- `AGENTS.md` gains **Running the merge command**: the exact form, the sub-command matching rule, and that a classifier refusal is neither a permission decision nor a policy refusal — re-type the bare command rather than look for another route.
- `templates/sibling-briefing.md` carries it as a standing rule, so every sibling receives it.
- `skills/session-reviews/SKILL.md` no longer tells the reviewer to chain the `--check` / `obot-merge` / re-read sequence "into as few calls as the gates allow". That instruction was actively producing the compound that loses the match; the rest of the sequence still chains, the `obot-merge` call now stays on its own.
- `skills/session-spawn/SKILL.md` and `docs/rc-framework.md` corrected — the latter documented the merge lane as bare `obot-merge <pr> -R <repo>`, which matches no rule at all.
- `scripts/test/merge-invocation.test.mjs` scans the eight agent-facing docs and fails on any documented example that would fall through, and encodes the three failing strings plus each decoration in isolation as regression cases.

Verification: 452 tests pass, up from 449. `obot-policy validate` clean and the policy sweep is 30/30 identical to the baseline — no merge verdict in any repo changes. The guard was proved to bite by reintroducing a decorated example and watching it fail, then restoring the file.

## What this does not do

It does not touch `.claude/settings.json`, either workspace or user, and adds no permission. It cannot reduce the classifier's refusal rate on unmatched commands — it only stops merges landing in that population. Agents that ignore the documented form will still hit the coin flip; the test guards the documentation, not the typing.

---
This PR was drafted by Claude Code using Opus 5 (👯🤖 W0028) and reviewed by @jwildfire
