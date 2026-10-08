---
name: release-notes
description: "Write or cut a release's section of NEWS.md so it is short: one line to the demo page, a few sentences on what the release is, one short bullet per feature, a line on tests. Use when drafting release notes, preparing a release or a release candidate, adding an entry to NEWS.md as a change lands, or when @jwildfire says the notes are too long. Runs a checker that fails notes over the length limits. Do NOT use for the demo page itself (the detail the notes leave out goes there, under the hub developer guidelines' Releases section), for the release-candidate pull request's body, or for a commit message."
argument-hint: "Path to NEWS.md, and the version if not the newest section"
---

# Release notes

Release notes say what a release lets someone do, in the time it takes to read a
screen. Everything else goes on the release's demo page. @jwildfire, 2026-10-06, on two
sets of notes that ran to 2,088 and 1,754 words: "Release notes are way too wordy. …
see the latests safety.viz releases notes for a decent template. The details go in the
demo page."

The rules a release follows (where `NEWS.md` lives, the demo page, the release
candidate, the review gate) are the hub's
[developer guidelines → Releases](https://github.com/jwildfire/obot.roadmap/blob/main/docs/developer-guidelines.md#releases).
This skill is how to write the notes those rules ask for.

## The template

[safety.viz v1.9.1](https://github.com/jwildfire/safety.viz/blob/dev/NEWS.md) is the
template: 475 words. Copy its shape, not its length to the word. One bullet in it, under
"Also in this release", runs to 90 words against the limit of 60 set since; v1.9.2 in the
same file, 345 words, passes every limit.

```markdown
# {package} vX.Y.Z (Upcoming)

**See it move:** the [annotated vX.Y.Z demo]({deployed hub URL}) has captures, try-it steps and the detail behind everything below.

{Two to four sentences: what the release is, what it needs, and whether anything a user already has stops working or behaves differently.}

## What's new

- **{What someone can now do, as a sentence.}** {One or two sentences more, if the claim needs them.} [obot.roadmap#N]({url}), [#N]({issue url}), PR [#N]({pull request url})

## Deprecated

- **{What is deprecated, and the release that removes it.}** {What to do instead.} [#N]({url}), PR [#N]({url})

## Also in this release

- **{A smaller change, a fix, or something a reader should know is not in the release.}** {One sentence more at most.} [#N]({url}), PR [#N]({url})

## Tests and provenance

{The counts. What holds the numbers to their reference. The commits of anything copied in.}
```

`## Deprecated` and `## Removed` appear only when something is. No other heading is used.

## The limits

Counted as a reader meets the words, a line at a time: a link counts as its text, and the
issue and pull-request links that close a line are not counted. A closing link is one of
those only when its text is the reference (`#12`, `repo#12`, `owner/repo#12`,
`roadmap #12`) and its address is that issue, pull request or discussion; ten a line at
most. A bullet wrapped over several lines is one bullet.

The checker reads this shape and no other, and reports what it cannot read:

- Bullets are `- ` at the margin (`* ` and `+ ` are read the same). A list item that is
  numbered, followed by a tab, or indented with no bullet above it is reported.
- Headings are `## ` at the margin, the five above, once each and in that order.
- No fenced code blocks. A command or a snippet goes on the demo page; inline code is
  fine. A line that opens with three backticks or tildes is reported, and its words are
  counted.
- A comment sits on its own lines, opening at the start of a line. A `<!--` or `-->`
  anywhere else is reported.

Where it still reads something differently from a reader is listed in
[obot.agent#354](https://github.com/jwildfire/obot.agent/issues/354).

| Part | Limit |
|---|---|
| The whole section | 600 words |
| The introduction | 80 words |
| What's new | 6 bullets, 70 words each |
| Deprecated, Removed | 100 words a bullet: the reader has to act |
| Also in this release | 60 words a bullet |
| Tests and provenance | 100 words |

A patch release is far shorter than the limit. If the notes do not fit, the release is
not too big for the limits; the notes are carrying the demo page's work.

## What stays, and what goes to the demo page

Stays in the notes:

- What someone can now do, said the way they would say it.
- What changes for someone who already uses the package: a default that moved, a
  setting to add to get the old behaviour, a deprecation. One sentence, in the bullet
  of the feature that caused it.
- What is knowingly not in the release or not fixed, in one bullet with its issue.
- The issue and the pull request for each bullet, and the hub requirement for a feature.

Goes to the demo page, where there is a picture beside it:

- How a feature works, step by step, and what each control does.
- Lists of settings, their defaults and their names. The API reference has them too.
- Edge cases, and what the chart or function says in each.
- Before and after, in detail, for a page or a call written for the last release.
- Why it was built this way, and what was considered.
- What the review found, and the story of how a fix was made.
- File names, test names, requirement row IDs, byte counts and pixel sizes, unless a
  user types or reads that exact thing.

Before cutting a detail, check the demo page or the API reference says it. If neither
does, add it there first: a detail is moved, never dropped.

## Procedure

1. List what the release ships from its milestone's closed issues and their pull
   requests (`gh issue list -R {repo} --milestone vX.Y.Z --state closed`), not from
   memory and not from an earlier draft.
2. Sort them: a feature a user would name goes under "What's new"; a fix, a process
   change or housekeeping under "Also in this release"; several small ones about the
   same thing become one bullet.
3. Write each bullet's bold sentence first. If the bold sentences read in a row do not
   tell someone what the release is, rewrite them before adding anything.
4. Add at most two sentences to a bullet, then its links.
5. Write the introduction last, from the bold sentences.
6. Run the checker, and cut until it passes:

   ```bash
   node /path/to/obot.agent/skills/release-notes/check-notes.mjs NEWS.md
   ```

   It prints the section's word count, each part over its limit and each line it
   cannot read, and exits 1 until there is none. Give it a version as a second argument to check an older section.
   An `(Upcoming)` section with no change in it yet has nothing to check, and passes.
   Its own tests: `node --test check-notes.test.mjs`, beside it.
7. Check every link in the section answers, and that the demo page carries each detail
   that was cut.
8. Read it once as someone who has never seen the repository. Whatever they would skip,
   cut.

When a change lands between releases, add its bullet to the `(Upcoming)` section in the
same pull request, already at this length. Notes kept short as they grow do not need
cutting at release time.

## Writing it

- Say the thing, then stop. No sentence that explains the sentence before it.
- One claim a bullet. "And" joining two features is two bullets, or one of them belongs
  under "Also in this release".
- Name a setting or a function only when the reader has to type it.
- A number only when it is the news: a count of charts, a size someone downloads.
- The hub's writing rules apply as everywhere: plain English, the thing before its
  number, no bold inside a sentence beyond the opening claim, every link working.
