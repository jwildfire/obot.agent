<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/pull/158 on 2026-08-17 01:28 EDT -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Labels: enhancement, Assignee: @me -->
Release candidates now open with the sentence about the release instead of a warning label addressed to @jwildfire, and the attested-lane rule moves to the places agents actually read.

Closes #156

His words, 2026-08-17: *"I really don't like this header. '⛔ Release candidate — merges only on @jwildfire's approval, via the attested lane' shouldn't need that as the first thing on a PR - just add a rule for the relevant agents and maybe an invisible markdown comment in the issue"*

### Roadmap context

The banner was an agent-to-agent instruction printed on the one surface he reads, and it was wrong three ways at once.

- It told the approver a rule about himself. "Merges only on @jwildfire's approval" is addressed to agents; he is the approver.
- It spent the line above the fold that the exec summary was given by his own body contract (2026-08-15).
- It announced a guard that was never prose. `scripts/obot-merge` refuses a release-role merge without `--jeremy-approved`, and the raw merge routes are hook-denied. A guard that works does not need to introduce itself.

This is the same defect as a dashboard page that reads like an audit log: our internal register leaking onto his screen. So the general form is written down rather than left as this one fix — new `docs/rc-framework.md` section **Written for him, or written for us**: anything on a surface he reads is written for him, and agent-to-agent instructions go in agent-facing places. The test is one question — would he do anything differently for having read this?

### Evidence

- The rule now lives in the three places an agent reads before opening an RC: [`docs/rc-framework.md`](https://github.com/jwildfire/obot.agent/blob/w0022-rc-banner/docs/rc-framework.md#written-for-him-or-written-for-us), [`AGENTS.md`](https://github.com/jwildfire/obot.agent/blob/w0022-rc-banner/AGENTS.md#release-candidate-prs-title-and-body), [`skills/rc-release-notes/SKILL.md`](https://github.com/jwildfire/obot.agent/blob/w0022-rc-banner/skills/rc-release-notes/SKILL.md).
- The body template's first line is now an HTML comment carrying the same rule — invisible to him, present for the agent reading the PR.
- [open.gismo#10](https://github.com/jwildfire/open.gismo/pull/10) rewritten in place: banner gone, exec summary first, verified by re-reading the live body from GitHub.
- [gsm.safety#52](https://github.com/jwildfire/gsm.safety/pull/52) is held deliberately — W0021 is cutting v1.1.0 off it right now, and editing its body mid-release would race that worker. It gets the same edit once the release lands.
- Full suite green on the branch: 443 tests pass (`node --test` over the five test directories CI runs), `obot-policy validate` clean.

### Technical briefing

The parser change is the load-bearing part, and it was found by writing the test first.

- `parseRCBody` builds his queue-row summary from the first line of the body that is not a heading, a bullet or the attribution footer. An HTML comment is invisible on GitHub but perfectly visible to a parser reading raw markdown, and `<!--` is none of those three things.
- So the naive version of this change would have replaced every RC summary on his phone with `<!-- Release candidate. Merges only on @jwildfire's explicit approval, via the…`. The test was written before the fix and failed exactly that way — the effect was verified, not the exit code.
- Comments are now stripped ahead of every other rule, tracking open state across lines, since the comment in the template spans several. Inline `<!-- … -->` pairs and a comment whose closer trails other text are both handled, with text outside the delimiters preserved.
- The retired `⛔` banner is still skipped, so the RCs written before today keep parsing. The rule changed; the bodies already on GitHub did not.
- Verified against the real thing rather than the fixture alone: the live open.gismo#10 body, fetched back from GitHub after the edit, parses to the right summary, demo and NEWS.md links, and no comment text reaches the panel.

### Next steps

- gsm.safety#52 gets the same body edit once W0021's v1.1.0 release finishes.
- No migration is needed for future RCs: the template in `docs/rc-framework.md` is what agents copy, and it now carries the comment.

---
This PR was drafted by Claude Code using Opus 5 (worker W0022) and reviewed by @jwildfire
