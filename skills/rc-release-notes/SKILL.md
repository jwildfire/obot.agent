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
- **After the tag, promote and reset**: in the same release pass, the released section's
  heading drops the suffix in the file too, and a fresh `vX.Y.Z (Upcoming)` heading for the
  next version opens above it (a one-line "nothing yet" placeholder is fine). The worked
  example is obot.agent v0.4.0 (2026-08-15, the first R2-model release).
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

## The RC PR's title

**`{package} vX.Y.Z-RCn`, and nothing else** — `gsm.safety v1.1.0-RC1`. No summary, no
`Release candidate:` lead, no em-dash tail (@jwildfire, 2026-08-15: *"New rule for release
candidate names: {package} Vx.x.x-RCx. No other summary allowed."*). This supersedes the
earlier same-day shape `{package} vX.Y.Z — {what the release is}`; titles in that shape are
legacy and get retitled on their next touch.

The description is not lost — it becomes the one-sentence exec summary that opens the body,
which is what the Operations Dashboard renders under the title in his queue.

**The `-RCn` counter** — `n` counts candidates put in front of him, not PR objects or pushes:

- The first candidate for a version is **`-RC1`**; there is no unnumbered RC.
- **Increment when review is re-requested after a `CHANGES_REQUESTED` decision**, and only
  then. Pushes before he reviews do not move it; a round ending in approval does not either.
- **Retitle the same PR — never open a new one.** The thread holds his comments, the review
  decisions and the CI history, and he reviews `-RC2` by re-reading `-RC1`. One
  `gh pr edit --title`. A *mechanical* re-open (authorship, so he can hold the reviewer
  role — open.gismo #9 → #10) is not a re-cut and does not increment.
- **Resets per version**: `v1.1.0-RC1`, `v1.1.0-RC2`, then `v1.2.0-RC1`.
- **The tag drops the suffix** — the release is `v1.1.0`. `-RCn` never reaches a tag, a
  release body, or a `NEWS.md` heading.

`scripts/obot-merge` warns (never refuses) on a release merge whose title is off-shape.

## The RC PR's body

One sentence → links → requirements closed → details, per @jwildfire (2026-08-15). The
full template and its rules live in
[`docs/rc-framework.md`](../../docs/rc-framework.md#what-an-rc-pr-must-carry).

**The exec summary is the first line of the body.** Nothing goes above it — no banner,
no status heading, and not the comment either. The attested-lane rule rides in an HTML
comment placed directly *below* the sentence:

```markdown
{One sentence: what this release lets someone do that they could not do before.}

<!-- Release candidate. Merges only on @jwildfire's explicit approval, via the
     attested lane: scripts/obot-merge <pr> -R <repo> --jeremy-approved '<where/when>'. -->
```

GitHub hides the comment wherever it sits; the dashboard's summary rule does not, and it
takes the first line that is not a heading or a bullet. Put the sentence first and no
reader downstream has to know about comments at all.

The `## ⛔ Release candidate — …` heading this replaces was retired on 2026-08-17: it told
@jwildfire a rule about himself, and the attested lane is enforced by `obot-merge`, not by
a sentence he reads. Anything written on a surface he reads is written for him; agent
instructions go in agent-facing places ([the framework
doc](../../docs/rc-framework.md#written-for-him-or-written-for-us)).

Two more things this skill owns:

- **Every RC PR links `NEWS.md`** — mandatory, in the bullet list above the fold, pointing
  at the **file on the RC's head branch** (sections are newest-first, so it opens on the
  right one; the `#...-upcoming` anchor breaks when the suffix drops at tag time).
- **The exec summary and the `NEWS.md` section must say the same thing.** The sentence is
  the section's headline claim in one line — if revising one leaves the other stale, his
  queue row and his release notes disagree.

## The section shape

In order, for `# {repo} vX.Y.Z` (titled `# {repo} vX.Y.Z (Upcoming)` until the release is
cut):

1. **The demo-artifact link, first.** A `**See it move:**` line pointing at the release's
   annotated demo page under `obot.roadmap/reports/{slug}/` — always the first line of the
   section, before any prose or feature list. This is a standing rule, not a style choice.

   The demo page is an agent artifact and gets a row in the hub's news feed, so its own
   `<head>` carries the line that feed shows — written when the page is written:

   ```html
   <title>safety.viz v1.7.0 — annotated demo</title>
   <meta name="description" content="What v1.7.0 adds, annotated: the Time-to-Event Explorer, captured live from the release-candidate build, with a way into each behaviour.">
   ```

   Name what the release actually adds; "AI-generated report." and bare version numbers
   do not tell @jwildfire whether the row is worth opening. Contract and checker in
   `obot.roadmap/reports/README.md`.
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
- **Publishing mechanics** (learned on obot.agent v0.4.0, the first end-to-end R2 release):
  the tag goes on **the RC merge commit — the `stable` tip** — by publishing with
  `target_commitish` set to that sha; a **draft** release cannot be addressed by tag
  (`gh release edit <tag>` returns "release not found"), so edit it by **release id**
  (`gh api -X PATCH repos/{owner}/{repo}/releases/{id} … -F draft=false`); and the attested
  `obot-merge` call must be invoked directly, not wrapped in a helper script — the wrapped
  spelling is what the permission allowlist does not cover.
