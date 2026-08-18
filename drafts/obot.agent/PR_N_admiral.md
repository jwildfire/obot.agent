<!-- STATUS: Drafted on 2026-08-17 -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Labels: enhancement, Assignee: @me -->

The fleet manager is the admiral, everywhere. The three standing roles are prime, admiral and nav.

Closes #182

## What this is

You named it on 17 August: *"I think we should call the fleet manager the admiral. prime, admiral and nav."* The name had shipped in code the day before, so this went out the same evening rather than waiting — every hour it sat there was another place to change.

The role moved wholesale: the module, the launcher, the skill, the slash command, the session name, the registry entry, the delivery-record actor, the environment variables, the launch log, and every sentence that named it. The session tag moved with it, from 🚦🤖 to ⚓🤖, for a reason below that is worth thirty seconds.

The word "fleet" survives wherever it means the worker fleet — a quiet fleet, an empty fleet, fleet hygiene. That is what the admiral manages, and it was never the name of the role.

## Roadmap context

Under [hub#236](https://github.com/jwildfire/obot.roadmap/issues/236), the requirement for the role itself, whose title and body now carry the new name. The org chart requirement [hub#237](https://github.com/jwildfire/obot.roadmap/issues/237) is updated too, including its published artifact.

Milestone v0.5.0. Not a release candidate — it lands on the standard lane.

## The tag changed, and that was not decoration

🚦 was chosen as a traffic signal for a fleet manager. It is also, and was already, the headline glyph for `## 🚦 Release candidates needing review` — the first section of every wrapup, every session-init hand-off, and `docs/rc-framework.md`. One glyph meaning both *your review queue* and *the agent that may never touch a release candidate* is the worst available collision, and the rename was the cheap moment to separate them.

⚓ is naval like the name, sits beside prime's 🎩 and nav's 🧭, and is used nowhere else in the workspace.

## Two things that would have broken silently

Neither would have failed a test. Both were found by looking.

- **The launch log.** `parseAdmiralLog` reads the log back to enforce the relaunch and repeat floors, so an empty log means *nothing has ever launched* and every floor is open. Renaming `fleet.log` to `admiral.log` would not have errored — it would have silently re-armed both floors and let the next sweep launch on a signature that had been deliberately held four hours earlier. The new path is authoritative and the old one is read when the new one does not exist yet.
- **The delivery-record actor bar.** `CALL_ONLY_ACTORS` is what stops the admiral writing a verdict. Renaming its single entry from `fleet` to `admiral` would have *widened* what may write verdicts: anything still running as `OBOT_ACTOR=fleet` would have walked through a guard that used to stop it. Both names are listed now, permanently. A bar costs nothing by keeping a name nobody uses and costs everything by dropping one somebody still does.

And one guard that would have slept through its own event: `pins.test.mjs` exists to catch exactly a half-landed rename of this role, and it swallowed import failures with `catch { return }` and compared each field only `if` the export was truthy. Renaming `ADMIRAL_TAG` away would have passed. It is unconditional now.

## Evidence

- **The live detector still finds the real corpse.** The job that wedged for eleven hours is still named `🚦🤖 obot-fleet` on disk. Run against this branch, the detector reports `admiral died — API Error: … SSL certificate hostname mismatch`. Run with prior-tag matching removed, it reports nothing at all: `roleOf` returns null, `mustExit` is false, and the job is never watched. That is measured on the real record, not argued.
- **The launcher runs end to end under the new name.** `node scripts/obot-admiral --check` prints `## Admiral — triggered, acts and exits`, and `--preflight-only` shows the command it would issue: `claude --bg … -n '⚓🤖 obot-admiral' … '/s-admiral …/admiral-brief.json'`.
- **The pinned band holds three standing roles** — prime, admiral, nav — checked in Chrome at desktop width and at a real 390px viewport, with the old-tag death still present one section below and no horizontal overflow.
- **732 tests pass** across all five suites. Note for any runbook: `node --test <dir>/` fails on this machine's Node 24.14.0 before running anything; the glob form `node --test <dir>/*.test.mjs` is the one that works, and that is true on `main` as well as here.

## What was checked and deliberately left alone

- Every verbatim quote of yours. "also let me pin agents. pin prime, nav and fleet manager (fleet for short) by default" stays word for word in NEWS.md, `pins.mjs`, the dashboard README and the role registry; the prose around it carries the new name.
- `drafts/`, which mirrors what was posted to GitHub and would stop matching it.
- The bare 🚦 in `docs/rc-framework.md`, `skills/session-wrapup`, `skills/session-init` and `tools/session-init/handoff.sh` — that is your release-candidate headline and was never this role's.
- A test fixture that deliberately keeps the old tag, because it is the regression test for the prior-tag mechanism.

## Coordination

Three workers were in these files at once. W0036 (#183) and W0037 (#184) landed first and this rebases onto both, by agreement made before any of us started editing.

Two things came back the other way. W0036's Task column renders a role's `resting` string, and the admiral's was 101 characters — one over what the cell fits, so it would have shipped clipped; it is 88 now, and W0036 added a test that holds every role under the limit. W0037's registry split gave the rename one place to edit instead of two.

## Next steps

- The workspace skill symlink is repointed and `/s-admiral` resolves; the old `fleet` link is removed once this merges.
- [#185](https://github.com/jwildfire/obot.agent/issues/185) is open on a separate defect found while verifying the live cycle: a blocked admiral held the singleton for eleven hours. Not touched here — a rename that also changes launch semantics is a change nobody can review.
- A naming note recorded rather than resolved: an admiral outranks a captain and the reporting line here runs the other way. The org chart now tells readers to read the arrows rather than the names.

---

This PR was drafted by 👯🤖 W0038 (Claude Code using Opus 5) and reviewed by @jwildfire.
