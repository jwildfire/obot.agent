<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/issues/206 on 2026-08-18 01:02 EDT -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Labels: bug -->

## What he is being shown

The Operations Dashboard is his local todo page. Its whole design ranks three buckets in the order he set on 2026-08-15 — "RCs first. then decisions, then config items."

Right now the running dashboard is showing him **zero of ten** config items, and none of the Navigator's swept state, and it is reporting both as ordinary emptiness rather than as a failure.

## Proven, both sides, at 2026-08-18 05:0x

The running server, pid 82708, `--workspace /Users/jwildfire/Documents/obot2`, started 04:03:23Z, serving sha `9112964`:

- `curl http://127.0.0.1:7326/queue.json` → `"config": { "read": false, "why": "no config file" }`
- `curl http://127.0.0.1:7326/navigator` → renders `No sweep file yet — …`

The same files, at the same instant, from a plain node process as the same user:

- `.claude/blockers.md` — reads fine, 22,629 bytes. `collectConfig('/Users/jwildfire/Documents/obot2')` returns **10 items**, `error: undefined`.
- `.claude/session-hub/navigator-state.md` — reads fine, 12,559 bytes, swept at 00:34.

Both files are `-rw-r--r-- jwildfire staff`, neither is a symlink, and the workspace path the server was given is the one they are under.

## Why it matters more than the missing rows

`collectConfig` returns `{ items: [], error: 'no config file' }` on any read failure — the same value for "the file is not there" and "I could not read the file". The dashboard renders that as an empty bucket with a plausible explanation, so the page looks correct and complete while carrying none of the ten items it exists to surface. `/navigator` does the same with "No sweep file yet", three minutes after the sweep wrote it.

That is the recurring defect class in this program, on the one surface built specifically to tell him what needs him.

## What is not established

The cause. Reads under `{workspace}/.claude/` fail inside the server process and succeed outside it, while writes under the same tree evidently succeed — the server itself wrote `.claude/ops/cache/rcs-lane.json` at 00:48. That asymmetry is not explained yet, and this issue does not guess at it.

## What would close it

- A read failure is reported as a failure. `no config file` is reserved for a file that is genuinely not there; anything else surfaces the errno and renders as a fault, not as an empty list.
- The dashboard shows the ten open config items again, and the Navigator panel shows the sweep that is already on disk.
- Whatever the cause turns out to be, the check is the effect — the rendered page carrying the rows — and not that a collector returned without throwing.

Found while reading the queue collectors for [obot.roadmap#238](https://github.com/jwildfire/obot.roadmap/issues/238), which shares this item set with the morning briefing. Not part of that build.

---

Filed by 👯🤖 W0045 (Claude Code using Opus 5). Not reviewed by @jwildfire.
