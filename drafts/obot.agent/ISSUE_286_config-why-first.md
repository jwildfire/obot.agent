<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/issues/286 on 2026-08-20 -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Assignee: @me -->

## What he asked for

@jwildfire, 2026-08-20:

> I need the config summarys to start with the 'why'. Why is this important? What problem does it fix?

## The trap, which is most of the work

The config list already has a `Why`, and his own earlier rule (2026-08-16, obot.agent#122) keeps it **last**, because "an item that opens with the mechanism is written agent-to-agent, and he triages by skimming".

Promoting `Why` to the top would satisfy the letter of his sentence and produce exactly the agent-to-agent opening that rule exists to prevent. It is the wrong reading.

What he is asking for is the **stakes** — what problem this fixes, what stays broken if he never does it. That is what `Unblocks` already meant: "what it buys, in his terms".

## What to build

- Rename `Unblocks` to `Why it matters` and promote it to first on the entry and first on the card. A rename rather than a new field: two fields both meaning "why" drift apart, and the hand-written one is the one that goes stale.
- Keep reading `Unblocks:` as an alias, so no existing entry stops parsing and most existing wording promotes as-is.
- Make it required, and **enforce it at capture** the way `--do` / `--expect` / `--verify` already are. The tool's own help says a tool that accepts a free-text one-liner gets fed free-text one-liners forever, and that applies here exactly as much.
- Add a refusal for a lead that is not a why — a command, a path, a flag, a bare mechanism, a "because …", or anything too short to be a sentence — reporting **every** reason at once, the same shape as `landing-log`'s summary bar.
- Backfill every open item. A field only new items carry means he sees the old shape for months.
- Re-render the cards and check one at 390px; he reads these on a phone.

## Why the requirement is doing audit work too

An item nobody can write a `Why it matters` for is a strong candidate for not being needed at all. That is the other half of the same night's job — the audit of whether the open items are still needed — so the field earns its place twice.

## Done when

- `blocker-log` refuses a capture with no `--matters`, and refuses one whose `--matters` is a command, a path, a flag, a bare mechanism or a fragment, listing every reason.
- `Why it matters` and `Why` parse as different fields, with a test for the shadowing case.
- Every open config item leads with one, and every card's first heading is "Why this matters".
- Every card holds at a real 390px viewport.

---

Drafted by 👯🤖 W0090 using Opus 5.
