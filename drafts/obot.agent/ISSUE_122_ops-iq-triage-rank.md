<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/issues/122 on 2026-08-16 00:15 EDT -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Labels: enhancement, Assignee: @me -->

## What this is

Third pass on the Operations Dashboard, from @jwildfire's three notes on 2026-08-15 ("the ops hub is the right shape, but is still pretty rough using it"):

> (3) the config items are pretty useless. They need to actually tell me what i need to do in exact detail. they need to be an installation qualification.
> (5) i also want to just be able to delete/snooze anything in the list.
> (6) I expect the list is going to get long, so you should order items in a way that highlights importance. true blockers first. maybe use a "critical" tag. but use it sparingly. I'm going to be annoyed if you tell me something is critical when it isn't.

## Why the config items read as useless

Not because they are thin — most already carry a paste-ready command. Three reasons, largest first:

1. **The dashboard throws the fix away.** `collectConfig` reads the headline and the id and sets `detail: ''` on purpose, and a config row is not clickable. The page shows one line of prose and offers no way to reach the command underneath it. The entries are better than the surface rendering them.
2. **No expected result and no verification.** An entry says what to run, never what he should see when it worked, and offers nothing to run afterwards that proves the change took effect. Success and silent failure look identical.
3. **No pass/fail record.** Checking the box is self-attestation with no evidence attached.

Plus: several are written agent-to-agent (mechanism first, action second), and `c0009` is visibly malformed — nested `****` bold out of a free-text `--fix`, because nothing validates the shape at write time.

## What changes

- **An IQ schema**: `Do` / `Expect` / `Verify` / `Unblocks` / `Source`, plus optional `Blocks` and `Why`. Exact command *or* exact click-path; what he should see; a command that proves it, with its expected result.
- **Enforced at capture** in `tools/blocker-log`, so agents cannot file a one-liner and regress this within a week.
- **Rendered on the dashboard**: a config row opens its IQ in the main pane with copy buttons and a **Check** button that runs the verify command and records a real pass/fail in the local store. Read-only allowlist; anything else degrades to copy-and-run with a manual result.
- **Triage on anything in the list** — Done / Snooze / Dismiss, for config items, decisions and release candidates alike, in an append-only local ledger. Nothing is deleted; snoozed and cleared items stay visible in collapsed sections carrying their wake condition.
- **A `critical` tag that has to be earned**: derived from a `Blocks:` reference that resolved to open, filed work at capture time, verified by `blocker-log` with `gh`. Not a free-text field. Budget of three, cross-section, above everything else.
- **All nine open config items re-verified and rewritten**; two of them turn out not to belong on the list at all.

## Acceptance

- Every open config item reads as an IQ with a verification step.
- `blocker-log` refuses an entry missing `--do` / `--expect` / `--verify`.
- Snooze states a wake condition; dismiss is recoverable; neither edits `.claude/blockers.md`.
- No item carries `critical` without a resolvable, open reference displayed beside it.
- The rail still holds at a 390px viewport.

Local-only throughout: the config list and the triage ledger never enter a repo or a published site.

---

This Issue was drafted by Claude Code using Opus 5 and reviewed by @jwildfire
