<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/issues/202 on 2026-08-18 01:02 EDT -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Labels: enhancement, type:task -->

Requirement: jwildfire/obot.roadmap#238 — the morning fold, and the briefing it produces.

## What is missing

There is no diary entry for 17 August. That day carried ninety-one commits and a shipped release. There is none for 15 August either, and a nine-day gap before 14 August.

The diary is the keynote's raw material, which is why its quality has to be independent of whether anyone reads it daily. It stopped accruing because its trigger was the end of a session, and the standing sessions do not end.

## What this task does

The fold writes the day's entry into `obot.roadmap/diary/YYYY-MM-DD.md` when — and only when — the activity gate opened. A day with no activity gets no entry: the diary's own contract says "no entry on empty days — never machine-generated filler", and that rule is the openclaw lesson, so it stays absolute.

The entry is composed **mechanically**, in the format the last two entries already use:

- `# Daily diary: YYYY-MM-DD`
- a `<span class="meta">…</span>` lead — the diary index extracts this by regex for its summary line
- `📊 [Session report](../reports/sessions/YYYY-MM-DD.html)`
- `## 🚦 Release candidates needing review`, then `## 🧭 Decisions needed` — both cumulative, both always present even when empty, in the shape `skills/session-wrapup/SKILL.md` already specifies. These are the same items the briefing carries; they are composed once and rendered twice.
- then the record: work completed, PRs and issues touched, blockers, scaffold, loose ends, `## 🙋 ToDo`.

**The narrative is owed, and says so.** The `<span class="meta">` lead is the one genuinely authored part of an entry, and writing it needs a model. Starting an agent on a clock is A2, which is not enabled and is waiting on [D0019](https://jwildfire.github.io/obot.roadmap/reports/decisions/2026-08-16-scheduled-sessions-assessment/). So the fold writes a factual, mechanical lead and marks it: `*Composed by the 07:00 fold; narrative not yet written.*` Any session can fill it later, and when D0019 clears, that slot is the single place a bounded agent gets added.

A mechanically-composed record on the morning after is what was lost. An unwritten one because no model was available is where we are now.

The entry also carries the unattended marker the `--auto` wrapup already uses — `*Posted unattended; not yet reviewed by @jwildfire.*` — because the diary publishes to a public site and the flag is what keeps the record honest.

## The per-day operational record

`session-hub.mjs --report` writes `obot.roadmap/reports/sessions/<slug>.html`, the frozen operational record the diary entry links. It is per-session today, its directory is flat, nothing aggregates it, and the newest file is 2026-08-16. The fold renders one per day, day-scoped, with the same renderer — the disposition M1 already recorded for it ("merges — same renderer, day-scoped window").

The report is the operational record; the diary entry is the narrative. Neither restates the other, and this task does not change that line.

## Acceptance

- A day with activity gets its entry and its report, both committed, both deployed, with the deployed URL verified 200 rather than assumed.
- A day without activity gets neither, and `git status` in the hub is clean afterwards.
- The `<span class="meta">` lead matches the index's extraction regex, so the entry gets a summary on `/diary/` rather than a blank row.
- The two headline lists carry every open item, including ones carried from earlier days, with `*(carried from MM-DD)*` where they are not new. A skipped week loses nothing.
- Both headings are present even when empty. A missing heading is indistinguishable from a dropped one.
- The changelog entry required whenever a change alters what the site shows is written in the same commit.

## Not this task

The weekly narrative — [#239](https://github.com/jwildfire/obot.roadmap/issues/239). Removing or deprecating the interactive wrapup, which stays available and unchanged — [#240](https://github.com/jwildfire/obot.roadmap/issues/240).

---

Filed by 👯🤖 W0045 (Claude Code using Opus 5). Not reviewed by @jwildfire.
