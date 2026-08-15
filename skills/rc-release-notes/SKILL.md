---
name: rc-release-notes
description: "Use when preparing a release candidate, drafting or updating release notes, or creating or maintaining a repo's NEWS.md. NEWS.md is the running release log and the draft of each release's notes — demo-artifact link first, then a robust, text-only, functionality-first account of what's new. Covers deriving the notes from the window's increment PRs, the section shape, and how the notes publish on the tag."
---

# RC Release Notes

Release notes are half of what makes a release candidate reviewable — the demo page
([`docs/rc-framework.md`](../../docs/rc-framework.md)) is the other half. This skill owns
where the notes live and how they are written.

## Where the notes live: NEWS.md

- **Every repo keeps a `NEWS.md` at the repo root, always current in `main`** — the running
  release log, newest section first (@jwildfire, 2026-08-14 v1.6.0 RC review; extended to
  every repo 2026-08-15, [decision record](https://github.com/jwildfire/obot.roadmap/discussions/155)).
- **Unreleased work accumulates under a `vX.Y.Z (Upcoming)` heading.** Merged-but-unreleased
  changes are listed there as they land, so the repo always carries a running list of
  what's new and un-released. When the release is cut, the heading **loses the
  `(Upcoming)` suffix** and its section is the release body, copied verbatim — the
  `(Upcoming)` marker never appears in a published release. Keeping the section current is
  part of landing the change, not a release-time reconstruction.
- The **current section is the draft of the release notes**: it lands on the integration
  branch during the RC window, flows into the open RC PR, and is what @jwildfire reads as
  "the release notes" when reviewing. On approval, the section is **copied verbatim as the
  tag's GitHub release body** — "a news.md file that will be copied to release notes once
  I approve the PR" (@jwildfire, sv#124 review, 2026-08-14).
- The exemplar file is [safety.viz `NEWS.md`](https://github.com/jwildfire/safety.viz/blob/dev/NEWS.md);
  the altitude exemplar remains the
  [v1.5.0 release](https://github.com/jwildfire/safety.viz/releases/tag/v1.5.0).

## Before the notes: the milestone

The notes and the milestone describe the same release, so build the milestone
first and write the notes from it.

1. **Create the release's milestone** in the repo if it does not exist —
   matching the existing naming exactly (`v1.6.0`, not `v1.6`), due-dated to the
   release, described in one line.
2. **Assign it to every issue the release delivers**, taken from the increment
   PRs' `Closes` lines over the window (`git log <last-tag>..origin/<integration>`),
   not from the notes draft. Move the milestone forward off the wave that scoped
   the issue: it records **the release that shipped the work**.
3. **Close only what is fully delivered.** An issue delivered in part keeps the
   milestone, stays open, and gets a comment naming exactly what remains — the
   notes then say "partial" for it. When in doubt, leave it open.
4. **Carry a `Closes #N` line into the RC PR body for each of them**, even where
   the increment PR already closed the issue. The milestone groups; the keyword
   closes; the RC body is the manifest. [`scripts/obot-merge`](../../scripts/obot-merge)
   refuses the release merge without it.
5. **Close the milestone** when the release ships and nothing in it is open.

Full rule and its history: [`AGENTS.md` → Milestone before work](../../AGENTS.md#milestone-before-work).

## The section shape

In order, for `# {repo} vX.Y.Z` (titled `# {repo} vX.Y.Z (Upcoming)` until the release is
cut):

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
5. **A tests/provenance line** — suite counts and gates, compressed.

Do **not** repeat a standing inventory (the full gallery / module-roster table) in every
release's section — a release section covers what *changed*; the current roster lives on
the gallery page, and the notes link to it ("no need to list all the renderers in the
news.md every future release", @jwildfire, v1.6.0 approval review, 2026-08-14 — v1.6.0
itself keeps its table as the shape's first exercise).

Below the versioned sections, an **`# Earlier releases`** index: one line per past release
linking its GitHub release page (and its demo artifact where one exists). Back-fill only
what the release pages already say — never invent history.

## Writing it

- **Write it copy-ready.** The section must publish with zero editing: no "see the PR for
  details", no internal-process asides, no TODOs. If a line would not belong in a
  published GitHub release, it does not belong in NEWS.md.
- **Derive from the real diff**: read every increment PR body merged since the last tag
  (`git log <last-tag>..origin/<integration>`), not a session summary of them. The PR
  bodies are the primary source; the notes compress them to the user-facing layer.
- **Optimize for the review path** @jwildfire actually walks: skim the RC PR → read the
  demo page → read the release notes → dig elsewhere only if needed. The notes are the
  layer where he confirms completeness — cover every user-visible change, but keep each
  one tight: a headline sentence plus a bullet's worth of what-you-can-now-do, with depth
  deferred to the demo page and the API reference (that is what the demo link at the top
  is for). His v1.6.0 read: "a tad long, but ok overall" — treat length as a real cost,
  not a rewrite trigger. Minor and patch releases are lighter but the same shape.
- The NEWS.md update ships as a normal **increment PR to the integration branch** during
  the RC window, so it flows into the open RC without touching the RC PR itself. Run the
  repo's formatter gate (e.g. `npx prettier --check NEWS.md`) before pushing.
- Keep the RC PR body's notes and NEWS.md **saying the same thing** — when one is revised
  in review, revise the other (Draft Sync Convention).
- Repos whose integration branch is `main` release the same way, from a lagging release
  branch: obot.agent's RC is a `main → stable` PR (the R2 shape, @jwildfire 2026-08-15),
  demo-301's is `main → site`. The NEWS.md contract is identical — the current
  `(Upcoming)` section becomes the RC PR's notes and the tag's body. The draft-GitHub-release
  workaround is retired ([rc-framework.md](../../docs/rc-framework.md)).
