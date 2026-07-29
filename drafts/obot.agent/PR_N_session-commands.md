<!-- STATUS: Drafted on 2026-07-29 06:50 EDT -->
<!-- GITHUB_PROPERTIES: Assignee: @me, Draft: true -->

## Summary

Two new session commands, and a short `/s-*` alias for every command in the family.

**`/session-idea`** files one idea to the hub's Ideas discussions for triage — the in-session capture door to the idea queue ([obot.roadmap#48](https://github.com/jwildfire/obot.roadmap/issues/48)), alongside the Siri/Reminders lane. `scripts/ideas-file` posts as obotclaw[bot] in the same title/body/provenance shape `reminders-to-ideas` produces, and honours the same `private:` prefix, so a thread reads the same whichever door it came through. `session-inbox` remains the triage half; `session-idea` deliberately does **not** triage its own post — the hub's `ideas-triage` Action answers within minutes.

**`/session-reviews`** spawns a sibling that walks you through the PRs waiting on your decision, one at a time. Each PR opens with why it matters, the decision being asked, what is already verified, and what is uncertain — not a file listing. `scripts/reviews-queue` builds and classifies the queue; the reviewer executes the answer (mark ready, merge via `obot-merge`, request changes, defer).

**`/s-*` aliases** for all eleven: `/s-init`, `/s-todo`, `/s-update`, `/s-note`, `/s-scaffold`, `/s-spawn`, `/s-inbox`, `/s-dashboard`, `/s-wrapup`, `/s-idea`, `/s-reviews`. Long forms are untouched.

Filed from a direct ask: *"I want two new session commands /session-idea … and /session-reviews … Also allows all session-command to s-command"*.

## Roadmap context

`session-idea` closes the last open gap in the idea queue's capture story ([#48](https://github.com/jwildfire/obot.roadmap/issues/48)): capture had a phone lane and a GitHub lane, but nothing for the most common case — an idea surfacing mid-session, where the alternative was a todo item that quietly became this session's problem.

`session-reviews` addresses the program's actual bottleneck. Agents ship PRs faster than one person reads them, and a stack of open PRs is stalled work. It is the conversational sibling of the review-guide checkbox pattern ([obot.roadmap#114](https://github.com/jwildfire/obot.roadmap/issues/114)) — the skill offers the checkbox guide instead when the queue is large or you are stepping away.

## Evidence

**The alias mechanism was settled empirically, not by guessing.** Six isolated probe projects, nothing touching the shared workspace, on CLI 2.1.220:

- Slash commands resolve on the skill's **directory name**; frontmatter `name` is ignored for resolution (a skill in `probe-hidden/` named `probe-secretname` listed and resolved as `probe-hidden`).
- **A second symlink is a trap, not a free alias.** Adding `probe-alias -> probe-real` made `probe-real` *disappear* from the skill list — skills dedupe on resolved path, so the obvious approach would have silently broken the long forms that are in muscle memory and in other skills' cross-references.
- An `aliases:` frontmatter key is not honoured: `/pshort` answered `Unknown command`.
- `@path` inside a command file **is** expanded by the harness before the model runs — verified with `--tools ""`, i.e. with no tools available at all, so it cannot be a model-issued Read. It resolves relative to the project root and follows symlinks. Trailing arguments are appended automatically.

**End-to-end, in a mirror workspace built from these files:** all 22 forms list together (11 long + 11 short, no shadowing), and `/s-reviews` and `/session-reviews` return **identical** content with tools disabled. `scripts/session-aliases --check` returns clean on a good tree and exit 1 on deliberate drift.

**`ideas-file` verified live**: [obot.roadmap discussion #141](https://github.com/jwildfire/obot.roadmap/discussions/141), posted as obotclaw[bot] in the Ideas category — a real finding from this work, not filler. The `private:` lane and `--print` dry run were exercised against a temp inbox.

**`reviews-queue` verified against the live queue**: 4 PRs `AWAITING YOU` (sv#119, sv#121, oa#61, oa#62), 1 `BACK TO THE AGENT` (oa#52, conflicts with base), and the four 2021-2022 dependabot PRs on the dormant `forest-plot` fork correctly dropped.

## Technical briefing

**Why command files rather than stub skills.** Both work; the command file wins on cost. A stub skill would need its own `SKILL.md` and an extra Read at every invocation, and would add a second directory per command. The alias is two lines, adds no tool call, and there is exactly one copy of every procedure — the alias cannot drift from what it aliases because it *is* the same file.

**Two scoping decisions in `reviews-queue`, both counter-intuitive and both measured:**

- **Drafts are included.** Agents here ship `gh pr create --draft` by default, so draft is the normal shipping state, not a signal of unreadiness — 4 of the 5 live program PRs are drafts, including ones already on your review list. Excluding them, as "open, non-draft" would suggest, would have emptied the queue down to one PR.
- **Staleness, not an allowlist.** Filtering on last-updated plus dropping dependency bots by author kills the dormant-fork noise without a repo list that rots.

**Two traps the reviewing skill now documents, both re-verified after `policy.json` landed:**

- `obot-merge` **refuses drafts** ("mark it ready for review first"). Since most of the queue is drafts, `gh pr ready` is a normal step of executing your approval — and marking ready is not merging.
- `obot-merge --check` is a **policy** check, not a mergeability check. It answered `CHECK PASSED` on oa#52 while that PR was `CONFLICTING/DIRTY`. `reviews-queue` reads `mergeable` separately and buckets conflicts as "back to the agent". That papercut is the idea filed at discussion #141.

**Rebased onto `policy.json`.** [#61](https://github.com/jwildfire/obot.agent/pull/61) merged mid-session and retired `merge-policy.json`; this branch is rebased on it, the README conflict resolved to keep both changes, and `session-reviews` documents the new `standard`/`attested` lanes and `obot-policy explain` rather than the retired tier names.

`skills/session-spawn/SKILL.md` was deliberately **not** touched — another session is editing it — so `session-reviews` references the spawn contract rather than restating it.

## Next steps

- **Install after merge, from the main clone** (not a worktree — the symlinks point at whatever copy they were made from): `obot.agent/scripts/session-aliases`. It writes `.claude/commands`, links the two new skills into `.claude/skills/`, and is idempotent. Nothing was installed into the live workspace from this branch.
- New session commands are one command away from an alias: add `skills/session-foo/`, run `scripts/session-aliases`, and `/s-foo` exists. `--check` catches the case where someone forgets.
- **Try `/session-reviews` on the current queue** — there are four PRs waiting on you right now, and this branch makes five.
- Merge is your gate as always; when you give it, `obot.agent/scripts/obot-merge 63 -R jwildfire/obot.agent` (`--check` first).

---

This PR was drafted by Claude Code using Opus 5 and reviewed by @jwildfire
