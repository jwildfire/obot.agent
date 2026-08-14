---
name: rc-release-notes
description: "Use when preparing a release candidate, drafting or updating release notes, or creating or maintaining a repo's NEWS.md. NEWS.md is the running release log and the draft of each release's notes — demo-artifact link first, then a robust, text-only, functionality-first account of what's new. Covers deriving the notes from the window's increment PRs, the section shape, and how the notes publish on the tag."
---

# RC Release Notes

Release notes are half of what makes a release candidate reviewable — the demo page
([`docs/rc-framework.md`](../../docs/rc-framework.md)) is the other half. This skill owns
where the notes live and how they are written.

## Where the notes live: NEWS.md

- Every release-shipping repo keeps a **`NEWS.md` at the repo root** — the running release
  log, newest release first (@jwildfire, 2026-08-14, v1.6.0 RC review).
- The **current section is the draft of the release notes**: it lands on the integration
  branch during the RC window, flows into the open RC PR, and is what @jwildfire reads as
  "the release notes" when reviewing. On publish, the tag's GitHub release body comes from
  this section.
- The exemplar file is [safety.viz `NEWS.md`](https://github.com/jwildfire/safety.viz/blob/dev/NEWS.md);
  the altitude exemplar remains the
  [v1.5.0 release](https://github.com/jwildfire/safety.viz/releases/tag/v1.5.0).

## The section shape

In order, for `# {repo} vX.Y.Z`:

1. **The demo-artifact link, first.** A `**See it move:**` line pointing at the release's
   annotated demo page under `obot.roadmap/reports/{slug}/` — always the first line of the
   section, before any prose or feature list. This is a standing rule, not a style choice.
2. **A short intro paragraph** — the release in two or three sentences, plus a
   compatibility line ("No existing API is removed or renamed") when true.
3. **`## What's new`** — the robust list. One bullet per feature, **text only, no
   screenshots** (the demo page carries the visuals). Functionality-first and user-facing:
   what a person can now do that they could not, and why it matters. Each bullet links its
   hub requirement, its repo issue(s), and its implementing PR(s), and ends with a
   `[Try it live](…)` link where a live surface exists.
4. **`## Also in this release`** — process, housekeeping and evidence work, one line each.
5. **Optional inventory** — for repos with a gallery or module roster, the current table
   with the new entries bolded.
6. **A tests/provenance line** — suite counts and gates, compressed.

Below the versioned sections, an **`# Earlier releases`** index: one line per past release
linking its GitHub release page (and its demo artifact where one exists). Back-fill only
what the release pages already say — never invent history.

## Writing it

- **Derive from the real diff**: read every increment PR body merged since the last tag
  (`git log <last-tag>..origin/<integration>`), not a session summary of them. The PR
  bodies are the primary source; the notes compress them to the user-facing layer.
- **Optimize for the review path** @jwildfire actually walks: skim the RC PR → read the
  demo page → read the release notes → dig elsewhere only if needed. The notes are the
  layer where he confirms completeness, so favor coverage over brevity — minor and patch
  releases are lighter but the same shape.
- The NEWS.md update ships as a normal **increment PR to the integration branch** during
  the RC window, so it flows into the open RC without touching the RC PR itself. Run the
  repo's formatter gate (e.g. `npx prettier --check NEWS.md`) before pushing.
- Keep the RC PR body's notes and NEWS.md **saying the same thing** — when one is revised
  in review, revise the other (Draft Sync Convention).
- Repos that release by draft GitHub release rather than a dev → main PR (obot.agent,
  obot.roadmap, demo-301) keep the same NEWS.md; the draft release body is its current
  section.
