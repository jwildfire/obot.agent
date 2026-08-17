<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/issues/156 on 2026-08-17 01:21 EDT -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Labels: enhancement, Assignee: @me -->

# The RC banner is an agent instruction printed on @jwildfire's screen

Every RC PR body opens with a heading addressed to agents, not to the person reading it:

```markdown
## ⛔ Release candidate — merges only on @jwildfire's approval, via the attested lane
```

@jwildfire, 2026-08-17: *"I really don't like this header. '⛔ Release candidate — merges only on @jwildfire's approval, via the attested lane' shouldn't need that as the first thing on a PR - just add a rule for the relevant agents and maybe an invisible markdown comment in the issue"*

## Why it is wrong

- **It tells him a rule about himself.** "Merges only on @jwildfire's approval" is an instruction to agents. He is the approver — he does not need to be told he is.
- **It is our internal register on his surface.** Same fault as dashboard pages that read like audit logs: the machinery's bookkeeping leaking onto the screen he reads.
- **It is redundant with a guard that actually works.** The attested lane is enforced in code by [`scripts/obot-merge`](../../scripts/obot-merge), which refuses a release-role merge without `--jeremy-approved`. Raw `gh pr merge` is hook-denied. A guard that works does not need to announce itself in prose.
- **It costs the first line above the fold.** The RC body contract (@jwildfire, 2026-08-15) says the body opens with the one-sentence exec summary. A banner ahead of it takes the position that sentence was given.

## What changes

1. **The rule moves to agent-facing places** — [`docs/rc-framework.md`](../../docs/rc-framework.md), [`AGENTS.md`](../../AGENTS.md), [`skills/rc-release-notes/SKILL.md`](../../skills/rc-release-notes/SKILL.md) — where an agent reads it before opening an RC.
2. **The PR body carries an HTML comment instead** — invisible to him, present for an agent reading the PR itself.
3. **The exec summary becomes the first line** of every RC body, per the contract he already set.
4. **The dashboard parser stops treating the banner as the thing to skip** and skips HTML comments instead, or the comment becomes his queue-row summary.
5. **The two live RC bodies are rewritten**: [gsm.safety#52](https://github.com/jwildfire/gsm.safety/pull/52) and [open.gismo#10](https://github.com/jwildfire/open.gismo/pull/10).

## The general rule this is an instance of

**Anything written on a surface @jwildfire reads is written for him.** Agent-to-agent instructions go in agent-facing places: the framework docs, `AGENTS.md`, the skills, or an HTML comment. This belongs stated in the framework, not just applied here — it is the same defect as the dashboard-as-audit-log, and it will recur on the next surface unless the principle is written down.

---
This Issue was drafted by Claude Code using Opus 5 (worker W0022) and reviewed by @jwildfire
