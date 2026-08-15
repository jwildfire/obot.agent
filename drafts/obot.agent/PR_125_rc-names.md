<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/pull/125 on 2026-08-16 -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Assignee: @me -->

Release candidates are now named `{package} vX.Y.Z-RCn` with no summary at all, the description that used to live in the title moves into a contract-shaped body and onto a second line in your queue, and clicking an RC in the dashboard now opens it there instead of bouncing you to GitHub.

Closes #121

- **See it move:** the panel rendering your live [open.gismo v0.2.0-RC1](https://github.com/jwildfire/open.gismo/pull/10) — screenshot in the technical briefing below; run `node obot.agent/tools/ops-dashboard/ops-dashboard.mjs --serve` and click the RC to see it against your own queue.
- **Release notes:** [NEWS.md](https://github.com/jwildfire/obot.agent/blob/rc-names/NEWS.md) — the `v0.5.0 (Upcoming)` section, first two bullets.
- The rule text: [`docs/rc-framework.md`](https://github.com/jwildfire/obot.agent/blob/rc-names/docs/rc-framework.md), [`AGENTS.md`](https://github.com/jwildfire/obot.agent/blob/rc-names/AGENTS.md), [`skills/rc-release-notes/SKILL.md`](https://github.com/jwildfire/obot.agent/blob/rc-names/skills/rc-release-notes/SKILL.md).

### Requirements this release closes

- Closes #121 — the RC naming rule, the `-RCn` counter semantics, the RC body contract, and the dashboard panel that reads it.

**The ask:** this is an operational-lane increment to `main`, not a release — merge it and the rule is live. **Two commands are yours**, below.

---

### Your two open RCs need retitling — these are corrected

The pair prime handed you an hour ago was written to the *old* rule. Version-verified against each repo's live `NEWS.md` `(Upcoming)` heading:

```
gh pr edit 52 -R jwildfire/gsm.safety --title "gsm.safety v1.1.0-RC1"
gh pr edit 10 -R jwildfire/open.gismo --title "open.gismo v0.2.0-RC1"
```

Both are `-RC1`: neither has had changes requested. open.gismo#10's predecessor #9 was closed 33 seconds after opening so the bot could author it and you could hold the reviewer role — a mechanical re-open, which the rule explicitly does not count as a re-cut.

### The `-RCn` counter, as rules an agent follows without judgement

1. First candidate for a version is **`-RC1`**. There is no unnumbered RC.
2. **Increments only when review is re-requested after a `CHANGES_REQUESTED` decision.** Pushes before you review do not move it; a round ending in approval does not either. One increment per review round.
3. **The same PR is retitled — never replaced.** Your comments, the review decisions and the CI history live on the thread, and you review `-RC2` by re-reading what you asked for on `-RC1`. A mechanical re-open does not increment.
4. **Resets per version**: `v1.1.0-RC1`, `v1.1.0-RC2`, then `v1.2.0-RC1`.
5. **The tag drops the suffix.** The release is `v1.1.0`; `-RCn` never reaches a tag, a release body or a `NEWS.md` heading.

### Technical briefing

**What this supersedes.** Your earlier same-day rule shipped in #119 as a derived label `pkg vX.Y.Z — {summary}`. "No other summary allowed" makes most of that machinery dead: a correct title now *is* the label, so `rcLabel` stopped synthesising descriptions and now strips them off legacy titles instead — a page that keeps rendering descriptions makes a title that has one look correct. The superseded rule text is rewritten everywhere it appeared, and the stale claim inside the #119 NEWS bullet (unreleased) is corrected rather than left advertising behaviour that no longer exists.

**Reconciled, not replaced.** Your body shape is the established five-section obot PR body reordered and tightened, not a second template. The requirements list *carries* the `Closes #N` keywords — if it replaced them, issues would stop auto-closing and `obot-merge` would start refusing release merges for naming no issue.

**`obot-merge` warns, it does not block.** Its other refusals protect the release's record (an issue with no milestone, a release naming no issue), which is unrecoverable once a merge lands. A title is cosmetic and fixable in one command, and the script runs on the attested lane *after* your approval — refusing there would stall a release you had already approved, at its last step, over a string.

**The panel.** You asked for the PR in an iframe. That is impossible: github.com answers `x-frame-options: deny` on a PR (verified directly), so it renders blank permanently, and proxying your authenticated GitHub session to defeat that would be a security problem rather than a workaround. The native panel is better anyway — it opens instantly from the cache so it works with the network down, it matches the dashboard instead of dropping a foreign page into the middle of it, and it runs in your stated review order ("skim the PR, read through the demo page and then read the release notes") without GitHub's chrome. **The demo page itself is framed live** — Pages sets no frame headers. A demo hosted elsewhere degrades to a link.

The two asks arrived hours apart and were not designed together, but they converge: the body contract *is* the panel's data model. The contract makes the panel renderable; the panel is why the contract is worth enforcing. It also repays the cost of "no other summary allowed" — the exec summary is what makes a queue of bare `vX.Y.Z-RCn` titles legible again.

**Approving stays on GitHub, deliberately.** Reviewing here means writing there, and a one-click approve inside a local tool erodes a gate that is yours. The panel ends at *Open on GitHub to approve*. If you want that changed, it should be your call, not a side effect of this PR.

**Parsing is driven by real bodies, not the template.** Checked against open.gismo#10, written before the contract: `See it move:` and `The ask:` are bold paragraphs rather than bullets, and later bullets mention a demo and NEWS.md while linking somewhere else entirely. Naive matching picked the roadmap issue as the demo and a PR as the release notes. So demo and NEWS.md are identified by their *target*, never by a passing mention, and the exec summary skips both marker lines. Both shapes are now tests. That RC correctly renders "No NEWS.md link — the contract requires one" — the gap the new mandatory rule closes.

**Verification.** 53 tests pass (mine plus opsqueue's, after rebasing onto #123). TDD throughout: tests updated to the new rule first and watched fail, then the code. Verified end to end in Chrome against your live open.gismo RC — panel renders, the Pages demo frames, no horizontal overflow at a real 390px viewport, and the RC row's second line ellipsizes at ~325px (which is why the contract says front-load the sentence).

**One correction to the record.** The brief I was given said the Navigator sweep pattern-matches RC titles and would go blind to correctly-named RCs. That is false: `classifyRC()` in `tools/navigator/sweep.mjs` classifies on base branch, review requests and `reviewDecision`, and never reads the title (it only displays it). The Navigator needs no change for this rule.

### Next steps

- Run the two retitle commands above.
- Not done here, flagged rather than assumed: **open.gismo#10 and gsm.safety#52 bodies do not yet meet the new contract** (open.gismo#10 has no `NEWS.md` link and no `Closes` lines). They are your open RCs, so I did not edit them.

---

*This PR was drafted by Claude Code using Opus 5 and reviewed by @jwildfire*
