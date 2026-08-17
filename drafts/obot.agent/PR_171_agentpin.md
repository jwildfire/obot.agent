<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/pull/171 on 2026-08-17 07:24 EDT -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Labels: enhancement, Assignee: @me -->

You can pin agents on the Agents tab, and the standing roles are pinned already — because of what they are, not because they are named in the code.

Closes #169

## Why this is here

You asked for it while watching the page: *"also let me pin agents. pin prime, nav and fleet manager (fleet for short) by default."* It extends the table from #154 under [roadmap #227](https://github.com/jwildfire/obot.roadmap/issues/227), and it is deliberately small — no part of the tab was redesigned around it.

The issue asked for the principle rather than the three names, and that is the shape of the diff: the pinned-by-default set is *every standing role*, read off a registry that already had to exist. A fourth standing role will arrive pinned the day it is declared, and a worker cannot drift into the band however long it lives or however much it spends.

## What you can do with it

- Pin or unpin any row. The control is on every row, not only the pinned ones, and it never opens the row's evidence.
- Prime, the Navigator and the fleet manager are pinned without being named anywhere in the pinning code.
- Unpin one of them and it stays unpinned — the next render does not put it back.
- A pinned role that has died is still in the band, showing that it died. So is one that ended cleanly days ago, and so is one with no session at all, which reads `not running` with the reason.
- Sorting a column reorders each band on its own, so a click never scatters the pinned rows back into the table.
- Filters still win, and when one hides a pinned row the band says `1 pinned hidden by a filter` rather than looking complete.

## Evidence

Verified in Chrome against the live roster on a test server (`--port 7391`, which never claims the serve marker, so your dashboard on 7326 was untouched — #142).

- Desktop: the pinned band holds `🎩🤖 obot-prime` (finished), `🧭🤖 obot-navigator` (running), `🚦🤖 obot-fleet`, above `EVERYTHING ELSE` ranked by cost.
- 390px, measured in an iframe probe rather than eyeballed: `scrollWidth === clientWidth === 390`, no horizontal overflow, no offending element.
- The fleet manager arrived in the band **by role**, with no pinning code aware of it, within an hour of its first launch — first `running`, then `died` on a later render. Both hard cases seen on the real page rather than only in a fixture.
- Unpin, re-render, re-read: `role:🎩🤖 → false` is the only thing in the store, prime moves to `rest`, and a fresh request still has it unpinned.
- Pin an arbitrary agent: it joins the band, and `.claude/ops/pins.json` gains one override.
- 15 new tests in `test/pins.test.mjs`; the ops-dashboard suite is 278 green. One unrelated failure, `serve-marker.test.mjs`, is a leaked test server from another worktree holding port 7399 — it fails identically on a pristine `main`.

## Technical briefing

- `lib/roster-view.mjs` — `STANDING_TAGS` is now derived from a new `STANDING_ROLES` registry (tag, session name, short name, role, resting sentence), plus `standingRoleOf()`. One declaration of what a standing role is, shared by the kind classifier, the Kind filter and the pin default.
- `lib/pins.mjs` (new) — `pinKey` (`role:<tag>` for a role, the worker id for a worker), `pinnedByDefault`, `pinState`, `labelIsPinned`, `pinnedRoles`, and the store read/write. Overrides only; `pinned: null` clears one. A test reads this file's source and fails if any role tag or session name ever appears in it.
- `lib/roster.mjs` — `buildRoster`/`collectRoster` accept a `pinned` predicate over display names, consulted at the two places a row is discarded: the id-era scope rule and the `DEAD_SHOWN` cap. A caller that says nothing pins nothing, so scope is unchanged for everyone else.
- `lib/roster-table.mjs` — `restingRow`/`restingRows` for a pinned role with no session; a pin button inside the existing `.c-name` cell, so `COLS` is untouched and #168 is free to take it 6 → 8 for its model and created columns; two `<tbody>` bands with sticky section rows; `TABLE_JS` sorts inside each band and posts the pin. The section rows span `COLS` by reference rather than by literal, so that bump needs no edit here.
- `ops-dashboard.mjs` — `POST /pin`, and the pins are read before the roster is assembled because they decide scope.
- Coordinated with the created-date column (#168) in flight on the same file: the comparator in `tableRows()`, `facetsOf()`, `COLS` and `th()` are all untouched here, and one existing assertion in `test/roster-table.test.mjs` changed — the per-agent row count now excludes `data-resting` rows.

## Next steps

- #168 (created column, newest-first sort) lands on the same file; whichever is second rebases.
- Nothing else is required for this to work. If the band grows past a screenful on your phone, the next move is a fold on the pinned band rather than a cap.

---

This PR was drafted by 👯🤖 W0034 (Claude Code using Opus 5) and reviewed by @jwildfire.
