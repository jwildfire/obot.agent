<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/pull/124 on 2026-08-16 00:23 EDT -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Labels: enhancement, Assignee: @me -->

## What this does

The config items now tell you exactly what to do and prove you did it, anything in the list can be snoozed or dismissed, and there is a `critical` tag no agent can claim about its own work.

Closes #122

Your three notes on the dashboard, taken one at a time.

**(3) Installation qualifications.** The old entries were not thin — most already carried a paste-ready command. Three other things were wrong, largest first: the page threw the fix away (`collectConfig` read the headline and set `detail: ''` on purpose, and a config row was not clickable, so you saw one line of prose and had no way to reach the command underneath it); nothing said what you should *see* when it worked, so success and silent failure looked identical; and ticking the box was self-attestation with no evidence. An entry is now `Do` / `Expect` / `Verify` / `Unblocks` / `Source`, with `Blocks` and `Why` optional and `Why` last. Click a config row and the whole protocol opens with copy buttons and a **Check** button that runs the proof and appends a real pass/fail to `.claude/ops/checks.jsonl`. A failure reads `printed 0, expected 2`, not "exit 1". Enforced at capture (`tools/blocker-log` refuses `--fix`), because a tool that accepts a one-liner gets fed one-liners forever. Only single read-only commands run unattended; web-UI-only and device-side steps say so and hand you the command instead.

**(5) Delete and snooze, on anything** — release candidates and decisions too. A snooze always states how it comes back (a day / a week / until it changes; all three also watch a content fingerprint, so a pull request that gets pushed to wakes on its own), and snoozed and cleared rows stay on the page collapsed, with their wake and a **restore**. Nothing is deleted: your click is the approval, and it appends to an append-only ledger the queue filters on — **a click never edits `.claude/blockers.md`**, so the list keeps its own retire-with-strikethrough convention and `blocker-log --retire` stays its one writer. Dismiss says what it really does, per kind: for an RC, *"hides it here; the pull request stays open on GitHub."*

**(6) A `critical` tag that is hard to claim.** No boolean an agent can write. Two routes in, both measured by something other than the thing wanting attention: a `Blocks:` reference GitHub confirmed **open** at capture time, or a computed condition on the item (`item.computed` — which is where #123's OVERDUE plugs in). The row shows the claim — `critical · blocks obot.roadmap#182` — so a weak one is visible at a glance. Capped at three; a fourth is neither shown as critical nor hidden. **On tonight's real queue nothing earned it**, which is the point.

## Roadmap context

@jwildfire, 2026-08-15, on the dashboard as a whole: *"The ops hub is the right shape, but is still pretty rough using it."* Then the three notes this closes, verbatim in [#122](https://github.com/jwildfire/obot.agent/issues/122). Third pass on [roadmap #180](https://github.com/jwildfire/obot.roadmap/issues/180), after [#118](https://github.com/jwildfire/obot.agent/issues/118) (ids, labels, tabs) and [#120](https://github.com/jwildfire/obot.agent/issues/120) (the answer pipeline).

## Evidence

- **201 tests green** across the suite; 73 in `tools/ops-dashboard/test/` (24 new files' worth of cases in `ops-iq.test.mjs`).
- **Every open config item re-verified against reality tonight**, and every automatic proof run: `c0001` FAIL (printed 0, expected 2) · `c0002` FAIL · `c0003` FAIL · `c0004` FAIL (SAML 403 still) · `c0005` REFUSED (AppleScript is not on the read-only allowlist — yours to run) · `c0008` FAIL · `c0009` manual · `c0012` FAIL · `c0013` FAIL. No false passes.
- **Two items left the list because they do not belong on it.** `c0006` (bot-assignee) was read as a missing token grant; verified today that `GET repos/.../assignees/obotclaw%5Bbot%5D` is 404 and the assignable list is `jwildfire, obot-claw` — an App's bot user cannot be a GitHub assignee at all, so no grant of yours fixes it. `c0007` folded into `c0001`: same file, same array, one edit instead of two. Both retired with their evidence, neither deleted.
- **Two of the three hardest test cases became items; one did not.** The `gh issue close` deny-list gap is real and verified (`Bash(gh issue close *)` denied while `Bash(gh api *)` is allowed, and `gh api` can close an issue with a PATCH — the deny stops nothing) → `c0012`. The bg-isolation guard blocking obot.agent the same way it blocks the hub was hit live building this → `c0013`. **The oa#113 classifier denial could not be reproduced**: the exact sanctioned form with `--jeremy-approved` ran clean from this session tonight (`--check`, exit 0). Filing an IQ for it would have told you to fix something that is not broken. Worth knowing separately: **#113 is `CONFLICTING`**, which is agent work, not yours.
- **390px iPhone viewport** (real iframe probe): no horizontal overflow (`body.scrollWidth === clientWidth === 390`), rows one line at 23px and clamped to two, code blocks wrap instead of hiding half a command behind a scrollbar. Rail 780px over 19 rows — per-row cost unchanged from the 626px/17-row baseline; the growth is two more rows plus plain-English titles that wrap to two lines, which is the trade I would make again.
- **Snooze/restore driven end-to-end in Chrome**: `c0004` snoozed a week → left the list, config pill 9 → 8, appeared under a collapsed `Snoozed 1` reading *"wakes Sun 23 Aug, or sooner if it changes · restore"* → restored → pill back to 9. His real queue is exactly as it was.
- **A bug this pass would otherwise have shipped**: the page's inline script had a template-literal escape that made a `\n` a real newline, so the whole script failed to parse and every control on the page was dead — silently, no console error, page still looked right. Nothing was checking that the script the browser receives is valid JavaScript. Now a test is.

## Technical briefing

Three new modules, so the three concerns stay separable and the collectors learn nothing about importance: `lib/iq.mjs` (parse, validate, the read-only allowlist, run and record), `lib/triage.mjs` (the ledger, wake conditions, fingerprints), `lib/rank.mjs` (the bar, the budget, the order). `collectQueue` is now collect → triage → rank.

The verify allowlist is fail-closed and re-applied server-side, because the command arrives from a browser page and the page is the least trustworthy thing in the process. No shell is ever involved — the command is tokenised and run through `execFile`.

**The cross-section call, and what it cost.** `critical` pins above all three sections rather than sorting within them. That is what "true blockers first" asks for, and a config item holding up filed work genuinely outranks a routine RC. It costs the clean one-to-one mapping between the three sections and the three worker outcomes: an agent reading Config no longer sees every config item there. Mitigated three ways — a pinned row moves rather than appearing twice, the section header says how many moved, and `/queue.json` keeps the unpinned grouping so machine consumers are untouched.

Rebased onto #123; the sidebar keeps its answers panel and gains the triage bar above it.

## Next steps

- Nine config items are waiting, each with a Check button. `c0001` is one edit that clears two of them.
- If you want issue-closing genuinely blocked rather than decoratively blocked, say so and an agent files it as a PreToolUse hook — that sees the whole command string and catches both forms, and it does not need your keyboard.
- The `computed` seam is open for #123's OVERDUE the moment its collector attaches it.

---

This PR was drafted by Claude Code using Opus 5 and reviewed by @jwildfire
