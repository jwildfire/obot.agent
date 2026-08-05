# Recon-sibling briefing (delta + ideas + focus)

The briefing for the **one** background sibling
[`session-init`](../skills/session-init/SKILL.md) step 4 spawns — and for the two
sweep siblings of its [fallback](../skills/session-init/SKILL.md#fallback-full-sweep).
This is the single home for the `gh` traps; do not restate them elsewhere.

**How to use it**: fill the `## Context` section of
[`sibling-briefing.md`](sibling-briefing.md) as usual, then paste everything below
as that template's `TASK:` block. The heartbeat contract, the report-back rules,
and the ending contract come from that template and are **not** duplicated here.

---

## Your three jobs

One sibling, one report, three sections.

1. **GitHub delta** — reconcile the carried list (in the Context block) against
   live state: mark carried items GitHub shows closed, merged, or materially
   changed, and surface genuinely **new** items the hand-off predates. Where the
   hand-off and GitHub disagree, **trust GitHub**. Drill into a single item
   (`gh pr view`, `gh pr checks`) only when its next step is genuinely ambiguous
   from title, state, and draft flag — and say in the digest that you did.
2. **Ideas inbox** — run [`session-inbox`](../skills/session-inbox/SKILL.md) in
   full: Reminders ingest, sweep, triage, in-thread replies, watermark. Report
   only the pending count and one line per triaged thread.
3. **Focus recon** — if this briefing carries a free-text focus argument,
   investigate it here. This is the **only** place it is ever investigated; the
   lead is forbidden from doing it inline.

## The batched calls

Three calls for the delta, **no per-item drill-downs**. Filter to the active repos
in the parse step, and parse with `python3`:

```bash
gh search issues --owner jwildfire --state open \
  --json repository,number,title,updatedAt
gh search prs --owner jwildfire --state open \
  --json repository,number,title,isDraft,updatedAt
gh project item-list 1 --owner jwildfire --format json --limit 200   # board stages
```

The two `gh search` calls are a **cheap first pass only** — they cap silently, so
anything you would report as closed or merged is confirmed with a per-repo
`gh issue list` / `gh pr list` first. Read the traps below before running any of it.

## The gh traps — read before you run anything

All measured, all load-bearing.

- `gh search issues` / `gh search prs` **silently cap at 100 results**. Dropped
  older items read falsely as closed. **Per-repo `gh issue list` / `gh pr list`
  is authoritative** — use `gh search` only as a cheap first pass, and never as
  the basis for calling something closed.
- `gh project item-list 1 --owner jwildfire` needs **`--limit 200`**: the default
  returned 80 of 155 board items. Its output exceeds 100KB — **pipe it straight
  into `python3`**, never save it and read the file back.
- **`jq` is not installed.** Parse with `python3`.
- Always pass `-R owner/repo` in scripted `gh` calls (cwd resolution), and prefer
  `--json` over the GraphQL paths deprecated on some repos.
- The sweep runs **unattended**: every command is read-only. If something would
  stall on a permission prompt, skip it, note the gap in the digest, and move on.

## Where your output goes

Write the corrections to
`{workspace}/.claude/session-notes/{YYYY-MM-DD}-init-delta.md` (wrapup runs use
`-wrapup-verify.md`): one bulleted line per correction, grouped

- `Closed/merged since the hand-off`
- `New since the hand-off`
- `Ideas`
- `Focus`

If there is nothing, write the single line `no changes` — do **not** write an
empty file and do **not** omit the file. Then append your heartbeat line naming
the file (`- $(date +%H:%M) 👯🤖 {slug} — recon digest written to {file}`, under
`## Session log`, shelled timestamp), and end your final message with a terminal
`result:` line so the job-state classifier marks you terminal.

The lead relays from this file at its next turn — **do not address @jwildfire
directly**.

## Digest format

One line per item, bulleted lists not prose (@jwildfire's standing preference —
lists over prose everywhere unless a deep dive is asked for), links inline:

```
- repo#N — title — board stage — draft/open — updated date
```
